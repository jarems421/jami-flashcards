import JSZip from "jszip";
import type { Database, SqlJsStatic } from "sql.js";
import { buildAnkiCardDrafts, pickAnkiDeckName, type AnkiImportSummary, type AnkiNote } from "@/lib/study/import/anki-text";

export type AnkiPackageResult = AnkiImportSummary & {
  deckName: string;
  noteCount: number;
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
  /** Anki 2.1.50 and later compress the collection with zstd. */
  decompressZstd: (data: Uint8Array) => Uint8Array;
  /** Used when the package names no deck of its own, usually the file's name. */
  fallbackName: string;
};

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
    fields: String(fields ?? "").split(""),
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

/**
 * The cards in an Anki `.apkg` file.
 *
 * A package from Anki 2.1.50 or later holds its real collection compressed as
 * `collection.anki21b`, beside a legacy `collection.anki2` that contains only a
 * note asking the reader to update Anki. Reading the legacy file first imported
 * that note as the student's whole deck, so the compressed collection is
 * always preferred when it is there.
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
  try {
    const notes = readNotes(db);
    const summary = buildAnkiCardDrafts(notes);
    return {
      ...summary,
      noteCount: notes.length,
      deckName: pickAnkiDeckName(readDecks(db), readDeckCardCounts(db), dependencies.fallbackName),
    };
  } catch {
    throw new AnkiPackageError("The cards in this Anki deck could not be read. Try exporting it from Anki again.");
  } finally {
    db.close();
  }
}
