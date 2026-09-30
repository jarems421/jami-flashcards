/**
 * The shape of a long source: which lecture, week or chapter each part is.
 *
 * A student's lecture pack is often one file holding a whole module -- fourteen
 * lectures, three hundred slides. Searching it by meaning alone finds passages
 * that sound like the question, which is not the same as the part of the pack
 * the student is asking about: "in lecture 4, why does..." should read lecture
 * 4. This works out the pack's own divisions from its headings, so the index
 * can label every passage with the part it came from and Tutor can go straight
 * to the part a student names.
 *
 * Only the source's own headings are used -- the lecture titles its author
 * wrote. Nothing is inferred about the subject, and nothing here is stored as
 * learner data: the outline lives beside the source's server-only index.
 *
 * Pure: extraction, storage and retrieval happen elsewhere.
 */

export type SourceSectionKind =
  | "lecture"
  | "week"
  | "chapter"
  | "unit"
  | "module"
  | "session"
  | "topic"
  | "lesson"
  | "seminar"
  | "tutorial"
  | "workshop"
  | "lab"
  | "practical"
  | "class"
  | "part"
  /** An unnumbered top-level heading, used only when a document has no numbered divisions. */
  | "heading";

/** What a source's page numbers count. */
export type SourcePageKind = "page" | "slide";

export type SourceSection = {
  /** `${kind}:${number}`, stable across rebuilds of the same file. */
  key: string;
  kind: SourceSectionKind;
  number: number;
  title?: string;
  /** "Lecture 4: Entropy", or the heading itself for an unnumbered one. */
  label: string;
  pageStart?: number;
  pageEnd?: number;
  chunkStart: number;
  chunkEnd: number;
};

export type SourceOutline = {
  sourceId: string;
  pageKind: SourcePageKind;
  sections: SourceSection[];
  chunkCount: number;
  /**
   * The first and last page of every indexed passage, by chunk index, so a
   * student's "slide 12" finds its passage without a search. Zero where a
   * passage has no page (a Word document or a webpage). Two flat arrays,
   * because Firestore cannot store an array of arrays.
   */
  chunkPageStarts: number[];
  chunkPageEnds: number[];
};

/** A page of extracted text, with whatever structure the extractor could keep. */
export type OutlinePage = {
  pageNumber?: number;
  heading?: string;
  /** 1 for a document's top-level heading. Only structured documents have one. */
  headingLevel?: number;
  text: string;
};

export type SourceSectionReference = { kind: Exclude<SourceSectionKind, "heading">; number: number };
export type SourcePageReference = { start: number; end: number };
export type SourceReferences = {
  sections: SourceSectionReference[];
  pages: SourcePageReference[];
};

export const MAX_OUTLINE_SECTIONS = 120;
/** Passages read straight from a named part of a source, per source, per question. */
export const MAX_TARGETED_CHUNKS = 24;
const MAX_TITLE_LENGTH = 90;

/** Preferred when two kinds are equally common, e.g. a pack headed "Week 3 · Lecture 5". */
const KIND_PRIORITY: readonly Exclude<SourceSectionKind, "heading">[] = [
  "lecture",
  "chapter",
  "week",
  "unit",
  "module",
  "session",
  "lesson",
  "topic",
  "seminar",
  "tutorial",
  "workshop",
  "lab",
  "practical",
  "class",
  "part",
];

const KIND_ALIASES: Record<string, Exclude<SourceSectionKind, "heading">> = {
  lecture: "lecture",
  lectures: "lecture",
  lect: "lecture",
  lec: "lecture",
  week: "week",
  weeks: "week",
  wk: "week",
  chapter: "chapter",
  chapters: "chapter",
  chap: "chapter",
  ch: "chapter",
  unit: "unit",
  units: "unit",
  module: "module",
  modules: "module",
  session: "session",
  sessions: "session",
  topic: "topic",
  topics: "topic",
  lesson: "lesson",
  lessons: "lesson",
  seminar: "seminar",
  seminars: "seminar",
  tutorial: "tutorial",
  tutorials: "tutorial",
  tut: "tutorial",
  workshop: "workshop",
  workshops: "workshop",
  lab: "lab",
  labs: "lab",
  practical: "practical",
  practicals: "practical",
  class: "class",
  classes: "class",
  part: "part",
  parts: "part",
};

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};

