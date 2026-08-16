import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { downscale, encodePng, toRgb } from "@/lib/evaluation/pdf-page-image";
import { parsePageReference } from "@/services/ai/scanned-page-loader.server";

const solid = (width: number, height: number, rgb: [number, number, number]) => {
  const data = new Uint8Array(width * height * 3);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 3] = rgb[0];
    data[index * 3 + 1] = rgb[1];
    data[index * 3 + 2] = rgb[2];
  }
  return { width, height, data };
};

describe("encoding a page as PNG", () => {
  it("writes a file a decoder would recognise", () => {
    const png = encodePng(solid(4, 3, [255, 0, 0]));
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.subarray(12, 16).toString("latin1")).toBe("IHDR");
    expect(png.subarray(-8, -4).toString("latin1")).toBe("IEND");
  });

  it("records the size and format in the header", () => {
    const png = encodePng(solid(7, 5, [1, 2, 3]));
    expect(png.readUInt32BE(16)).toBe(7);
    expect(png.readUInt32BE(20)).toBe(5);
    expect(png[24]).toBe(8); // eight bits per channel
    expect(png[25]).toBe(2); // truecolour
  });

  /**
   * The pixels have to survive the round trip. A PNG with a valid header and
   * scrambled contents looks fine to every check except the one that matters,
   * which is whether a marker can read the handwriting.
   */
  it("preserves the pixels through compression", () => {
    const image = solid(3, 2, [10, 20, 30]);
    image.data[0] = 200;
    const png = encodePng(image);

    const start = png.indexOf(Buffer.from("IDAT", "latin1")) + 4;
    const length = png.readUInt32BE(start - 8);
    const raw = inflateSync(png.subarray(start, start + length));

    // Each row carries a leading filter byte, which is not pixel data.
    expect(raw.length).toBe(2 * (1 + 3 * 3));
    expect(raw[0]).toBe(0);
    expect(raw[1]).toBe(200);
    expect(raw[2]).toBe(20);
  });

  it("refuses an image with no pixels or missing data", () => {
    expect(() => encodePng({ width: 0, height: 4, data: new Uint8Array() })).toThrow();
    expect(() => encodePng({ width: 4, height: 4, data: new Uint8Array(9) })).toThrow(/short of/);
  });
});

describe("normalising what the PDF reader returns", () => {
  it("passes plain RGB straight through", () => {
    const image = solid(2, 2, [5, 6, 7]);
    expect(toRgb(image).data).toBe(image.data);
  });

  it("drops the alpha channel", () => {
    const data = new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]);
    expect([...toRgb({ width: 2, height: 1, data }).data]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("spreads a greyscale scan across three channels", () => {
    const data = new Uint8Array([9, 200]);
    expect([...toRgb({ width: 2, height: 1, data }).data]).toEqual([9, 9, 9, 200, 200, 200]);
  });

  /** Guessing a layout produces an image that looks like noise. */
  it("refuses a layout it cannot identify", () => {
    expect(() => toRgb({ width: 2, height: 1, data: new Uint8Array(11) })).toThrow(/Unsupported/);
  });
});

describe("downscaling", () => {
  it("halves each dimension and averages the block", () => {
    const data = new Uint8Array([
      0, 0, 0, 100, 100, 100,
      200, 200, 200, 0, 0, 0,
    ]);
    const small = downscale({ width: 2, height: 2, data }, 2);
    expect(small.width).toBe(1);
    expect(small.height).toBe(1);
    expect([...small.data]).toEqual([75, 75, 75]);
  });

  it("leaves an image alone at factor one", () => {
    const image = solid(3, 3, [1, 1, 1]);
    expect(downscale(image, 1)).toBe(image);
  });

  it("never reduces a dimension below one pixel", () => {
    const small = downscale(solid(3, 3, [0, 0, 0]), 10);
    expect(small.width).toBe(1);
    expect(small.height).toBe(1);
  });
});

describe("reading a page reference", () => {
  it("understands a single page", () => {
    expect(parsePageReference("/scripts.pdf#page=4")).toEqual({
      file: "/scripts.pdf",
      firstPage: 4,
      lastPage: 4,
    });
  });

  it("understands a range", () => {
    expect(parsePageReference("/scripts.pdf#page=4-6")).toEqual({
      file: "/scripts.pdf",
      firstPage: 4,
      lastPage: 6,
    });
  });

  it("defaults to the first page when none is named", () => {
    expect(parsePageReference("/scripts.pdf")).toMatchObject({ firstPage: 1, lastPage: 1 });
  });

  it("keeps a Windows path intact", () => {
    expect(parsePageReference("C:\\data\\evidence.pdf#page=2").file).toBe("C:\\data\\evidence.pdf");
  });
});
