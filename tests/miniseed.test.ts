import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { header, splitRecords, encodeInt32 } from "../shared/miniseed";
describe("miniSEED transport", () => {
  it("walks every original compressed record without changing its bytes", () => {
    const input = fs.readFileSync("fixtures/BW.BGLD.mseed"),
      records = splitRecords(
        input.buffer.slice(
          input.byteOffset,
          input.byteOffset + input.byteLength,
        ),
      );
    expect(records.length).toBe(96);
    expect(header(records[0])).toMatchObject({
      sampleRate: 200,
      sampleCount: 4365,
      channel: "BW.BGLD..EHE",
      encoding: 11,
      length: 4096,
    });
    expect(
      Buffer.concat(records.map((x) => Buffer.from(x))).equals(input),
    ).toBe(true);
  });
  it("encodes exact signed counts and fractional timestamps", () => {
    const start = Date.parse("2026-10-09T17:56:05.125Z"),
      samples = Int32Array.from([-2147483648, -1, 0, 1, 2147483647]);
    const b = encodeInt32(samples, start, 200);
    expect(header(b)).toMatchObject({
      start,
      sampleRate: 200,
      sampleCount: 5,
      channel: "BW.BGLD..EHZ",
      encoding: 3,
    });
    expect(
      samples.every((x, i) => new DataView(b).getInt32(64 + i * 4) === x),
    ).toBe(true);
  });
  it("rejects truncated data and blockette cycles", () => {
    expect(() => header(new ArrayBuffer(12))).toThrow();
    const b = encodeInt32(new Int32Array(200), Date.now(), 200);
    expect(() => header(b.slice(0, 70))).toThrow();
    new DataView(b).setUint16(50, 48);
    expect(() => header(b)).toThrow(/blockette/);
  });
  it("retains source dates in replay records", () => {
    const b = fs.readFileSync("fixtures/replay.mseed"),
      r = splitRecords(
        b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
      );
    expect(r.length).toBeGreaterThan(600);
    expect(header(r[0]).start).toBe(Date.parse("2010-02-06T04:50:15Z"));
    expect(header(r[0]).sampleCount).toBe(200);
  });
});
