import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import type { WaveMeta } from "../shared/types";
import { header } from "../shared/miniseed";
export class StationRelay extends DurableObject<Env> {
  private recent: Array<{ meta: WaveMeta; bytes: ArrayBuffer }> = [];
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      if (this.ctx.getWebSockets().length >= 200)
        return new Response("Station viewer limit reached", { status: 429 });
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].send(JSON.stringify({ type: "hello", serverTime: Date.now() }));
      for (const item of this.recent) {
        pair[1].send(JSON.stringify(item.meta));
        pair[1].send(item.bytes);
      }
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (request.method !== "POST")
      return new Response("Not found", { status: 404 });
    return this.ctx.blockConcurrencyWhile(async () => {
      const station = url.searchParams.get("station")!,
        session = url.searchParams.get("session")!,
        sequence = Number(url.searchParams.get("sequence")),
        start = Number(url.searchParams.get("start"));
      if (
        !/^[a-zA-Z0-9_-]{1,80}$/.test(session) ||
        !Number.isSafeInteger(sequence) ||
        sequence < 0 ||
        !Number.isFinite(start) ||
        Math.abs(start - Date.now()) > 86400000
      )
        return new Response("Invalid stream metadata", { status: 400 });
      const bytes = await request.arrayBuffer();
      if (bytes.byteLength > 65536)
        return new Response("Record too large", { status: 413 });
      let h;
      try {
        h = header(bytes);
        if (h.length !== bytes.byteLength)
          throw new Error("One record required");
      } catch (e) {
        return new Response(String(e), { status: 400 });
      }
      const id = `${station}:${session}:${sequence}`;
      const existing = await this.env.DB.prepare(
        "SELECT object_key,start_time FROM waveform_records WHERE id=?",
      )
        .bind(id)
        .first<{ object_key: string; start_time: number }>();
      if (existing) {
        const archived = await this.env.ARCHIVE.get(existing.object_key);
        const old = archived
          ? new Uint8Array(await archived.arrayBuffer())
          : null;
        if (
          existing.start_time !== start ||
          !old ||
          old.length !== bytes.byteLength ||
          !old.every((x, i) => x === new Uint8Array(bytes)[i])
        )
          return new Response("Sequence already contains a different record", {
            status: 409,
          });
        return Response.json({
          accepted: true,
          duplicate: true,
          archived: true,
        });
      }
      const s = await this.env.DB.prepare(
        "SELECT mode FROM stations WHERE id=?",
      )
        .bind(station)
        .first<{ mode: "replay" | "live" }>();
      if (!s) return new Response("Unknown station", { status: 404 });
      if (s.mode === "live" && Math.abs(h.start - start) > 1)
        return new Response(
          "Live timestamps must match the instrument record",
          { status: 400 },
        );
      const now = Date.now(),
        key = `waveforms/${station}/${session}/${sequence}.mseed`;
      await this.env.ARCHIVE.put(key, bytes, {
        httpMetadata: { contentType: "application/vnd.fdsn.mseed" },
      });
      await this.env.DB.prepare(
        "INSERT INTO waveform_records(id,station_id,session,sequence,start_time,original_start,sample_rate,sample_count,channel,object_key,bytes,received_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      )
        .bind(
          id,
          station,
          session,
          sequence,
          start,
          h.start,
          h.sampleRate,
          h.sampleCount,
          h.channel,
          key,
          bytes.byteLength,
          now,
        )
        .run();
      const previous = await this.ctx.storage.get<WaveMeta>("latest");
      const meta: WaveMeta = {
        type: "record",
        station,
        session,
        sequence,
        start,
        originalStart: h.start,
        sampleRate: h.sampleRate,
        sampleCount: h.sampleCount,
        channel: h.channel,
        receivedAt: now,
        mode: s.mode,
        gap:
          previous?.session === session && sequence !== previous.sequence + 1,
      };
      const live =
        !previous ||
        start > previous.start ||
        (start === previous.start && sequence > previous.sequence);
      if (live) {
        await this.env.DB.prepare(
          "UPDATE stations SET last_received=?,last_sample=? WHERE id=?",
        )
          .bind(
            now,
            start + ((h.sampleCount - 1) / h.sampleRate) * 1000,
            station,
          )
          .run();
        await this.ctx.storage.put("latest", meta);
        this.recent.push({ meta, bytes });
        while (this.recent.length > 24) this.recent.shift();
        for (const ws of this.ctx.getWebSockets()) {
          try {
            ws.send(JSON.stringify(meta));
            ws.send(bytes);
          } catch {
            try {
              ws.close(1011, "Reconnect");
            } catch {}
          }
        }
      }
      return Response.json({ accepted: true, archived: true, live });
    });
  }
  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (message === "ping")
      ws.send(JSON.stringify({ type: "pong", serverTime: Date.now() }));
  }
  webSocketClose(ws: WebSocket) {
    try {
      ws.close(1000, "Closed");
    } catch {}
  }
  webSocketError(ws: WebSocket) {
    try {
      ws.close(1011, "Reconnect");
    } catch {}
  }
}
