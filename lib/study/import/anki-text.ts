import {
  getCardContentKey,
  MAX_BACK_LENGTH,
  MAX_FRONT_LENGTH,
  normalizeCardContentInput,
  type ImportedCardDraft,
} from "@/lib/study/cards";

/**
 * Turning the notes inside an Anki deck into Jami cards.
 *
 * Kept free of zip files, SQLite and workers so every rule here -- how HTML
 * becomes text, how a cloze becomes cards, what is skipped and why -- can be
 * tested directly. `anki-package.ts` reads the file and hands the notes over.
 */

/** A deck larger than this is almost always a shared mega-deck; importing it all at once is not what anyone wants. */
export const MAX_DECK_IMPORT_CARDS = 5_000;

export type AnkiNote = {
  id: number;
  /** The note's fields as Anki stores them: HTML, in the note type's order. */
  fields: string[];
  /** The template ordinal of each card the note produced; 1 marks a reversed card on a Basic note. */
  cardOrdinals: number[];
};

export type AnkiImportSkips = {
  /** Nothing left once images and sounds were taken out, or a side was blank. */
  empty: number;
  /** Longer than a card allows. */
  tooLong: number;
  /** The same question and answer as a card already in the import. */
  duplicate: number;
  /** Past the most cards one import takes. */
  overLimit: number;
};

export type AnkiImportSummary = {
  cards: ImportedCardDraft[];
  skipped: AnkiImportSkips;
  /** Images and sound references taken out of the text, which Jami does not import. */
  mediaRemoved: number;
};

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  times: "×",
  divide: "÷",
  minus: "−",
  plusmn: "±",
  deg: "°",
  le: "≤",
  ge: "≥",
  ne: "≠",
  middot: "·",
  rarr: "→",
  larr: "←",
  harr: "↔",
  uarr: "↑",
  darr: "↓",
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  theta: "θ",
  lambda: "λ",
  mu: "μ",
  pi: "π",
  sigma: "σ",
  omega: "ω",
  Delta: "Δ",
  Sigma: "Σ",
  Omega: "Ω",
  sup2: "²",
  sup3: "³",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
  euro: "€",
  pound: "£",
  copy: "©",
  reg: "®",
  trade: "™",
};

export function decodeHtmlEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, code: string) => {
    if (code.startsWith("#")) {
      const value = /^#x/i.test(code) ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(value) && value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : match;
    }
    return NAMED_ENTITIES[code] ?? match;
  });
}

/**
 * One Anki field as plain card text.
 *
 * Anki stores fields as HTML. Line breaks and blocks become new lines, list
 * items keep a bullet, entities are decoded after the tags are gone so an
 * escaped `&lt;b&gt;` stays as the text a student wrote, and Anki's own maths
 * markup becomes the `\( \)` Jami's cards render.
 */
export function cleanAnkiField(html: string) {
  let media = 0;
  const countMedia = () => {
    media += 1;
    return "";
  };
  const text = html
    .replace(/\[sound:[^\]]*\]/gi, countMedia)
    .replace(/<img\b[^>]*>/gi, countMedia)
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/\[\$\$\]([\s\S]*?)\[\/\$\$\]/g, "\\[$1\\]")
    .replace(/\[\$\]([\s\S]*?)\[\/\$\]/g, "\\($1\\)")
    .replace(/\[latex\]([\s\S]*?)\[\/latex\]/gi, "\\($1\\)")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n• ")
    .replace(/<\/(?:div|p|h[1-6]|tr|ul|ol|blockquote)>/gi, "\n")
    .replace(/<[^>]*>/g, "");
  const cleaned = decodeHtmlEntities(text)
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    // A list straight after a block keeps its bullets on the next line, not after a gap.
    .replace(/\n{2,}(?=• )/g, "\n")
    .trim();
  return { text: cleaned, media };
}