const ORDINAL_WORDS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
  eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13,
  fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17,
  eighteenth: 18, nineteenth: 19, twentieth: 20,
};

const KIND_PATTERN =
  "lectures?|lect|lec|weeks?|wk|chapters?|chap|ch|units?|modules?|sessions?|topics?|lessons?|seminars?|tutorials?|tut|workshops?|labs?|practicals?|class(?:es)?|parts?";
const NUMBER_WORD_PATTERN = Object.keys(NUMBER_WORDS).join("|");

function parseRoman(value: string) {
  const upper = value.toUpperCase();
  if (!/^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/.test(upper)) return null;
  const values: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let total = 0;
  for (let index = 0; index < upper.length; index += 1) {
    const current = values[upper[index]];
    const next = values[upper[index + 1]] ?? 0;
    total += current < next ? -current : current;
  }
  return total > 0 && total <= 100 ? total : null;
}

function parseNumberToken(token: string, allowRoman: boolean) {
  const lower = token.toLowerCase();
  if (/^\d{1,3}$/.test(lower)) {
    const value = Number(lower);
    return value >= 0 && value <= 300 ? value : null;
  }
  if (lower in NUMBER_WORDS) return NUMBER_WORDS[lower];
  return allowRoman ? parseRoman(token) : null;
}

function cleanTitle(value: string | undefined) {
  if (!value) return undefined;
  const title = value
    .replace(/\s+/g, " ")
    .replace(/^[\s:.\-–—|)(,·•/]+/, "")
    .replace(/[\s:.\-–—|,(·•/]+$/, "")
    .trim();
  if (!title || title.length < 2 || !/\p{L}/u.test(title)) return undefined;
  return title.length > MAX_TITLE_LENGTH
    ? `${title.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`
    : title;
}

const MARKER_PATTERN = new RegExp(
  // An optional course code first ("PHYS1001 Lecture 4"), then the division.
  `^\\s*(?:#{1,6}\\s*)?(?:[A-Z]{2,5}\\s?-?\\d{3,5}[A-Z]?\\b[\\s:\\-–—|,]*)?(${KIND_PATTERN})\\.?\\s*(?:no\\.?\\s*|#\\s*)?(\\d{1,3}|${NUMBER_WORD_PATTERN}|[ivxlcIVXLC]{1,7})(?:\\.\\d{1,2})?\\b(.*)$`,
  "i"
);

/**
 * A heading that opens a numbered division: "Lecture 4: Entropy",
 * "WEEK 3 - Enzymes", "PHYS1001 Lecture 12", "Chapter IV". Null for anything
 * else, including "Recap of lecture 3", which mentions a lecture without
 * starting one.
 */
export function parseSectionMarker(line: string): {
  kind: Exclude<SourceSectionKind, "heading">;
  number: number;
  title?: string;
} | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 200) return null;
  const match = trimmed.match(MARKER_PATTERN);
  if (!match) return null;
  const kind = KIND_ALIASES[match[1].toLowerCase()];
  if (!kind) return null;
  const number = parseNumberToken(match[2], true);
  if (number === null) return null;
  const rest = match[3] ?? "";
  // "Lecture 4 was about..." is prose, not a heading.
  if (/^\s+(?:was|is|we|you|will|covered|covers|looked|introduced|showed|and|of)\b/i.test(rest)) {
    return null;
  }
  const title = cleanTitle(rest);
  return title ? { kind, number, title } : { kind, number };
}

function nonEmptyLines(text: string) {
  return text.split(/\n/).map((line) => line.trim()).filter(Boolean);
}

