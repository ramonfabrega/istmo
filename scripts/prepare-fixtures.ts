import fs from "node:fs";
import { feature } from "topojson-client";
import { encodeInt32 } from "../shared/miniseed";
// seisplotjs registers a debug custom element even in its decoder dependency.
// These inert shims are used only by this Node fixture conversion utility.
Object.assign(globalThis, {
  HTMLElement: class {},
  customElements: {
    define() {},
    get() {
      return undefined;
    },
  },
});
const { parseDataRecords } =
  await import("../node_modules/seisplotjs/dist/miniseed.mjs");
const file = fs.readFileSync("fixtures/BW.BGLD.mseed");
const records = parseDataRecords(
  file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
);
const z = records.filter((r) => r.header.chanCode === "EHZ");
const output: Buffer[] = [];
for (const r of z) {
  const data = r.decompress(),
    rate = r.header.sampleRate;
  for (let offset = 0; offset < data.length; offset += rate) {
    const samples = Int32Array.from(data.slice(offset, offset + rate));
    output.push(
      Buffer.from(
        encodeInt32(
          samples,
          r.header.startTime.toMillis() + (offset / rate) * 1000,
          rate,
          "EHZ",
        ),
      ),
    );
  }
}
fs.writeFileSync("fixtures/replay.mseed", Buffer.concat(output));
const topology = JSON.parse(
  fs.readFileSync("node_modules/world-atlas/countries-10m.json", "utf8"),
);
fs.writeFileSync(
  "public/land.json",
  JSON.stringify(feature(topology, topology.objects.countries)),
);
console.log(
  `Prepared ${output.length} real waveform records and offline country geometry.`,
);
