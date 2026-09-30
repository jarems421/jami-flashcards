import { zstdCompressSync, zstdDecompressSync } from "node:zlib";
import JSZip from "jszip";
import initSqlJs from "sql.js";
import { describe, expect, it } from "vitest";
import { readAnkiPackage } from "@/lib/study/import/anki-package";
import {
  ankiDraftToLabels,
  isImageOcclusionNote,
  parseImageOcclusionNote,
} from "@/lib/study/import/anki-occlusion";

const SEPARATOR = "\u001f";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

/** A stock Anki image occlusion note: occlusions, picture, header, back extra, comments. */
const OCCLUSION_FIELDS = [
  "{{c1::image-occlusion:rect:left=.2934:top=.1734:width=.1049:height=.0591:oi=1}}" +
    "{{c1::image-occlusion:rect:left=.6:top=.1:width=.1:height=.05:oi=1}}" +
    "{{c2::image-occlusion:ellipse:left=.4:top=.5:rx=.05:ry=.04:oi=1}}" +
    "{{c3::image-occlusion:polygon:points=.1,.6 .3,.6 .2,.8:oi=1}}" +
    "{{c4::image-occlusion:text:left=.1:top=.1:text=Heart:scale=1}}",
  '<img src="heart%20diagram.png">',
  "The <b>heart</b>",
  "Anterior view",
  "",
];

describe("reading an Anki image occlusion note", () => {
  it("is recognised by its occlusions", () => {
    expect(isImageOcclusionNote(OCCLUSION_FIELDS)).toBe(true);
    expect(isImageOcclusionNote(["Question", "Answer"])).toBe(false);
  });

  it("makes one label per cloze number, with every shape of it", () => {
    const draft = parseImageOcclusionNote(7, OCCLUSION_FIELDS)!;
    expect(draft.imageName).toBe("heart diagram.png");
    expect(draft.header).toBe("The heart");
    expect(draft.note).toBe("Anterior view");
    expect(draft.hideOthers).toBe(true);
    expect(draft.labels.map((entry) => [entry.ordinal, entry.shapes.map((shape) => shape.kind)])).toEqual([
      [1, ["rect", "rect"]],
      [2, ["ellipse"]],
      [3, ["polygon"]],
    ]);
    // An ellipse's radii become its box.
    expect(draft.labels[1].shapes[0]).toMatchObject({ x: 0.4, y: 0.5, width: 0.1, height: 0.08 });
  });

  it("reads 'hide one, guess one' notes as hiding one", () => {
    const fields = [OCCLUSION_FIELDS[0].replaceAll(":oi=1", ""), ...OCCLUSION_FIELDS.slice(1)];
    expect(parseImageOcclusionNote(1, fields)!.hideOthers).toBe(false);
  });

  it("needs a picture and something to ask", () => {
    expect(parseImageOcclusionNote(1, [OCCLUSION_FIELDS[0], "no picture"])).toBeNull();
    expect(parseImageOcclusionNote(1, ["{{c1::image-occlusion:text:text=hi}}", OCCLUSION_FIELDS[1]])).toBeNull();
  });

  it("turns fractions into labels as they are, and pixels into fractions", () => {
    let id = 0;
    const next = () => `l${(id += 1)}`;
    const draft = parseImageOcclusionNote(1, OCCLUSION_FIELDS)!;
    const labels = ankiDraftToLabels(draft, 1000, 800, next);
    expect(labels).toHaveLength(3);
    expect(labels[0]).toMatchObject({ answer: "", note: "Anterior view" });
    expect(labels[0].shapes[0]).toMatchObject({ x: 0.2934, y: 0.1734 });
    expect(labels[2].shapes[0].points).toHaveLength(3);

    const inPixels = parseImageOcclusionNote(2, [
      "{{c1::image-occlusion:rect:left=200:top=80:width=100:height=40}}",
      '<img src="a.png">',
    ])!;
    expect(ankiDraftToLabels(inPixels, 1000, 800, next)[0].shapes[0]).toMatchObject({ x: 0.2, y: 0.1, width: 0.1, height: 0.05 });
  });
});

/** A small protobuf writer for the newer media index, as Anki writes it. */
function varint(value: number) {
  const bytes: number[] = [];
  let rest = value;
  while (rest > 0x7f) {
    bytes.push((rest & 0x7f) | 0x80);
    rest = Math.floor(rest / 128);
  }
  bytes.push(rest);
  return bytes;
}

function mediaEntries(names: string[]) {
  const bytes: number[] = [];
  for (const name of names) {
    const encoded = [...new TextEncoder().encode(name)];
    const entry = [0x0a, ...varint(encoded.length), ...encoded, 0x10, ...varint(12)];
    bytes.push(0x0a, ...varint(entry.length), ...entry);
  }
  return new Uint8Array(bytes);
}

async function packageWith(layout: "legacy" | "modern") {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run("CREATE TABLE notes (id INTEGER PRIMARY KEY, mid INTEGER, flds TEXT)");
  db.run("CREATE TABLE cards (id INTEGER PRIMARY KEY, nid INTEGER, did INTEGER, ord INTEGER)");
  db.run("CREATE TABLE decks (id INTEGER PRIMARY KEY, name TEXT)");
  db.run("INSERT INTO decks VALUES (2, 'Anatomy')");
  db.run("INSERT INTO notes VALUES (1, 1, ?)", ["What is ATP?" + SEPARATOR + "Energy"]);
  db.run("INSERT INTO cards VALUES (10, 1, 2, 0)");
  db.run("INSERT INTO notes VALUES (2, 2, ?)", [OCCLUSION_FIELDS.join(SEPARATOR)]);
  db.run("INSERT INTO cards VALUES (20, 2, 2, 0), (21, 2, 2, 1), (22, 2, 2, 2)");
  // An occlusion note whose picture was left out of the export.
  db.run("INSERT INTO notes VALUES (3, 2, ?)", [[OCCLUSION_FIELDS[0], '<img src="missing.png">', "", "", ""].join(SEPARATOR)]);
  const collection = db.export();
  db.close();

  const zip = new JSZip();
  if (layout === "modern") {
    zip.file("collection.anki21b", zstdCompressSync(collection));
    zip.file("media", zstdCompressSync(mediaEntries(["cell.png", "heart diagram.png"])));
    zip.file("0", zstdCompressSync(new Uint8Array([9, 9, 9])));
    zip.file("1", zstdCompressSync(PNG));
  } else {
    zip.file("collection.anki2", collection);
    zip.file("media", JSON.stringify({ 0: "heart diagram.png" }));
    zip.file("0", PNG);
  }
  return zip.generateAsync({ type: "uint8array" });
}

async function dependencies() {
  return {
    sql: await initSqlJs(),
    decompressZstd: (data: Uint8Array) => new Uint8Array(zstdDecompressSync(data)),
    fallbackName: "Deck",
  };
}

describe("importing image occlusion from a package", () => {
  for (const layout of ["legacy", "modern"] as const) {
    it(`finds the diagram and its picture in a ${layout} package, and keeps it out of the text cards`, async () => {
      const result = await readAnkiPackage(await packageWith(layout), await dependencies());
      expect(result.cards).toEqual([{ front: "What is ATP?", back: "Energy" }]);
      expect(result.diagrams).toHaveLength(1);
      expect(result.diagrams[0].header).toBe("The heart");
      expect(result.diagrams[0].image.mimeType).toBe("image/png");
      expect([...result.diagrams[0].image.bytes]).toEqual([...PNG]);
      expect(result.diagramsWithoutPicture).toBe(1);
    });
  }
});
