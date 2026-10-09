/**
 * Byte-level helpers for the stored ink encoding: a growable writer, a
 * bounds-checked reader, LEB128-style varints and base64url.
 *
 * Everything works on plain `Uint8Array` and string arithmetic, with no
 * `Buffer`, `btoa` or `atob`, so the same code runs in browsers and Node.
 */

/** Thrown by {@link ByteReader} on truncated or non-canonical input. */
export class InkBytesError extends Error {}

export class ByteWriter {
  private buffer = new Uint8Array(256);
  private length = 0;

  private reserve(extra: number): void {
    const needed = this.length + extra;
    if (needed <= this.buffer.length) return;
    let capacity = this.buffer.length;
    while (capacity < needed) capacity *= 2;
    const grown = new Uint8Array(capacity);
    grown.set(this.buffer.subarray(0, this.length));
    this.buffer = grown;
  }

  writeByte(value: number): void {
    this.reserve(1);
    this.buffer[this.length] = value;
    this.length += 1;
  }

  writeBytes(bytes: Uint8Array): void {
    this.reserve(bytes.length);
    this.buffer.set(bytes, this.length);
    this.length += bytes.length;
  }

  /** An unsigned safe integer as a little-endian base-128 varint. */
  writeVarint(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new InkBytesError(`Cannot write ${value} as an unsigned varint.`);
    }
    let rest = value;
    while (rest >= 128) {
      this.writeByte((rest % 128) | 128);
      rest = Math.floor(rest / 128);
    }
    this.writeByte(rest);
  }

  /** A signed safe integer, zigzag-mapped so small magnitudes stay short. */
  writeZigzag(value: number): void {
    if (!Number.isSafeInteger(value)) {
      throw new InkBytesError(`Cannot write ${value} as a signed varint.`);
    }
    this.writeVarint(value >= 0 ? value * 2 : -value * 2 - 1);
  }

  toBytes(): Uint8Array {
    return this.buffer.slice(0, this.length);
  }
}

/** At most 8 varint bytes covers every safe integer (56 bits). */
const MAX_VARINT_BYTES = 8;

export class ByteReader {
  private pos = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get remaining(): number {
    return this.bytes.length - this.pos;
  }

  readByte(): number {
    if (this.pos >= this.bytes.length) throw new InkBytesError("Unexpected end of data.");
    const value = this.bytes[this.pos];
    this.pos += 1;
    return value;
  }

  readBytes(count: number): Uint8Array {
    if (count < 0 || count > this.remaining) throw new InkBytesError("Unexpected end of data.");
    const slice = this.bytes.subarray(this.pos, this.pos + count);
    this.pos += count;
    return slice;
  }

  /** Rejects overlong encodings so every value has exactly one spelling. */
  readVarint(): number {
    let value = 0;
    let scale = 1;
    for (let i = 0; i < MAX_VARINT_BYTES; i += 1) {
      const byte = this.readByte();
      value += (byte & 127) * scale;
      if (!Number.isSafeInteger(value)) throw new InkBytesError("Varint is too large.");
      if ((byte & 128) === 0) {
        if (byte === 0 && i > 0) throw new InkBytesError("Varint is not canonical.");
        return value;
      }
      scale *= 128;
    }
    throw new InkBytesError("Varint is too long.");
  }

  readZigzag(): number {
    const unsigned = this.readVarint();
    return unsigned % 2 === 0 ? unsigned / 2 : -(unsigned + 1) / 2;
  }
}

const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Unpadded base64url. */
export function bytesToBase64Url(bytes: Uint8Array): string {
  const parts: string[] = [];
  let chunk = "";
  const flush = () => {
    parts.push(chunk);
    chunk = "";
  };
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    chunk += BASE64URL[n >> 18] + BASE64URL[(n >> 12) & 63] + BASE64URL[(n >> 6) & 63] + BASE64URL[n & 63];
    if (chunk.length >= 8192) flush();
  }
  if (bytes.length - i === 1) {
    const n = bytes[i] << 16;
    chunk += BASE64URL[n >> 18] + BASE64URL[(n >> 12) & 63];
  } else if (bytes.length - i === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    chunk += BASE64URL[n >> 18] + BASE64URL[(n >> 12) & 63] + BASE64URL[(n >> 6) & 63];
  }
  flush();
  return parts.join("");
}

const BASE64URL_LOOKUP = (() => {
  const table = new Int8Array(128).fill(-1);
  for (let i = 0; i < BASE64URL.length; i += 1) table[BASE64URL.charCodeAt(i)] = i;
  return table;
})();

function base64UrlValue(text: string, index: number): number {
  const code = text.charCodeAt(index);
  const value = code < 128 ? BASE64URL_LOOKUP[code] : -1;
  if (value < 0) throw new InkBytesError("Invalid base64url character.");
  return value;
}

/**
 * Strict unpadded base64url: only the URL alphabet, a valid length, and zero
 * bits in the unused tail, so each byte string has exactly one text form.
 * Throws {@link InkBytesError} on anything else.
 */
export function base64UrlToBytes(text: string): Uint8Array {
  const tail = text.length % 4;
  if (tail === 1) throw new InkBytesError("Invalid base64url length.");
  const fullGroups = Math.floor(text.length / 4);
  const out = new Uint8Array(fullGroups * 3 + (tail === 0 ? 0 : tail - 1));
  let o = 0;
  let t = 0;
  for (let g = 0; g < fullGroups; g += 1) {
    const n =
      (base64UrlValue(text, t) << 18) |
      (base64UrlValue(text, t + 1) << 12) |
      (base64UrlValue(text, t + 2) << 6) |
      base64UrlValue(text, t + 3);
    out[o] = n >> 16;
    out[o + 1] = (n >> 8) & 255;
    out[o + 2] = n & 255;
    o += 3;
    t += 4;
  }
  if (tail === 2) {
    const n = (base64UrlValue(text, t) << 6) | base64UrlValue(text, t + 1);
    if ((n & 15) !== 0) throw new InkBytesError("Non-zero padding bits.");
    out[o] = n >> 4;
  } else if (tail === 3) {
    const n =
      (base64UrlValue(text, t) << 12) |
      (base64UrlValue(text, t + 1) << 6) |
      base64UrlValue(text, t + 2);
    if ((n & 3) !== 0) throw new InkBytesError("Non-zero padding bits.");
    out[o] = n >> 10;
    out[o + 1] = (n >> 2) & 255;
  }
  return out;
}
