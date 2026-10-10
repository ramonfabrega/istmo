// miniSEED 2 fixed section + blockette 1000. Preserve encoded payloads unchanged.
export interface RecordHeader {
  start: number;
  sampleRate: number;
  sampleCount: number;
  channel: string;
  length: number;
  encoding: number;
}
export function header(buffer: ArrayBuffer): RecordHeader {
  if (buffer.byteLength < 48) throw new Error("Truncated miniSEED record");
  const v = new DataView(buffer),
    bytes = new Uint8Array(buffer);
  const text = (a: number, b: number) =>
    new TextDecoder().decode(bytes.slice(a, b)).trim();
  if (
    !/^[0-9 ]{6}$/.test(text(0, 6)) ||
    !["D", "R", "Q", "M"].includes(text(6, 7))
  )
    throw new Error("Expected miniSEED 2 data record");
  let little = false;
  let year = v.getUint16(20),
    day = v.getUint16(22);
  if (year < 1900 || year > 2200) {
    little = true;
    year = v.getUint16(20, true);
    day = v.getUint16(22, true);
  }
  const u16 = (n: number) => v.getUint16(n, little),
    i16 = (n: number) => v.getInt16(n, little);
  if (
    year < 1900 ||
    year > 2200 ||
    day < 1 ||
    day > 366 ||
    bytes[24] > 23 ||
    bytes[25] > 59 ||
    bytes[26] > 60
  )
    throw new Error("Invalid miniSEED timestamp");
  let start =
    Date.UTC(year, 0, day, bytes[24], bytes[25], bytes[26]) + u16(28) / 10;
  if (!(bytes[36] & 2)) start += v.getInt32(40, little) / 10;
  const factor = i16(32),
    mult = i16(34);
  let sampleRate =
    (factor > 0 ? factor : factor < 0 ? -1 / factor : 0) *
    (mult > 0 ? mult : mult < 0 ? -1 / mult : 0);
  let block = u16(46),
    length = 0,
    encoding = -1,
    count = 0;
  const seen = new Set<number>();
  while (block && count++ < 32) {
    if (seen.has(block) || block < 48 || block + 8 > buffer.byteLength)
      throw new Error("Invalid miniSEED blockette");
    seen.add(block);
    const type = u16(block);
    if (type === 1000) {
      const exp = bytes[block + 6];
      if (exp < 8 || exp > 20) throw new Error("Invalid record length");
      length = 2 ** exp;
      encoding = bytes[block + 4];
    }
    if (type === 100 && block + 12 <= buffer.byteLength)
      sampleRate = v.getFloat32(block + 4, little);
    if (type === 1001) start += v.getInt8(block + 5) / 1000;
    block = u16(block + 2);
  }
  const sampleCount = u16(30);
  if (
    !length ||
    length > buffer.byteLength ||
    u16(44) < 48 ||
    u16(44) >= length ||
    !sampleCount ||
    sampleRate <= 0 ||
    !Number.isFinite(sampleRate)
  )
    throw new Error("Unsupported or incomplete miniSEED record");
  return {
    start,
    sampleRate,
    sampleCount,
    channel: `${text(18, 20)}.${text(8, 13)}.${text(13, 15)}.${text(15, 18)}`,
    length,
    encoding,
  };
}
export function splitRecords(buffer: ArrayBuffer): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  let offset = 0;
  while (offset < buffer.byteLength) {
    const h = header(buffer.slice(offset));
    out.push(buffer.slice(offset, offset + h.length));
    offset += h.length;
  }
  return out;
}
// A small standards-compliant uncompressed encoder for deterministic replay/test records.
export function encodeInt32(
  samples: Int32Array,
  start: number,
  sampleRate: number,
  channel = "EHZ",
): ArrayBuffer {
  if (
    !samples.length ||
    samples.length > 16000 ||
    !Number.isInteger(sampleRate) ||
    sampleRate < 1 ||
    sampleRate > 32767
  )
    throw new Error("Unsupported replay samples");
  const exp = Math.max(8, Math.ceil(Math.log2(64 + samples.length * 4))),
    b = new ArrayBuffer(2 ** exp),
    v = new DataView(b),
    u = new Uint8Array(b),
    d = new Date(start);
  u.set(
    new TextEncoder().encode(
      "000001D BGLD   " + channel.padEnd(3).slice(0, 3) + "BW",
    ),
  );
  v.setUint16(20, d.getUTCFullYear());
  v.setUint16(
    22,
    Math.floor(
      (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) -
        Date.UTC(d.getUTCFullYear(), 0, 1)) /
        86400000,
    ) + 1,
  );
  u[24] = d.getUTCHours();
  u[25] = d.getUTCMinutes();
  u[26] = d.getUTCSeconds();
  v.setUint16(28, d.getUTCMilliseconds() * 10);
  v.setUint16(30, samples.length);
  v.setInt16(32, sampleRate);
  v.setInt16(34, 1);
  u[39] = 1;
  v.setUint16(44, 64);
  v.setUint16(46, 48);
  v.setUint16(48, 1000);
  u[52] = 3;
  u[53] = 1;
  u[54] = exp;
  samples.forEach((x, i) => v.setInt32(64 + i * 4, x));
  return b;
}
