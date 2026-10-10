import { useEffect, useRef, useState } from "react";
import { miniseed } from "seisplotjs";
import {
  Activity,
  Pause,
  Play,
  Download,
  Radio,
  ChevronUp,
  X,
} from "lucide-react";
import type { Station, WaveMeta } from "../shared/types";
import { ago, api, localTime } from "./api";
type Segment = {
  meta: WaveMeta;
  samples: Int32Array | Float32Array | Float64Array;
};
export default function Waveform({
  station,
}: {
  station: Station | undefined;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const segments = useRef<Segment[]>([]);
  const pausedRef = useRef(false);
  const freeze = useRef(0);
  const frozenSegments = useRef<Segment[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [paused, setPaused] = useState(false);
  const [channel, setChannel] = useState("");
  const [channels, setChannels] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [meta, setMeta] = useState<WaveMeta | null>(null);
  const [error, setError] = useState("");
  const [windowSeconds, setWindowSeconds] = useState(60);
  const [now, setNow] = useState(Date.now());
  const [archive, setArchive] = useState<
    Array<{ id: string; start_time: number; bytes: number }>
  >([]);
  const [showArchive, setShowArchive] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!station) return;
    let ws: WebSocket;
    let timer: ReturnType<typeof setTimeout>;
    let ping: ReturnType<typeof setInterval>;
    let active = true;
    let pending: WaveMeta | null = null;
    let attempt = 0;
    segments.current = [];
    frozenSegments.current = [];
    pausedRef.current = false;
    setPaused(false);
    setChannel("");
    setChannels([]);
    setMeta(null);
    setError("");
    const connect = () => {
      ws = new WebSocket(
        `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/stations/${station.id}/stream`,
      );
      ws.binaryType = "arraybuffer";
      ws.onopen = () => {
        setConnected(true);
        attempt = 0;
        ping = setInterval(() => {
          if (ws.readyState === 1) ws.send("ping");
        }, 20000);
      };
      ws.onmessage = (e) => {
        try {
          if (typeof e.data === "string") {
            const msg = JSON.parse(e.data);
            if (msg.type === "record") pending = msg;
            return;
          }
          if (!pending) return;
          const m = pending;
          pending = null;
          const records = miniseed.parseDataRecords(e.data);
          if (records.length !== 1)
            throw new Error("Unexpected waveform records");
          const samples = records[0].decompress();
          if (samples.length !== m.sampleCount)
            throw new Error("Sample count mismatch");
          if (
            !segments.current.some(
              (s) =>
                s.meta.session === m.session && s.meta.sequence === m.sequence,
            )
          ) {
            segments.current.push({ meta: m, samples });
            segments.current = segments.current
              .filter((s) => s.meta.start > Date.now() - 300000)
              .slice(-360);
          }
          setChannels((previous) =>
            previous.includes(m.channel) ? previous : [...previous, m.channel],
          );
          setChannel((previous) => previous || m.channel);
          setMeta(m);
          setError("");
        } catch {
          setError(
            "A waveform record could not be decoded. Waiting for the next record.",
          );
        }
      };
      ws.onclose = () => {
        clearInterval(ping);
        setConnected(false);
        if (active)
          timer = setTimeout(connect, Math.min(15000, 1000 * 2 ** attempt++));
      };
      ws.onerror = () => ws.close();
    };
    connect();
    return () => {
      active = false;
      clearTimeout(timer);
      clearInterval(ping);
      ws?.close();
    };
  }, [station?.id]);
  useEffect(() => {
    let frame = 0;
    let lastFrame = 0;
    const render = (now: number) => {
      frame = requestAnimationFrame(render);
      if (now - lastFrame < 1000 / 30 || document.hidden) return;
      lastFrame = now;
      const c = canvas.current;
      if (!c) return;
      const rect = c.getBoundingClientRect();
      const dpr = Math.min(devicePixelRatio || 1, 2);
      if (!rect.width || !rect.height) return;
      const pixelWidth = Math.round(rect.width * dpr);
      const pixelHeight = Math.round(rect.height * dpr);
      if (c.width !== pixelWidth || c.height !== pixelHeight) {
        c.width = pixelWidth;
        c.height = pixelHeight;
      }
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const w = rect.width;
      const h = rect.height;
      const end = pausedRef.current ? freeze.current : Date.now() - 1200;
      const start = end - windowSeconds * 1000;
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = "#29404e";
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const y = 18 + (i * (h - 38)) / 4;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      for (let i = 0; i <= 6; i++) {
        const x = (i * w) / 6;
        ctx.beginPath();
        ctx.moveTo(x, 10);
        ctx.lineTo(x, h - 18);
        ctx.stroke();
      }
      const visible = (
        pausedRef.current ? frozenSegments.current : segments.current
      ).filter(
        (s) =>
          s.meta.channel === channel &&
          s.meta.start + (s.samples.length / s.meta.sampleRate) * 1000 >=
            start &&
          s.meta.start <= end,
      );
      let max = 1;
      for (const s of visible)
        for (const v of s.samples) max = Math.max(max, Math.abs(v));
      const scale = 10 ** Math.ceil(Math.log10(max));
      ctx.fillStyle = "#91a5b3";
      ctx.font = "10px system-ui";
      ctx.fillText(`+${scale.toLocaleString()} counts`, 8, 12);
      ctx.fillText(`−${scale.toLocaleString()}`, 8, h - 24);
      ctx.strokeStyle = "#8ddbd6";
      ctx.lineWidth = 1.15;
      for (const s of visible) {
        ctx.beginPath();
        let started = false;
        const step = Math.max(
          1,
          Math.floor((s.meta.sampleRate * windowSeconds) / w),
        );
        for (let i = 0; i < s.samples.length; i += step) {
          const t = s.meta.start + (i / s.meta.sampleRate) * 1000;
          if (t < start || t > end) {
            started = false;
            continue;
          }
          const x = ((t - start) / (end - start)) * w;
          let lo = s.samples[i];
          let hi = lo;
          for (let j = i + 1; j < Math.min(i + step, s.samples.length); j++) {
            lo = Math.min(lo, s.samples[j]);
            hi = Math.max(hi, s.samples[j]);
          }
          const y = h / 2 - ((lo / scale) * (h - 48)) / 2;
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else ctx.lineTo(x, y);
          if (step > 1) ctx.lineTo(x, h / 2 - ((hi / scale) * (h - 48)) / 2);
        }
        ctx.stroke();
      }
      ctx.fillStyle = "#91a5b3";
      const ticks = w < 500 ? 2 : 3;
      for (let i = 0; i <= ticks; i++) {
        const x = (i * w) / ticks;
        ctx.textAlign = i === ticks ? "right" : "left";
        ctx.fillText(
          localTime(start + (i * (end - start)) / ticks, true),
          x,
          h - 4,
        );
      }
      ctx.textAlign = "left";
    };
    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [windowSeconds, channel]);
  const live =
    connected &&
    meta &&
    now - meta.receivedAt <
      Math.max(6000, (meta.sampleCount / meta.sampleRate) * 2000);
  const toggle = () => {
    pausedRef.current = !pausedRef.current;
    freeze.current = Date.now() - 1200;
    frozenSegments.current = [...segments.current];
    setPaused(pausedRef.current);
  };
  return (
    <section className={`wave-panel ${expanded ? "expanded" : "compact"}`}>
      <button
        className="wave-expand"
        aria-label={
          expanded ? "Collapse station signal" : "Expand station signal"
        }
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <X size={17} /> : <ChevronUp size={17} />}
      </button>
      <div className="wave-header">
        <div>
          <div className="section-kicker">
            <Radio size={14} /> Station signal{" "}
            <span className="badge">
              {station?.mode === "live" ? "Instrument feed" : "Recorded replay"}
            </span>
          </div>
          <h2>{station?.name || "No stations configured"}</h2>
        </div>
        <div className="signal-state">
          <i className={`dot ${live ? "teal" : "muted"}`} />
          {live
            ? station?.mode === "live"
              ? "Streaming instrument"
              : "Streaming replay"
            : connected
              ? "Awaiting station"
              : "Reconnecting"}
        </div>
      </div>
      <div className="wave-meta">
        <span>
          {channels.length > 1 ? (
            <select
              aria-label="Waveform channel"
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
            >
              {channels.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          ) : (
            channel || "Awaiting channel"
          )}
        </span>
        <span>{meta ? `${meta.sampleRate} samples/s` : "— samples/s"}</span>
        <span>
          {meta ? `Received ${ago(meta.receivedAt)}` : "No samples received"}
        </span>
      </div>
      <div className="trace-wrap">
        <canvas
          ref={canvas}
          aria-label="Seismogram of recorded ground motion in instrument counts"
        />
        {!meta && (
          <div className="trace-empty">
            <Activity size={24} />
            <p>Waiting for station data</p>
            <small>
              {station?.mode === "replay"
                ? "Start the local replay process to see recorded ground motion."
                : "The trace will appear when the instrument sends a record."}
            </small>
          </div>
        )}
      </div>
      <span className="compact-caption">
        {station?.mode === "replay"
          ? "Historical replay · not local motion"
          : "Instrument counts · uncalibrated"}
      </span>
      <div className="wave-footer">
        <span>
          {station?.mode === "replay" ? (
            <>
              Original:{" "}
              {meta
                ? new Date(meta.originalStart).toISOString().slice(0, 10)
                : "—"}{" "}
              · {station?.description || "Recorded waveform"}
              <br />
              <small>
                Replay at a demo location. Not local measurements. Auto-scaled
                counts.
              </small>
            </>
          ) : (
            <>
              {station?.description}
              <br />
              <small>Instrument counts · auto-scaled · uncalibrated</small>
            </>
          )}
        </span>
        <div className="wave-actions">
          <select
            aria-label="Waveform time window"
            value={windowSeconds}
            onChange={(e) => setWindowSeconds(Number(e.target.value))}
          >
            <option value={30}>30 sec</option>
            <option value={60}>60 sec</option>
            <option value={180}>3 min</option>
          </select>
          <button
            aria-label={paused ? "Resume waveform" : "Pause waveform"}
            onClick={toggle}
          >
            {paused ? <Play size={16} /> : <Pause size={16} />}
          </button>
          <button
            aria-label="View archived records"
            onClick={async () => {
              setShowArchive(!showArchive);
              if (station)
                try {
                  setArchive(await api(`/api/stations/${station.id}/archive`));
                } catch (e) {
                  setError(String(e));
                }
            }}
          >
            <Download size={16} />
          </button>
        </div>
      </div>
      {error && <p className="inline-error">{error}</p>}
      {showArchive && (
        <div className="archive">
          <h3>Original encoded records</h3>
          <p>miniSEED downloads from the local archive.</p>
          {archive.length ? (
            archive.slice(0, 8).map((r) => (
              <a key={r.id} href={`/api/records/${encodeURIComponent(r.id)}`}>
                {localTime(r.start_time)}{" "}
                <span>{r.bytes.toLocaleString()} bytes · Download</span>
              </a>
            ))
          ) : (
            <p>No records archived yet.</p>
          )}
        </div>
      )}
    </section>
  );
}