const CLOZE_PATTERN = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;
const HAS_CLOZE = /\{\{c\d+::/;

/**
 * The cards a cloze note makes: one per cloze number, the way Anki shows it.
 *
 * `{{c1::Paris}} is the capital of {{c2::France}}` is two cards. On each, the
 * cloze being tested is hidden -- as its hint, if it has one -- and the others
 * are shown as their answers. The note's second field, Anki's "Extra", goes on
 * the back under the answer.
 */
export function clozeCards(text: string, extra = "") {
  const numbers = [...new Set([...text.matchAll(CLOZE_PATTERN)].map((match) => Number(match[1])))].sort(
    (left, right) => left - right
  );
  return numbers.map((number) => {
    const answers: string[] = [];
    const front = text.replace(CLOZE_PATTERN, (_match, cloze: string, answer: string, hint?: string) => {
      if (Number(cloze) !== number) return answer;
      answers.push(answer);
      return hint ? `[${hint}]` : "[...]";
    });
    return { front, back: [answers.join(", "), extra].filter(Boolean).join("\n\n") };
  });
}

/** Every card the notes make, with what was left out counted rather than lost silently. */
export function buildAnkiCardDrafts(notes: readonly AnkiNote[]): AnkiImportSummary {
  const cards: ImportedCardDraft[] = [];
  const seen = new Set<string>();
  const skipped: AnkiImportSkips = { empty: 0, tooLong: 0, duplicate: 0, overLimit: 0 };
  let mediaRemoved = 0;

  const add = (rawFront: string, rawBack: string) => {
    const front = normalizeCardContentInput(rawFront);
    const back = normalizeCardContentInput(rawBack);
    if (!front || !back) {
      skipped.empty += 1;
      return;
    }
    if (front.length > MAX_FRONT_LENGTH || back.length > MAX_BACK_LENGTH) {
      skipped.tooLong += 1;
      return;
    }
    const key = getCardContentKey(front, back);
    if (seen.has(key)) {
      skipped.duplicate += 1;
      return;
    }
    if (cards.length >= MAX_DECK_IMPORT_CARDS) {
      skipped.overLimit += 1;
      return;
    }
    seen.add(key);
    cards.push({ front, back });
  };

  for (const note of notes) {
    const [first = "", second = ""] = note.fields.map((field) => {
      const cleaned = cleanAnkiField(field);
      mediaRemoved += cleaned.media;
      return cleaned.text;
    });
    if (HAS_CLOZE.test(first)) {
      for (const card of clozeCards(first, second)) add(card.front, card.back);
      continue;
    }
    add(first, second);
    // "Basic (and reversed card)" gives a note a second card, asked the other way round.
    if (note.cardOrdinals.includes(1)) add(second, first);
  }
  return { cards, skipped, mediaRemoved };
}

/** Anki names subdecks `Parent::Child`, and newer collections separate them with a unit separator. */
export function ankiDeckDisplayName(name: string) {
  return name
    .split(/::|/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" › ");
}

/**
 * A name for the imported deck, from the deck the cards came from.
 *
 * Anki's own "Default" deck is never the name anyone meant. A package holding
 * one deck and its subdecks is named for the deck they share.
 */
export function pickAnkiDeckName(
  decks: ReadonlyMap<number, string>,
  cardCountsByDeck: ReadonlyMap<number, number>,
  fallback: string
) {
  const named = [...cardCountsByDeck]
    .filter(([id]) => decks.has(id))
    .sort((left, right) => right[1] - left[1])
    .map(([id]) => decks.get(id)!.trim())
    .filter((name) => name && name !== "Default");
  if (named.length === 0) return fallback.trim() || "Imported deck";
  const roots = new Set(named.map((name) => name.split(/::|/)[0]!.trim()));
  if (named.length > 1 && roots.size === 1) return ankiDeckDisplayName([...roots][0]!);
  return ankiDeckDisplayName(named[0]!);
}
