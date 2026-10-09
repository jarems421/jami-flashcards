import { describe, expect, it } from "vitest";
import { decodeInkDocument, encodeInkDocument, quantizeInkDocument } from "@/lib/ink/codec";
import { base64UrlToBytes, bytesToBase64Url } from "@/lib/ink/bytes";
import { emptyInkDocument, type InkDocument, type InkPathCommand } from "@/lib/ink/model";
import { formatSvgPathData } from "@/lib/ink/path";
import { docOf, lineShape, outline, randomInkDocument, seededRandom } from "./support/ink-fixtures";

function sampleDocument(): InkDocument {
  return {
    version: 3,
    items: [
      outline("a", [
        { op: "M", x: 10.3, y: 20.7 },
        { op: "C", x1: 12, y1: 22, x2: 14.1, y2: 25, x: 16, y: 30 },
        { op: "Q", x1: 20, y1: 31, x: 22, y: 29 },
        { op: "L", x: -5, y: 700.25 },
        { op: "Z" },
      ]),
      lineShape("b", 1, 2, 300, 400),
      {
        kind: "shape",
        id: "poly",
        layer: "pen",
        color: { r: 10, g: 20, b: 30, a: 0.5 },
        width: 3.3,
        shape: {
          type: "polygon",
          corners: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 50, y: 80 },
          ],
        },
      },
      {
        kind: "shape",
        id: "ell",
        layer: "pen",
        color: { r: 255, g: 0, b: 0, a: 1 },
        width: 2,
        shape: { type: "ellipse", cx: 450, cy: 600, rx: 120.5, ry: 60, rotation: -0.7 },
      },
    ],
  };
}

const wrap = (bytes: number[]) => "j3:" + bytesToBase64Url(Uint8Array.from(bytes));

