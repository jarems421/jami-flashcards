import { describe, expect, it } from "vitest";
import { base64UrlToBytes, ByteReader, ByteWriter, bytesToBase64Url } from "@/lib/ink/bytes";
import { seededRandom } from "./support/ink-fixtures";

describe("ink bytes", () => {
  it("round-trips varints and zigzags", () => {
    const writer = new ByteWriter();
    const unsigned = [0, 1, 127, 128, 300, 2 ** 31, 2 ** 40 + 5, Number.MAX_SAFE_INTEGER];
    const signed = [0, -1, 1, -64, 64, -(2 ** 30), 2 ** 30, -(2 ** 50)];
    unsigned.forEach((v) => writer.writeVarint(v));
    signed.forEach((v) => writer.writeZigzag(v));
    const reader = new ByteReader(writer.toBytes());
    unsigned.forEach((v) => expect(reader.readVarint()).toBe(v));
    signed.forEach((v) => expect(reader.readZigzag()).toBe(v));
    expect(reader.remaining).toBe(0);
  });

  it("refuses to write unsafe or negative varints", () => {
    expect(() => new ByteWriter().writeVarint(-1)).toThrow();
    expect(() => new ByteWriter().writeVarint(Number.NaN)).toThrow();
    expect(() => new ByteWriter().writeZigzag(2 ** 60)).toThrow();
  });

  it("rejects truncated, overlong and oversized varints", () => {
    expect(() => new ByteReader(Uint8Array.from([0x80])).readVarint()).toThrow();
    expect(() => new ByteReader(Uint8Array.from([0x80, 0x00])).readVarint()).toThrow();
    expect(() => new ByteReader(new Uint8Array(9).fill(0x80)).readVarint()).toThrow();
    const huge = Uint8Array.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f]);
    expect(() => new ByteReader(huge).readVarint()).toThrow();
  });

  it("matches the standard base64url for every length and round-trips", () => {
    const random = seededRandom(3);
    for (let length = 0; length < 70; length += 1) {
      const bytes = Uint8Array.from({ length }, () => Math.floor(random() * 256));
      const text = bytesToBase64Url(bytes);
      expect(text).toBe(Buffer.from(bytes).toString("base64url"));
      expect(Array.from(base64UrlToBytes(text))).toEqual(Array.from(bytes));
    }
  });

  it("encodes large inputs", () => {
    const bytes = new Uint8Array(200_000).map((_, i) => i % 251);
    expect(Array.from(base64UrlToBytes(bytesToBase64Url(bytes)))).toEqual(Array.from(bytes));
  });

  it("is strict about alphabet, length and padding bits", () => {
    expect(() => base64UrlToBytes("AAAAA")).toThrow();
    expect(() => base64UrlToBytes("AA+A")).toThrow();
    expect(() => base64UrlToBytes("AA==")).toThrow();
    expect(() => base64UrlToBytes("AB")).toThrow();
    expect(() => base64UrlToBytes("AAB")).toThrow();
    expect(() => base64UrlToBytes("é")).toThrow();
  });
});
