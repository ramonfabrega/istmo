import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import { header, splitRecords, encodeInt32 } from "../shared/miniseed";
describe("miniSEED transport", () => {
  it("walks every original compressed record without changing its bytes", () => {
    const input = fs.readFileSync("fixtures/BW.BGLD.mseed");
    const records = splitRecords(
      input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength),
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
    const start = Date.parse("2026-10-09T17:56:05.125Z");
    const samples = Int32Array.from([-2147483648, -1, 0, 1, 2147483647]);
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
    const b = fs.readFileSync("fixtures/replay.mseed");
    const r = splitRecords(
      b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
    );
    expect(r.length).toBeGreaterThan(600);
    expect(header(r[0]).start).toBe(Date.parse("2010-02-06T04:50:15Z"));
    expect(header(r[0]).sampleCount).toBe(200);
  });
});

describe("miniSEED boundary validation", () => {
  afterEach(() => vi.unstubAllGlobals());
  const record = () =>
    encodeInt32(new Int32Array(20), Date.parse("2025-01-01T00:00:00Z"), 200);
  it("rejects blockettes that overlap sample data or disagree with the header count", () => {
    const overlap = record();
    new DataView(overlap).setUint16(44, 52);
    expect(() => header(overlap)).toThrow(/blockette/);
    const wrongCount = record();
    new Uint8Array(wrongCount)[39] = 2;
    expect(() => header(wrongCount)).toThrow(/count/);
  });
  it("rejects non-leap day 366, invalid fractions, and short int32 payloads", () => {
    for (const [field, value] of [
      [22, 366],
      [28, 10000],
      [30, 200],
    ]) {
      const bytes = record();
      new DataView(bytes).setUint16(field, value);
      expect(() => header(bytes)).toThrow();
    }
  });
  it("applies unapplied time correction and signed blockette microseconds", () => {
    const bytes = record();
    const view = new DataView(bytes);
    const start = header(bytes).start;
    new Uint8Array(bytes)[39] = 2;
    view.setUint16(50, 56);
    view.setUint16(56, 1001);
    view.setInt8(61, -50);
    view.setInt32(40, 10000);
    expect(header(bytes).start).toBe(start + 1000 - 0.05);
    new Uint8Array(bytes)[36] = 2;
    expect(header(bytes).start).toBe(start - 0.05);
  });
  it("reads fixed headers in little endian", () => {
    const bytes = record();
    const view = new DataView(bytes);
    for (const offset of [20, 22, 28, 30, 32, 34, 44, 46, 48, 50])
      view.setUint16(offset, view.getUint16(offset), true);
    view.setInt32(40, view.getInt32(40), true);
    expect(header(bytes)).toMatchObject({
      sampleRate: 200,
      sampleCount: 20,
      encoding: 3,
    });
  });
  it("reads a record at an offset and rejects invalid encoder inputs", () => {
    const bytes = record();
    const combined = new Uint8Array(bytes.byteLength * 2);
    combined.set(new Uint8Array(bytes));
    combined.set(new Uint8Array(bytes), bytes.byteLength);
    expect(header(combined.buffer, bytes.byteLength)).toEqual(header(bytes));
    expect(() => header(bytes, -1)).toThrow();
    expect(() => encodeInt32(new Int32Array(1), NaN, 200)).toThrow();
    expect(() => encodeInt32(new Int32Array(1), 1e20, 200)).toThrow();
    expect(() =>
      encodeInt32(new Int32Array(1), Date.now(), 200, "!?"),
    ).toThrow();
  });
  it("round-trips replay counts through the independent seisplotjs decoder", async () => {
    // seisplotjs shares its debug element with the Node entry point.
    vi.stubGlobal("HTMLElement", class {});
    vi.stubGlobal("customElements", { define() {}, get() {} });
    const { miniseed } = await import("seisplotjs/nodeonly");
    const { parseDataRecords } = miniseed;
    const samples = Int32Array.from([-2147483648, -1, 0, 1, 2147483647]);
    const records = parseDataRecords(
      encodeInt32(samples, Date.parse("2026-10-10T05:00:00.125Z"), 200),
    );
    expect(Array.from(records[0].decompress())).toEqual(Array.from(samples));
    expect(records[0].header.startTime.toMillis()).toBe(
      Date.parse("2026-10-10T05:00:00.125Z"),
    );
  });
});