describe("ink codec", () => {
  it("round-trips an empty document", () => {
    const text = encodeInkDocument(emptyInkDocument());
    expect(text.startsWith("j3:")).toBe(true);
    expect(decodeInkDocument(text)).toEqual(emptyInkDocument());
  });

  it("decodes to the quantised document", () => {
    const doc = sampleDocument();
    const decoded = decodeInkDocument(encodeInkDocument(doc));
    expect(decoded).toEqual(quantizeInkDocument(doc));
    const first = decoded?.items[0];
    // 10.3 and 20.7 snap to the nearest 1/16 page unit.
    expect(first?.kind === "outline" && first.path[0]).toEqual({ op: "M", x: 10.3125, y: 20.6875 });
  });

  it("is deterministic and canonical", () => {
    const text = encodeInkDocument(sampleDocument());
    expect(encodeInkDocument(sampleDocument())).toBe(text);
    const decoded = decodeInkDocument(text);
    expect(decoded && encodeInkDocument(decoded)).toBe(text);
  });

  it("round-trips a few hundred random documents", () => {
    const random = seededRandom(20261009);
    for (let i = 0; i < 300; i += 1) {
      const doc = randomInkDocument(random);
      const text = encodeInkDocument(doc);
      const decoded = decodeInkDocument(text);
      expect(decoded).toEqual(quantizeInkDocument(doc));
      expect(decoded && encodeInkDocument(decoded)).toBe(text);
    }
  });

  it("keeps non-ASCII ids", () => {
    const id = "héllo-✏";
    const doc = docOf(lineShape(id, 0, 0, 1, 1));
    expect(decodeInkDocument(encodeInkDocument(doc))?.items[0].id).toBe(id);
  });

  it("returns null for every truncation", () => {
    const text = encodeInkDocument(sampleDocument());
    for (let length = 0; length < text.length; length += 1) {
      expect(decodeInkDocument(text.slice(0, length))).toBeNull();
    }
  });

  it("never throws on mutated or random input, and accepts only canonical text", () => {
    const text = encodeInkDocument(sampleDocument());
    const random = seededRandom(7);
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    for (let i = 0; i < 2000; i += 1) {
      const at = 3 + Math.floor(random() * (text.length - 3));
      const mutated = text.slice(0, at) + alphabet[Math.floor(random() * 64)] + text.slice(at + 1);
      const decoded = decodeInkDocument(mutated);
      if (decoded) expect(encodeInkDocument(decoded)).toBe(mutated);
    }
    for (let i = 0; i < 500; i += 1) {
      let noise = "j3:";
      const length = Math.floor(random() * 60);
      for (let c = 0; c < length; c += 1) noise += alphabet[Math.floor(random() * 64)];
      expect(() => decodeInkDocument(noise)).not.toThrow();
    }
  });

  it("rejects the wrong prefix, version, padding and characters", () => {
    const text = encodeInkDocument(sampleDocument());
    expect(decodeInkDocument(text.slice(3))).toBeNull();
    expect(decodeInkDocument("j2:" + text.slice(3))).toBeNull();
    expect(decodeInkDocument(text + "=")).toBeNull();
    expect(decodeInkDocument(text + "+")).toBeNull();
    expect(decodeInkDocument(text + "A")).toBeNull();
    expect(decodeInkDocument("")).toBeNull();
    expect(decodeInkDocument(wrap([2, 0]))).toBeNull();
  });

  it("rejects unknown kinds, absurd counts and trailing bytes", () => {
    // version 3, one item of kind 9
    expect(decodeInkDocument(wrap([3, 1, 9, 1, 97, 1]))).toBeNull();
    // claims 100,000 items in a handful of bytes
    expect(decodeInkDocument(wrap([3, 0xa0, 0x8d, 0x06]))).toBeNull();
    // claims a million path commands in a few bytes
    expect(decodeInkDocument(wrap([3, 1, 1, 1, 97, 1, 0xc0, 0x84, 0x3d, 1]))).toBeNull();
    // a trailing byte after a valid empty document
    expect(decodeInkDocument(wrap([3, 0, 0]))).toBeNull();
    // a shape on the highlighter layer
    const shape = base64UrlToBytes(encodeInkDocument(docOf(lineShape("a", 0, 0, 1, 1))).slice(3));
    const patched = Uint8Array.from(shape);
    patched[5] = 0; // the layer byte follows the one-byte id
    expect(decodeInkDocument("j3:" + bytesToBase64Url(patched))).toBeNull();
  });

  it("rejects duplicate ids", () => {
    const doc = docOf(lineShape("a", 0, 0, 1, 1), lineShape("b", 0, 0, 1, 1));
    const bytes = Uint8Array.from(base64UrlToBytes(encodeInkDocument(doc).slice(3)));
    // The second id is the only byte equal to 'b' directly after an id length of 1.
    const at = Array.from(bytes).findIndex((byte, i) => byte === 98 && bytes[i - 1] === 1);
    expect(at).toBeGreaterThan(0);
    bytes[at] = 97;
    expect(decodeInkDocument("j3:" + bytesToBase64Url(bytes))).toBeNull();
  });

  it("rejects non-canonical varints", () => {
    // item count 1 written as 0x81 0x00
    expect(decodeInkDocument(wrap([3, 0x81, 0x00]))).toBeNull();
  });

  it("throws clear errors for documents it cannot store", () => {
    const tooMany: InkDocument = {
      version: 3,
      items: Array.from({ length: 50_001 }, (_, i) => lineShape(`i${i}`, 0, 0, 1, 1)),
    };
    expect(() => encodeInkDocument(tooMany)).toThrow(/50000 items/);
    expect(() => encodeInkDocument(docOf(lineShape("x".repeat(65), 0, 0, 1, 1)))).toThrow(/id/);
    expect(() => encodeInkDocument(docOf(lineShape("", 0, 0, 1, 1)))).toThrow(/id/);
    expect(() => encodeInkDocument(docOf(lineShape("a", Number.NaN, 0, 1, 1)))).toThrow(
      /cannot be stored/
    );
    expect(() => encodeInkDocument(docOf(lineShape("a", 1e12, 0, 1, 1)))).toThrow(/cannot be stored/);
    expect(() =>
      encodeInkDocument(docOf(lineShape("a", 0, 0, 1, 1), lineShape("a", 0, 0, 1, 1)))
    ).toThrow(/twice/);
  });

  it("stores a 2,000-segment path in well under 40% of its SVG length", () => {
    const random = seededRandom(99);
    const path: InkPathCommand[] = [{ op: "M", x: 400.123, y: 600.456 }];
    let x = 400.123;
    let y = 600.456;
    const step = () => (random() - 0.5) * 8;
    for (let i = 0; i < 2000; i += 1) {
      const c1 = { x: x + step(), y: y + step() };
      const c2 = { x: c1.x + step(), y: c1.y + step() };
      x = c2.x + step();
      y = c2.y + step();
      path.push({ op: "C", x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x, y });
    }
    const stored = encodeInkDocument(docOf(outline("long", path))).length;
    const svg = formatSvgPathData(path).length;
    expect(stored).toBeLessThan(svg * 0.4);
  });
});
