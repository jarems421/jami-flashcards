import { zstdCompressSync, zstdDecompressSync } from "node:zlib";
import JSZip from "jszip";
import initSqlJs from "sql.js";
import { describe, expect, it } from "vitest";
import { AnkiPackageError, readAnkiPackage } from "@/lib/study/import/anki-package";
import {
  buildAnkiCardDrafts,
  cleanAnkiField,
  clozeCards,
  MAX_DECK_IMPORT_CARDS,
  pickAnkiDeckName,
} from "@/lib/study/import/anki-text";

const SEPARATOR = "";

type FixtureNote = { id: number; fields: string[]; ordinals: number[]; deckId?: number };

/** A real Anki collection, written with the same SQLite build the app reads it with. */
async function collection(notes: FixtureNote[], layout: "legacy" | "modern") {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run("CREATE TABLE notes (id INTEGER PRIMARY KEY, mid INTEGER, flds TEXT)");
  db.run("CREATE TABLE cards (id INTEGER PRIMARY KEY, nid INTEGER, did INTEGER, ord INTEGER)");
  if (layout === "modern") {
    db.run("CREATE TABLE decks (id INTEGER PRIMARY KEY, name TEXT)");
    db.run("INSERT INTO decks VALUES (1, 'Default'), (2, ?)", [`Biology${SEPARATOR}Cells`]);
  } else {
    db.run("CREATE TABLE col (id INTEGER PRIMARY KEY, decks TEXT)");
    db.run("INSERT INTO col VALUES (1, ?)", [JSON.stringify({ 1: { name: "Default" }, 2: { name: "Biology::Cells" } })]);
  }
  for (const note of notes) {
    db.run("INSERT INTO notes VALUES (?, 1, ?)", [note.id, note.fields.join(SEPARATOR)]);
    note.ordinals.forEach((ordinal, index) =>
      db.run("INSERT INTO cards VALUES (?, ?, ?, ?)", [note.id * 10 + index, note.id, note.deckId ?? 2, ordinal])
    );
  }
  const bytes = db.export();
  db.close();
  return bytes;
}

const NOTES: FixtureNote[] = [
  { id: 1, fields: ["What is the <b>powerhouse</b> of the cell?", "Mitochondria &amp; ATP<br><img src='cell.png'>"], ordinals: [0] },
  { id: 2, fields: ["The {{c1::nucleus}} holds {{c2::DNA::genetic material}}", "Found in eukaryotes"], ordinals: [0, 1] },
  { id: 3, fields: ["Photosynthesis", "Light &rarr; glucose"], ordinals: [0, 1] },
  { id: 4, fields: ["<img src='only.png'>", "[sound:heart.mp3]"], ordinals: [0] },
  { id: 5, fields: ["What is the <b>powerhouse</b> of the cell?", "Mitochondria &amp; ATP"], ordinals: [0] },
];

async function sqlDependencies(fallbackName = "My deck") {
  return {
    sql: await initSqlJs(),
    decompressZstd: (data: Uint8Array) => new Uint8Array(zstdDecompressSync(data)),
    fallbackName,
  };
}

describe("reading an Anki package", () => {
  it("reads a package from older Anki versions", async () => {
    const zip = new JSZip();
    zip.file("collection.anki2", await collection(NOTES, "legacy"));
    zip.file("media", "{}");
    const result = await readAnkiPackage(await zip.generateAsync({ type: "uint8array" }), await sqlDependencies());

    expect(result.deckName).toBe("Biology › Cells");
    expect(result.noteCount).toBe(5);
    expect(result.cards).toEqual([
      { front: "What is the powerhouse of the cell?", back: "Mitochondria & ATP" },
      { front: "The [...] holds DNA", back: "nucleus\n\nFound in eukaryotes" },
      { front: "The nucleus holds [genetic material]", back: "DNA\n\nFound in eukaryotes" },
      { front: "Photosynthesis", back: "Light → glucose" },
      { front: "Light → glucose", back: "Photosynthesis" },
    ]);
    expect(result.skipped).toEqual({ empty: 1, tooLong: 0, duplicate: 1, overLimit: 0 });
    expect(result.mediaRemoved).toBe(3);
  });

  it("reads the compressed collection in a modern package, not the update-Anki stub beside it", async () => {
    const stub = await collection([{ id: 9, fields: ["Please update to the latest Anki version", "then import again"], ordinals: [0] }], "legacy");
    const zip = new JSZip();
    zip.file("collection.anki2", stub);
    zip.file("collection.anki21b", zstdCompressSync(await collection(NOTES, "modern")));
    const result = await readAnkiPackage(await zip.generateAsync({ type: "uint8array" }), await sqlDependencies());

    expect(result.deckName).toBe("Biology › Cells");
    expect(result.cards).toHaveLength(5);
    expect(result.cards.some((card) => card.front.includes("update"))).toBe(false);
  });

  it("says plainly when a file is not an Anki deck", async () => {
    await expect(readAnkiPackage(new TextEncoder().encode("not a zip"), await sqlDependencies())).rejects.toBeInstanceOf(
      AnkiPackageError
    );
    const empty = new JSZip();
    empty.file("readme.txt", "hello");
    await expect(
      readAnkiPackage(await empty.generateAsync({ type: "uint8array" }), await sqlDependencies())
    ).rejects.toThrow(/no Anki cards inside/);
  });
});

describe("Anki fields as card text", () => {
  it("keeps lines, bullets and escaped markup, and converts Anki maths", () => {
    expect(cleanAnkiField("<div>Steps:</div><ul><li>one</li><li>two</li></ul>").text).toBe("Steps:\n• one\n• two");
    expect(cleanAnkiField("Use &lt;b&gt; for bold &#8212; or &#x2014;").text).toBe("Use <b> for bold — or —");
    expect(cleanAnkiField("[$]x^2[/$] and [$$]\\frac{a}{b}[/$$]").text).toBe("\\(x^2\\) and \\[\\frac{a}{b}\\]");
    expect(cleanAnkiField("Heart [sound:beat.mp3] <img src='a.png'>")).toEqual({ text: "Heart", media: 2 });
  });

  it("makes one card per cloze number, hiding only that one", () => {
    expect(clozeCards("{{c1::Paris}} is in {{c2::France}}, like {{c1::Lyon}}")).toEqual([
      { front: "[...] is in France, like [...]", back: "Paris, Lyon" },
      { front: "Paris is in [...], like Lyon", back: "France" },
    ]);
  });

  it("stops at the import limit and counts the rest", () => {
    const notes = Array.from({ length: MAX_DECK_IMPORT_CARDS + 3 }, (_, index) => ({
      id: index,
      fields: [`Question ${index}`, `Answer ${index}`],
      cardOrdinals: [0],
    }));
    const summary = buildAnkiCardDrafts(notes);
    expect(summary.cards).toHaveLength(MAX_DECK_IMPORT_CARDS);
    expect(summary.skipped.overLimit).toBe(3);
  });

  it("names the deck for the cards, never Anki's Default, and for the parent of subdecks", () => {
    const decks = new Map([
      [1, "Default"],
      [2, "Spanish::Verbs"],
      [3, "Spanish::Nouns"],
    ]);
    expect(pickAnkiDeckName(decks, new Map([[1, 40]]), "spanish-export")).toBe("spanish-export");
    expect(pickAnkiDeckName(decks, new Map([[2, 10], [3, 5]]), "x")).toBe("Spanish");
    expect(pickAnkiDeckName(decks, new Map([[3, 5]]), "x")).toBe("Spanish › Nouns");
  });
});