/** The lines a page's heading could be on: its detected heading and its first few lines. */
function headingCandidates(page: OutlinePage) {
  const lines = nonEmptyLines(page.text).slice(0, 3);
  return Array.from(new Set([page.heading?.trim(), ...lines].filter((line): line is string => Boolean(line))));
}

function markersOnLine(line: string) {
  const first = parseSectionMarker(line);
  if (!first) return [];
  // "Week 3 · Lecture 5: Enzymes" names two divisions; keep both so the more
  // common one can be chosen as the pack's own structure.
  const second = first.title ? parseSectionMarker(first.title) : null;
  if (second?.title) {
    // The first division's title is then the second one's.
    return [{ kind: first.kind, number: first.number, title: second.title }, second];
  }
  // "Lecture 4: Topic 4" is a lecture titled "Topic 4" as much as a topic.
  return second ? [first, second] : [first];
}

function capitalise(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatSectionLabel(section: Pick<SourceSection, "kind" | "number" | "title">) {
  if (section.kind === "heading") return section.title ?? `Section ${section.number}`;
  const name = `${capitalise(section.kind)} ${section.number}`;
  return section.title ? `${name}: ${section.title}` : name;
}

export type DetectedOutline = {
  sections: Omit<SourceSection, "chunkStart" | "chunkEnd">[];
  /** The section each page belongs to, by page position; undefined before the first. */
  pageSectionKeys: (string | undefined)[];
};

/**
 * Works out a source's divisions from its own headings.
 *
 * The division kind used is the one the source numbers most -- a pack whose
 * slides say "Week 2" in a footer and "Lecture 3" in a title is divided by
 * lecture if it has more lectures than weeks. A page listing three or more of
 * them is a contents page and starts nothing. A division already seen does not
 * start again, so a "Lecture 3 recap" slide inside lecture 4 stays in lecture 4.
 *
 * A structured document with no numbered divisions (a Word file headed by
 * topic) is divided at its top-level headings instead.
 */
export function detectSourceOutline(pages: readonly OutlinePage[]): DetectedOutline {
  const pageMarkers = pages.map((page) => {
    const allLineMarkers = nonEmptyLines(page.text).flatMap(markersOnLine);
    const distinctByKind = new Map<string, Set<number>>();
    for (const marker of allLineMarkers) {
      const set = distinctByKind.get(marker.kind) ?? new Set<number>();
      set.add(marker.number);
      distinctByKind.set(marker.kind, set);
    }
    const contentsKinds = new Set(
      [...distinctByKind].filter(([, numbers]) => numbers.size >= 3).map(([kind]) => kind)
    );
    const candidates = headingCandidates(page).flatMap(markersOnLine);
    return { candidates, contentsKinds };
  });

  const distinctByKind = new Map<Exclude<SourceSectionKind, "heading">, Set<number>>();
  pageMarkers.forEach(({ candidates, contentsKinds }) => {
    for (const marker of candidates) {
      if (contentsKinds.has(marker.kind)) continue;
      const set = distinctByKind.get(marker.kind) ?? new Set<number>();
      set.add(marker.number);
      distinctByKind.set(marker.kind, set);
    }
  });
  const primaryKind = KIND_PRIORITY
    .filter((kind) => (distinctByKind.get(kind)?.size ?? 0) >= 2)
    .sort(
      (left, right) =>
        (distinctByKind.get(right)?.size ?? 0) - (distinctByKind.get(left)?.size ?? 0) ||
        KIND_PRIORITY.indexOf(left) - KIND_PRIORITY.indexOf(right)
    )[0];

  const sections: DetectedOutline["sections"] = [];
  const pageSectionKeys: (string | undefined)[] = [];

  if (primaryKind) {
    const seen = new Set<number>();
    let current: DetectedOutline["sections"][number] | null = null;
    pages.forEach((page, index) => {
      const { candidates, contentsKinds } = pageMarkers[index];
      const marker = contentsKinds.has(primaryKind)
        ? undefined
        : candidates.find((candidate) => candidate.kind === primaryKind);
      if (
        marker &&
        marker.number !== current?.number &&
        !seen.has(marker.number) &&
        sections.length < MAX_OUTLINE_SECTIONS
      ) {
        seen.add(marker.number);
        const lines = headingCandidates(page);
        const markerLineIndex = lines.findIndex((line) =>
          markersOnLine(line).some(
            (found) => found.kind === primaryKind && found.number === marker.number
          )
        );
        const followingLine = markerLineIndex >= 0 ? lines[markerLineIndex + 1] : undefined;
        const title =
          marker.title ??
          (followingLine && !parseSectionMarker(followingLine) && followingLine.length <= MAX_TITLE_LENGTH
            ? cleanTitle(followingLine)
            : undefined);
        current = {
          key: `${primaryKind}:${marker.number}`,
          kind: primaryKind,
          number: marker.number,
          ...(title ? { title } : {}),
          label: formatSectionLabel({ kind: primaryKind, number: marker.number, title }),
          ...(page.pageNumber !== undefined
            ? { pageStart: page.pageNumber, pageEnd: page.pageNumber }
            : {}),
        };
        sections.push(current);
      } else if (current && page.pageNumber !== undefined) {
        current.pageEnd = page.pageNumber;
      }
      pageSectionKeys.push(current?.key);
    });
    return { sections, pageSectionKeys };
  }

  const topLevel = pages.filter((page) => page.headingLevel === 1 && cleanTitle(page.heading));
  if (topLevel.length >= 2 && topLevel.length <= MAX_OUTLINE_SECTIONS) {
    let current: DetectedOutline["sections"][number] | null = null;
    pages.forEach((page) => {
      const title = page.headingLevel === 1 ? cleanTitle(page.heading) : undefined;
      if (title) {
        const number = sections.length + 1;
        current = {
          key: `heading:${number}`,
          kind: "heading",
          number,
          title,
          label: title,
          ...(page.pageNumber !== undefined
            ? { pageStart: page.pageNumber, pageEnd: page.pageNumber }
            : {}),
        };
        sections.push(current);
      } else if (current && page.pageNumber !== undefined) {
        current.pageEnd = page.pageNumber;
      }
      pageSectionKeys.push(current?.key);
    });
    return { sections, pageSectionKeys };
  }

  return { sections: [], pageSectionKeys: pages.map(() => undefined) };
}

/** Adds each section's passage range once the source has been cut into passages. */
export function attachSectionChunkRanges(
  sections: DetectedOutline["sections"],
  chunks: readonly { chunkIndex: number; sectionKey?: string }[]
): SourceSection[] {
  return sections.flatMap((section) => {
    const indexes = chunks
      .filter((chunk) => chunk.sectionKey === section.key)
      .map((chunk) => chunk.chunkIndex);
    if (indexes.length === 0) return [];
    return [{ ...section, chunkStart: Math.min(...indexes), chunkEnd: Math.max(...indexes) }];
  });
}

// ---------------------------------------------------------------------------
// What the student is pointing at.
// ---------------------------------------------------------------------------

const REFERENCE_PATTERN = new RegExp(
  `\\b(${KIND_PATTERN})\\.?\\s*(?:no\\.?\\s*|#\\s*)?(\\d{1,3}|${NUMBER_WORD_PATTERN})\\b((?:\\s*(?:-|–|to|and|&|,|or)\\s*(?:\\d{1,3})\\b)*)`,
  "gi"
);
const ORDINAL_REFERENCE_PATTERN = new RegExp(
  `\\b(\\d{1,2}(?:st|nd|rd|th)|${Object.keys(ORDINAL_WORDS).join("|")})\\s+(${KIND_PATTERN})\\b`,
  "gi"
);
/** "L4", "W3": only in capitals, where they are shorthand rather than a word. */
const SHORTHAND_REFERENCE_PATTERN = /\b([LW])\s?(\d{1,2})\b/g;
const PAGE_REFERENCE_PATTERN =
  /\b(?:slides?|pages?|pp?\.|pg\.?)\s*(\d{1,4})(?:\s*(?:-|–|to)\s*(\d{1,4}))?/gi;

const MAX_SECTION_REFERENCES = 6;
const MAX_PAGE_REFERENCES = 4;
const MAX_PAGE_RANGE = 40;

/**
 * The parts of their material a student names: "lecture 4", "lectures 3 and
 * 5", "L4", "the fourth lecture", "week 3", "slides 12-15", "p. 30".
 */
export function findSourceReferences(text: string): SourceReferences {
  const sections: SourceSectionReference[] = [];
  const pages: SourcePageReference[] = [];
  const addSection = (kind: SourceSectionReference["kind"] | undefined, number: number | null) => {
    if (!kind || number === null || number <= 0) return;
    if (sections.some((entry) => entry.kind === kind && entry.number === number)) return;
    if (sections.length < MAX_SECTION_REFERENCES) sections.push({ kind, number });
  };

  for (const match of text.matchAll(REFERENCE_PATTERN)) {
    const kind = KIND_ALIASES[match[1].toLowerCase()];
    const first = parseNumberToken(match[2], false);
    addSection(kind, first);
    const tail = match[3] ?? "";
    const rangeMatch = tail.match(/^\s*(?:-|–|to)\s*(\d{1,3})/);
    if (rangeMatch && first !== null) {
      const end = Number(rangeMatch[1]);
      for (let value = first + 1; value <= end && value - first <= 6; value += 1) addSection(kind, value);
    }
    for (const extra of tail.matchAll(/(?:and|&|,|or)\s*(\d{1,3})\b/g)) {
      addSection(kind, Number(extra[1]));
    }
  }
  for (const match of text.matchAll(ORDINAL_REFERENCE_PATTERN)) {
    const token = match[1].toLowerCase();
    const number = /^\d/.test(token) ? Number.parseInt(token, 10) : ORDINAL_WORDS[token] ?? null;
    addSection(KIND_ALIASES[match[2].toLowerCase()], number);
  }
  for (const match of text.matchAll(SHORTHAND_REFERENCE_PATTERN)) {
    addSection(match[1] === "L" ? "lecture" : "week", Number(match[2]));
  }
  for (const match of text.matchAll(PAGE_REFERENCE_PATTERN)) {
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : start;
    if (start <= 0 || end < start || end - start > MAX_PAGE_RANGE) continue;
    if (pages.length < MAX_PAGE_REFERENCES) pages.push({ start, end });
  }
  return { sections, pages };
}

export function hasSourceReferences(references: SourceReferences) {
  return references.sections.length > 0 || references.pages.length > 0;
}

const TITLE_MARKER_PATTERN = new RegExp(
  `(?:^|[^a-z])(${KIND_PATTERN}|l|w)[\\s_\\-.]*0*(\\d{1,3})(?![\\d])`,
  "gi"
);

/**
 * Whether a source's own title names a part the student asked about: a folder
 * of separate files called "Lecture 4 - Entropy.pdf", "Lec04_slides",
 * "L4 Thermodynamics" or "Week 3 notes".
 */
export function sourceTitleMatchesReferences(title: string, references: SourceReferences) {
  if (references.sections.length === 0) return false;
  for (const match of title.matchAll(TITLE_MARKER_PATTERN)) {
    const token = match[1].toLowerCase();
    const kind = token === "l" ? "lecture" : token === "w" ? "week" : KIND_ALIASES[token];
    const number = Number(match[2]);
    if (references.sections.some((entry) => entry.kind === kind && entry.number === number)) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Resolving a question against one source's outline.
// ---------------------------------------------------------------------------

const TITLE_STOPWORDS = new Set([
  "about", "after", "again", "also", "because", "before", "being", "between",
  "could", "does", "doing", "explain", "from", "have", "help", "into", "just",
  "lecture", "lectures", "like", "make", "more", "notes", "only", "other",
  "over", "part", "please", "really", "same", "should", "show", "slide",
  "slides", "some", "such", "tell", "than", "that", "their", "them", "then",
  "there", "these", "they", "thing", "things", "this", "those", "through",
  "understand", "under", "very", "want", "week", "what", "when", "where",
  "which", "while", "will", "with", "work", "would", "your", "introduction",
  "overview", "summary", "review", "revision", "recap", "chapter", "topic",
  "unit", "module", "session", "lesson", "basics", "concepts", "question",
  "questions", "answer", "example", "examples", "mean", "means", "meaning",
  "change", "changes", "different", "difference", "effect", "effects",
  "important", "general", "applications", "application", "part", "parts",
]);

function contentWords(text: string) {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
      .split(/[\s-]+/)
      .filter((word) => word.length >= 4 && !TITLE_STOPWORDS.has(word))
      .map((word) => (word.length > 5 && word.endsWith("s") ? word.slice(0, -1) : word))
  );
}

/**
 * Sections whose own title the question is plainly about: "how does the
 * Krebs cycle work" in a pack with a lecture titled "The Krebs Cycle".
 * Deliberately strict -- a loose match would pull in a lecture that merely
 * shares a word -- and never more than two.
 */
export function matchSectionsByTitle(sections: readonly SourceSection[], question: string) {
  const asked = contentWords(question);
  if (asked.size === 0) return [];
  const scored = sections
    .flatMap((section) => {
      if (!section.title) return [];
      const titleWords = [...contentWords(section.title)];
      if (titleWords.length === 0) return [];
      const matched = titleWords.filter((word) => asked.has(word)).length;
      const coverage = matched / titleWords.length;
      // One shared word is enough only when it is the whole title.
      const strong = matched >= 2 || (matched === 1 && titleWords.length === 1);
      return strong && coverage >= 0.5 ? [{ section, score: coverage + matched / 10, matched }] : [];
    })
    .sort((left, right) => right.score - left.score);
  const best = scored[0]?.score ?? 0;
  // A one-word title that happens to be in the question ("Temperature") does
  // not ride along with a lecture the question names in full.
  return scored
    .filter((entry) => entry.score === best || entry.matched >= 2)
    .slice(0, 2)
    .map((entry) => entry.section);
}

export type OutlineTargets = {
  /** Passages to read straight from the index, in reading order. */
  chunkIndexes: number[];
  /** The sections the student named or plainly asked about. */
  sections: SourceSection[];
  /** Divisions the student named that this source does not have ("lecture 15" of 14). */
  missing: SourceSectionReference[];
  /** How the targets were found, for the prompt and logs. */
  via: "named" | "pages" | "title" | "none";
};

/**
 * The passages a question points at in one source.
 *
 * Named divisions come first, then pages. Title matching is used only when
 * the question names nothing, since a student who says "lecture 4" means it.
 */
export function resolveOutlineTargets(
  outline: SourceOutline,
  references: SourceReferences,
  question: string,
  options: { allowTitleMatch?: boolean } = {}
): OutlineTargets {
  const chunkIndexes = new Set<number>();
  const sections: SourceSection[] = [];
  const missing: SourceSectionReference[] = [];
  const outlineKinds = new Set(outline.sections.map((section) => section.kind));

  for (const reference of references.sections) {
    const section = outline.sections.find(
      (entry) => entry.kind === reference.kind && entry.number === reference.number
    );
    if (section) {
      sections.push(section);
    } else if (outlineKinds.has(reference.kind)) {
      missing.push(reference);
    }
  }
  const addRange = (start: number, end: number) => {
    for (let index = start; index <= end && chunkIndexes.size < MAX_TARGETED_CHUNKS; index += 1) {
      chunkIndexes.add(index);
    }
  };
  sections.forEach((section) => addRange(section.chunkStart, section.chunkEnd));
  let via: OutlineTargets["via"] = sections.length > 0 ? "named" : "none";

  if (references.pages.length > 0) {
    for (const range of references.pages) {
      for (let index = 0; index < outline.chunkCount; index += 1) {
        const start = outline.chunkPageStarts[index] ?? 0;
        const end = outline.chunkPageEnds[index] || start;
        if (start > 0 && start <= range.end && end >= range.start) addRange(index, index);
      }
    }
    if (via === "none" && chunkIndexes.size > 0) via = "pages";
  }

  if (
    via === "none" &&
    options.allowTitleMatch !== false &&
    references.sections.length === 0
  ) {
    const matched = matchSectionsByTitle(outline.sections, question);
    matched.forEach((section) => {
      sections.push(section);
      addRange(section.chunkStart, section.chunkEnd);
    });
    if (matched.length > 0) via = "title";
  }

  return {
    chunkIndexes: [...chunkIndexes].sort((left, right) => left - right),
    sections,
    missing,
    via,
  };
}

// ---------------------------------------------------------------------------
// Reading and describing.
// ---------------------------------------------------------------------------

export function describePageRange(
  start: number | undefined,
  end: number | undefined,
  pageKind: SourcePageKind = "page"
) {
  if (!start) return "";
  const last = end && end > start ? end : undefined;
  if (pageKind === "slide") return last ? `slides ${start}–${last}` : `slide ${start}`;
  return last ? `pp. ${start}–${last}` : `p. ${start}`;
}

const MAX_OUTLINE_LINES_IN_PROMPT = 60;

/**
 * The source's contents list as Tutor reads it, so it knows the shape of a
 * long pack even when only a few passages from it are in front of it.
 */
export function formatSourceOutline(
  outline: SourceOutline,
  targets?: Pick<OutlineTargets, "sections" | "missing" | "via">
) {
  if (outline.sections.length < 2) {
    return targets?.missing.length ? formatMissing(targets.missing, outline) : "";
  }
  const targeted = new Set(targets?.sections.map((section) => section.key) ?? []);
  const lines = outline.sections.slice(0, MAX_OUTLINE_LINES_IN_PROMPT).map((section) => {
    const where = describePageRange(section.pageStart, section.pageEnd, outline.pageKind);
    return `- ${section.label}${where ? ` (${where})` : ""}${targeted.has(section.key) ? "  <- asked about" : ""}`;
  });
  if (outline.sections.length > MAX_OUTLINE_LINES_IN_PROMPT) {
    lines.push(`- …and ${outline.sections.length - MAX_OUTLINE_LINES_IN_PROMPT} more`);
  }
  const header =
    "Contents of this source, from its own headings. Use it to know which part of the student's material a passage comes from and to point them to the right part:";
  const focus =
    targets?.via === "named" && targets.sections.length > 0
      ? `The student asked about ${targets.sections.map((section) => section.label).join(" and ")}; the passages below include that part in reading order. Answer from it first.`
      : targets?.via === "title" && targets.sections.length > 0
        ? `The question matches ${targets.sections.map((section) => section.label).join(" and ")}; passages from that part are included below.`
        : "";
  return [header, ...lines, focus, targets?.missing.length ? formatMissing(targets.missing, outline) : ""]
    .filter(Boolean)
    .join("\n");
}

function formatMissing(missing: readonly SourceSectionReference[], outline: SourceOutline) {
  const named = missing.map((entry) => `${capitalise(entry.kind)} ${entry.number}`).join(", ");
  const numbered = outline.sections.filter((section) => section.kind === missing[0]?.kind);
  const name = numbered[0] ? capitalise(numbered[0].kind) : "";
  const range = numbered.length > 0
    ? ` It runs from ${name} ${Math.min(...numbered.map((s) => s.number))} to ${name} ${Math.max(...numbered.map((s) => s.number))}.`
    : "";
  return `The student mentioned ${named}, which this source does not contain.${range} Say so briefly rather than guessing which part they meant.`;
}

function isSectionKind(value: unknown): value is SourceSectionKind {
  return (
    typeof value === "string" &&
    (value === "heading" || (value in KIND_ALIASES && KIND_ALIASES[value] === value))
  );
}

function finiteNonNegative(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : undefined;
}

/** Reads a stored outline defensively; null when it is not one. */
export function normalizeSourceOutline(sourceId: string, value: unknown): SourceOutline | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const chunkCount = finiteNonNegative(data.chunkCount) ?? 0;
  const numbers = (input: unknown) =>
    Array.isArray(input)
      ? input.slice(0, chunkCount).map((entry) => finiteNonNegative(entry) ?? 0)
      : [];
  const sections = Array.isArray(data.sections)
    ? data.sections.slice(0, MAX_OUTLINE_SECTIONS).flatMap((entry): SourceSection[] => {
        if (!entry || typeof entry !== "object") return [];
        const section = entry as Record<string, unknown>;
        const number = finiteNonNegative(section.number);
        const chunkStart = finiteNonNegative(section.chunkStart);
        const chunkEnd = finiteNonNegative(section.chunkEnd);
        if (!isSectionKind(section.kind) || number === undefined || chunkStart === undefined || chunkEnd === undefined) {
          return [];
        }
        const title = typeof section.title === "string" ? cleanTitle(section.title) : undefined;
        const pageStart = finiteNonNegative(section.pageStart);
        const pageEnd = finiteNonNegative(section.pageEnd);
        return [{
          key: `${section.kind}:${number}`,
          kind: section.kind,
          number,
          ...(title ? { title } : {}),
          label: formatSectionLabel({ kind: section.kind, number, title }),
          ...(pageStart ? { pageStart } : {}),
          ...(pageEnd ? { pageEnd } : {}),
          chunkStart,
          chunkEnd: Math.max(chunkStart, chunkEnd),
        }];
      })
    : [];
  return {
    sourceId,
    pageKind: data.pageKind === "slide" ? "slide" : "page",
    sections,
    chunkCount,
    chunkPageStarts: numbers(data.chunkPageStarts),
    chunkPageEnds: numbers(data.chunkPageEnds),
  };
}

// ---------------------------------------------------------------------------
// The search query for a turn.
// ---------------------------------------------------------------------------

const FOLLOW_UP_PATTERN =
  /\b(it|its|that|this|those|these|them|they|again|more|above|previous|same|next|another|else|further|why|how come|example|simpler|elaborate|expand)\b/i;

function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * What to search a student's sources for on this turn, and what to look for
 * lecture or page references in.
 *
 * "Can you explain that more simply?" says nothing searchable on its own; the
 * question it follows does. A short or pointing follow-up is searched together
 * with the student's previous question, and a lecture named there still counts.
 * A new, self-contained question is searched on its own, so a thread that has
 * moved on is not dragged back to where it started.
 */
export function buildSourceRetrievalQuery(input: {
  message: string;
  currentText?: string;
  history?: readonly { role: "user" | "model"; text: string }[];
}) {
  const message = input.message.trim();
  const previousUser = [...(input.history ?? [])]
    .reverse()
    .find((entry) => entry.role === "user" && entry.text.trim())
    ?.text.trim();
  const words = wordCount(message);
  const followUp = Boolean(
    previousUser && (words <= 8 || (words <= 30 && FOLLOW_UP_PATTERN.test(message)))
  );
  const ownReferences = findSourceReferences(message);
  const carriedText = followUp && previousUser ? previousUser.slice(0, 2_000) : "";
  const references = hasSourceReferences(ownReferences) || !carriedText
    ? ownReferences
    : findSourceReferences(carriedText);
  const query = [message, carriedText, input.currentText ?? ""]
    .filter(Boolean)
    .join("\n")
    .slice(0, 8_000);
  return {
    query,
    references,
    /** The text to match lecture titles against. */
    focusText: [message, carriedText].filter(Boolean).join("\n"),
    followUp,
  };
}
