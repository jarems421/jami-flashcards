import JSZip from "jszip";
import type { Database, SqlJsStatic } from "sql.js";
import {
  isImageOcclusionNote,
  parseImageOcclusionNote,
  type AnkiDiagramDraft,
} from "@/lib/study/import/anki-occlusion";
import { buildAnkiCardDrafts, pickAnkiDeckName, type AnkiImportSummary, type AnkiNote } from "@/lib/study/import/anki-text";

/** An image occlusion note with its picture, ready to become a diagram. */
export type AnkiPackageDiagram = AnkiDiagramDraft & {
  image: { bytes: Uint8Array; mimeType: string };
};

export type AnkiPackageResult = AnkiImportSummary & {
  deckName: string;
  noteCount: number;
  diagrams: AnkiPackageDiagram[];
  /** Occlusion notes whose picture was not in the package, usually exported without media. */
  diagramsWithoutPicture: number;
};

/** A problem with the file itself, said the way a student can act on. */
export class AnkiPackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnkiPackageError";
  }
}

type Dependencies = {
  sql: SqlJsStatic;
  /** Anki 2.1.50 and later compress the collection, and its media, with zstd. */
  decompressZstd: (data: Uint8Array) => Uint8Array;
  /** Used when the package names no deck of its own, usually the file's name. */
  fallbackName: string;
};

/** More pictures than this in one import is a whole atlas, not a deck. */
export const MAX_IMPORTED_DIAGRAMS = 200;
const MAX_DIAGRAM_PICTURE_BYTES = 10 * 1024 * 1024;

function rows(db: Database, statement: string): unknown[][] {
  return db.exec(statement)[0]?.values ?? [];
}

function hasTable(db: Database, name: "decks") {
  return rows(db, `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${name}'`).length > 0;
}

function readNotes(db: Database): AnkiNote[] {
  const ordinals = new Map<number, number[]>();
  for (const [noteId, ordinal] of rows(db, "SELECT nid, ord FROM cards")) {
    const id = Number(noteId);
    ordinals.set(id, [...(ordinals.get(id) ?? []), Number(ordinal)]);
  }
  return rows(db, "SELECT id, flds FROM notes ORDER BY id").map(([id, fields]) => ({
    id: Number(id),
    fields: String(fields ?? "").split("\u001f"),
    cardOrdinals: ordinals.get(Number(id)) ?? [],
  }));
}

/** Deck names: their own table in newer collections, a JSON column in older ones. */
function readDecks(db: Database) {
  const decks = new Map<number, string>();
  if (hasTable(db, "decks")) {
    for (const [id, name] of rows(db, "SELECT id, name FROM decks")) decks.set(Number(id), String(name ?? ""));
    return decks;
  }
  const [json] = rows(db, "SELECT decks FROM col")[0] ?? [];
  try {
    const parsed = JSON.parse(String(json ?? "{}")) as Record<string, { name?: unknown }>;
    for (const [id, deck] of Object.entries(parsed)) {
      if (typeof deck?.name === "string") decks.set(Number(id), deck.name);
    }
  } catch {
    // A collection whose deck list cannot be read still has cards worth importing.
  }
  return decks;
}

function readDeckCardCounts(db: Database) {
  const counts = new Map<number, number>();
  for (const [deckId, count] of rows(db, "SELECT did, COUNT(*) FROM cards GROUP BY did")) {
    counts.set(Number(deckId), Number(count));
  }
  return counts;
}

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];

function isZstd(bytes: Uint8Array) {
  return ZSTD_MAGIC.every((value, index) => bytes[index] === value);
}

function readVarint(bytes: Uint8Array, start: number): [number, number] {
  let value = 0;
  let shift = 0;
  let offset = start;
  while (offset < bytes.length) {
    const byte = bytes[offset];
    offset += 1;
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return [value, offset];
    shift += 7;
  }
  throw new Error("Truncated varint");
}

/** Walks a protobuf message, handing each field to `visit`. Only the wire types Anki's media index uses. */
function readProtobuf(bytes: Uint8Array, visit: (field: number, value: number | Uint8Array) => void) {
  let offset = 0;
  while (offset < bytes.length) {
    const [key, afterKey] = readVarint(bytes, offset);
    const field = Math.floor(key / 8);
    const wireType = key % 8;
    if (wireType === 0) {
      const [value, next] = readVarint(bytes, afterKey);
      visit(field, value);
      offset = next;
    } else if (wireType === 2) {
      const [length, start] = readVarint(bytes, afterKey);
      visit(field, bytes.subarray(start, start + length));
      offset = start + length;
    } else if (wireType === 5) {
      offset = afterKey + 4;
    } else if (wireType === 1) {
      offset = afterKey + 8;
    } else {
      throw new Error("Unsupported protobuf wire type");
    }
  }
}

/**
 * Which file inside the package holds each media file, by its name in the notes.
 *
 * Older packages list them as JSON, `{"0": "heart.png"}`. Newer ones write a
 * zstd-compressed protobuf list whose position is the file inside the zip,
 * unless an entry names its own.
 */
