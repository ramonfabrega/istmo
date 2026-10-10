import fs from "node:fs";
import { splitRecords, header } from "../shared/miniseed";
import { config } from "./config";
const cfg = config();
const input = fs.readFileSync("fixtures/replay.mseed");
const records = splitRecords(
  input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength),
);
const session = crypto.randomUUID();
const delay = Number(process.env.GAP_EVERY) || 0;
let sequence = 0;
let stopped = false;
process.on("SIGINT", () => {
  stopped = true;
});
console.log(
  `Replaying recorded BW.BGLD.EHZ through ${cfg.url}. Demo location: Panama. Ctrl-C to stop.`,
);
while (!stopped) {
  for (const record of records) {
    if (stopped) break;
    const h = header(record);
    const start = Date.now();
    const seq = sequence++;
    if (delay && seq > 0 && seq % delay === 0) {
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    const url = new URL("/api/stations/replay-panama/records", cfg.url);
    url.searchParams.set("session", session);
    url.searchParams.set("sequence", String(seq));
    url.searchParams.set("start", String(start));
    try {
      let sent = false;
      for (let attempt = 0; attempt < 3 && !sent; attempt++) {
        try {
          const res = await fetch(url, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${cfg.INGEST_TOKEN}`,
              "Content-Type": "application/vnd.fdsn.mseed",
            },
            body: record,
            signal: AbortSignal.timeout(10000),
          });
          if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
          sent = true;
        } catch (error) {
          if (attempt === 2) throw error;
          await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
        }
      }
      if (seq % 30 === 0)
        console.log(
          `Archived ${seq + 1} records; source ${new Date(h.start).toISOString()}`,
        );
    } catch (e) {
      console.error("Replay upload failed:", String(e));
      await new Promise((r) => setTimeout(r, 3000));
    }
    await new Promise((r) =>
      setTimeout(
        r,
        Math.max(
          0,
          (h.sampleCount / h.sampleRate) * 1000 - (Date.now() - start),
        ),
      ),
    );
  }
}
