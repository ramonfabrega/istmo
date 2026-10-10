import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { splitRecords } from "../shared/miniseed";
for (const path of ["fixtures/BW.BGLD.mseed", "fixtures/replay.mseed"]) {
  const file = fs.readFileSync(path);
  const buffer = file.buffer.slice(
    file.byteOffset,
    file.byteOffset + file.byteLength,
  );
  for (let i = 0; i < 20; i++) splitRecords(buffer);
  const samples: number[] = [];
  for (let i = 0; i < 100; i++) {
    const started = performance.now();
    splitRecords(buffer);
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      fixture: path,
      records: splitRecords(buffer).length,
      bytes: buffer.byteLength,
      medianMs: Number(samples[50].toFixed(3)),
      p95Ms: Number(samples[95].toFixed(3)),
    }),
  );
}
console.log(
  "Local framing + record-copy benchmark; excludes decoding, networking, storage and fan-out.",
);