function readMediaIndex(bytes: Uint8Array, decompress: (data: Uint8Array) => Uint8Array) {
  const index = new Map<string, string>();
  const text = new TextDecoder().decode(bytes);
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    for (const [entry, name] of Object.entries(parsed)) {
      if (typeof name === "string") index.set(name, entry);
    }
    return index;
  } catch {
    // Not JSON: the newer format.
  }
  const data = isZstd(bytes) ? decompress(bytes) : bytes;
  let position = 0;
  readProtobuf(data, (field, value) => {
    if (field !== 1 || !(value instanceof Uint8Array)) return;
    let name = "";
    let zipName: string | null = null;
    readProtobuf(value, (entryField, entryValue) => {
      if (entryField === 1 && entryValue instanceof Uint8Array) name = new TextDecoder().decode(entryValue);
      if (entryField === 255 && typeof entryValue === "number") zipName = String(entryValue);
    });
    if (name) index.set(name, zipName ?? String(position));
    position += 1;
  });
  return index;
}

function mimeTypeFor(name: string, bytes: Uint8Array) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57) return "image/webp";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif";
  const extension = name.split(".").pop()?.toLowerCase();
  return extension === "svg" ? "image/svg+xml" : `image/${extension === "jpg" ? "jpeg" : extension ?? "png"}`;
}

/**
 * The pictures the occlusion notes need, and only those.
 *
 * A deck exported with all its media can be hundreds of megabytes of pictures
 * the text cards never used, so nothing is read that no diagram points at.
 */
async function readDiagramPictures(
  zip: JSZip,
  drafts: readonly AnkiDiagramDraft[],
  decompress: (data: Uint8Array) => Uint8Array
) {
  const pictures = new Map<string, { bytes: Uint8Array; mimeType: string }>();
  const mediaFile = zip.file("media");
  if (!mediaFile || drafts.length === 0) return pictures;
  let index: Map<string, string>;
  try {
    index = readMediaIndex(await mediaFile.async("uint8array"), decompress);
  } catch {
    return pictures;
  }
  for (const name of new Set(drafts.map((draft) => draft.imageName))) {
    const entry = index.get(name);
    const file = entry ? zip.file(entry) : null;
    if (!file) continue;
    try {
      const raw = await file.async("uint8array");
      const bytes = isZstd(raw) ? decompress(raw) : raw;
      if (bytes.length === 0 || bytes.length > MAX_DIAGRAM_PICTURE_BYTES) continue;
      pictures.set(name, { bytes, mimeType: mimeTypeFor(name, bytes) });
    } catch {
      // One unreadable picture costs one diagram, not the import.
    }
  }
  return pictures;
}

/**
 * The cards in an Anki `.apkg` file.
 *
 * A package from Anki 2.1.50 or later holds its real collection compressed as
 * `collection.anki21b`, beside a legacy `collection.anki2` that contains only a
 * note asking the reader to update Anki. Reading the legacy file first imported
 * that note as the student's whole deck, so the compressed collection is
 * always preferred when it is there.
 *
 * Image occlusion notes are taken out before the text cards are built -- their
 * clozes are boxes, not words -- and come back as diagrams with their pictures.
 */
export async function readAnkiPackage(data: ArrayBuffer | Uint8Array, dependencies: Dependencies): Promise<AnkiPackageResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new AnkiPackageError("That file is not an Anki deck. In Anki, export the deck as an .apkg file and choose that.");
  }

  const modern = zip.file("collection.anki21b");
  const legacy = zip.file("collection.anki21") ?? zip.file("collection.anki2");
  let collection: Uint8Array;
  if (modern) {
    try {
      collection = dependencies.decompressZstd(await modern.async("uint8array"));
    } catch {
      throw new AnkiPackageError("This Anki deck could not be unpacked. Try exporting it from Anki again.");
    }
  } else if (legacy) {
    collection = await legacy.async("uint8array");
  } else {
    throw new AnkiPackageError("That file has no Anki cards inside. In Anki, export the deck as an .apkg file and choose that.");
  }

  let db: Database;
  try {
    db = new dependencies.sql.Database(collection);
  } catch {
    throw new AnkiPackageError("The cards in this Anki deck could not be read. Try exporting it from Anki again.");
  }
  let notes: AnkiNote[];
  let deckName: string;
  try {
    notes = readNotes(db);
    deckName = pickAnkiDeckName(readDecks(db), readDeckCardCounts(db), dependencies.fallbackName);
  } catch {
    throw new AnkiPackageError("The cards in this Anki deck could not be read. Try exporting it from Anki again.");
  } finally {
    db.close();
  }

  const textNotes = notes.filter((note) => !isImageOcclusionNote(note.fields));
  const drafts = notes
    .filter((note) => isImageOcclusionNote(note.fields))
    .map((note) => parseImageOcclusionNote(note.id, note.fields))
    .filter((draft): draft is AnkiDiagramDraft => draft !== null)
    .slice(0, MAX_IMPORTED_DIAGRAMS);
  const pictures = await readDiagramPictures(zip, drafts, dependencies.decompressZstd);
  const diagrams = drafts.flatMap((draft) => {
    const image = pictures.get(draft.imageName);
    return image ? [{ ...draft, image }] : [];
  });

  const summary = buildAnkiCardDrafts(textNotes);
  return {
    ...summary,
    noteCount: notes.length,
    deckName,
    diagrams,
    diagramsWithoutPicture: drafts.length - diagrams.length,
  };
}
