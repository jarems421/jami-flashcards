import { deflateSync } from "node:zlib";

/**
 * Turning a scanned page into something a marker can look at.
 *
 * The criterion records — a scheme criterion, whether the examiner awarded it,
 * their reason, and the candidate's working — are the most valuable thing in
 * the corpus, and every one of them is a photograph of handwriting. Until a
 * marker can see the page, the question those records exist to answer cannot
 * be asked at all.
 *
 * No new dependency. The PDF reader already in the project hands back raw
 * pixels, and PNG is a container this can build directly: a header, one
 * zlib-compressed block of scanlines, an end marker. Adding a rendering
 * library to reach the same place would be a heavier commitment than the
 * fifty lines below.
 */

export type RgbImage = {
  width: number;
  height: number;
  /** Row-major, three bytes per pixel. */
  data: Uint8Array;
};

function chunk(type: string, body: Uint8Array) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length, 0);
  const typed = Buffer.concat([Buffer.from(type, "latin1"), Buffer.from(body)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed) >>> 0, 0);
  return Buffer.concat([length, typed, crc]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Reduce by an integer factor, averaging each block.
 *
 * A full page of handwriting at source resolution is a megabyte before
 * base64 inflates it by a third, and two candidates often share a page. This
 * trades detail the model does not need for a prompt that fits.
 */
export function downscale(image: RgbImage, factor: number): RgbImage {
  if (factor <= 1) return image;
  const width = Math.max(1, Math.floor(image.width / factor));
  const height = Math.max(1, Math.floor(image.height / factor));
  const data = new Uint8Array(width * height * 3);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let counted = 0;
      for (let dy = 0; dy < factor; dy += 1) {
        const sourceY = y * factor + dy;
        if (sourceY >= image.height) break;
        for (let dx = 0; dx < factor; dx += 1) {
          const sourceX = x * factor + dx;
          if (sourceX >= image.width) break;
          const offset = (sourceY * image.width + sourceX) * 3;
          red += image.data[offset];
          green += image.data[offset + 1];
          blue += image.data[offset + 2];
          counted += 1;
        }
      }
      const target = (y * width + x) * 3;
      data[target] = Math.round(red / counted);
      data[target + 1] = Math.round(green / counted);
      data[target + 2] = Math.round(blue / counted);
    }
  }
  return { width, height, data };
}

/** A PNG, as bytes. Truecolour, eight bits, no interlacing. */
export function encodePng(image: RgbImage): Buffer {
  const { width, height, data } = image;
  if (width <= 0 || height <= 0) throw new Error("Cannot encode an empty image.");
  if (data.length < width * height * 3) {
    throw new Error(`Image data is ${data.length} bytes, short of ${width * height * 3}.`);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  // Each scanline is prefixed with its filter byte; zero means "as stored",
  // which keeps this simple and compresses acceptably on scanned white paper.
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const from = y * width * 3;
    const to = y * (1 + width * 3);
    raw[to] = 0;
    Buffer.from(data.subarray(from, from + width * 3)).copy(raw, to + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

/**
 * Normalise whatever the PDF reader returns into plain RGB.
 *
 * Scanned pages arrive as RGB or as RGBA depending on how they were produced,
 * and greyscale scans arrive as a single channel. Guessing wrong produces an
 * image that looks like noise, so the shape is derived from the byte count
 * rather than assumed.
 */
export function toRgb(input: {
  width: number;
  height: number;
  data: Uint8Array;
}): RgbImage {
  const { width, height, data } = input;
  const pixels = width * height;
  if (pixels <= 0) throw new Error("Image has no pixels.");
  const channels = Math.round(data.length / pixels);

  if (channels === 3) return { width, height, data };
  const rgb = new Uint8Array(pixels * 3);

  if (channels === 4) {
    for (let index = 0; index < pixels; index += 1) {
      rgb[index * 3] = data[index * 4];
      rgb[index * 3 + 1] = data[index * 4 + 1];
      rgb[index * 3 + 2] = data[index * 4 + 2];
    }
    return { width, height, data: rgb };
  }
  if (channels === 1) {
    for (let index = 0; index < pixels; index += 1) {
      const value = data[index];
      rgb[index * 3] = value;
      rgb[index * 3 + 1] = value;
      rgb[index * 3 + 2] = value;
    }
    return { width, height, data: rgb };
  }
  throw new Error(`Unsupported image layout: ${data.length} bytes for ${pixels} pixels.`);
}
