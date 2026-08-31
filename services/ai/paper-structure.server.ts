import { createRequire } from "node:module";

/**
 * Reading the papers, rather than reading about them.
 *
 * The format-research pass asks for `tariffProgression` and `sections` and gets
 * them back empty, and the profile still reports "verified" because its sources
 * were found. It is not being lazy: it works from a text brief summarising web
 * pages, and a per-question tariff exists nowhere but inside the question paper,
 * page by page. Seven profiles in the library state a total and nothing else,
 * which is what that looks like from the outside.
 *
 * The two profiles that do work were built by opening the PDFs. This does that
 * step, so a refreshed profile can carry the same evidence.
 *
 * Several sittings, never one. One paper cannot separate a rule from a
 * coincidence: four AQA GCSE Mathematics papers carry 34, 33, 34 and 37
 * mark-bearing parts, and a profile built from any one of them states that
 * number as though it were the specification. Three AQA Psychology papers say
 * every section is worth 24 marks -- which is the specification -- and that
 * sections A to C close with the essay, which is true of two of them.
 */

const require = createRequire(import.meta.url);

export type PaperReading = {
  url: string;
  pages: number;
  tariffs: number[];
  total: number;
  sections: string[];
  durationText?: string;
  calculator: "not_allowed" | "mentioned" | "unstated";
};

export type MeasuredStructure = {
  papersRead: number;
  /** Only where every paper agrees; a figure that varies is not a rule. */
  totalMarks?: number;
  sections?: string[];
  partsRange?: [number, number];
  durationText?: string;
  calculator?: PaperReading["calculator"];
  /** Prose for the research prompt, stating what holds and what varies. */
  notes: string[];
  readings: PaperReading[];
};

/** Lines of a PDF, top to bottom, with items on a shared baseline joined. */
async function pdfText(bytes: Uint8Array) {
  const pdfjs = require("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: true }).promise;
  const lines: string[] = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const rows = new Map<number, { x: number; s: string }[]>();
    for (const item of content.items as { str?: string; transform: number[] }[]) {
      if (!item.str?.trim()) continue;
      const y = Math.round(item.transform[5]);
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y)!.push({ x: item.transform[4], s: item.str });
    }
    for (const [, parts] of [...rows.entries()].sort((a, b) => b[0] - a[0])) {
      const line = parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(" ").replace(/\s+/g, " ").trim();
      if (line) lines.push(line);
    }
  }
  return { text: lines.join("\n"), pages: doc.numPages };
}

/** What one question paper says about its own shape. */
export async function readQuestionPaper(url: string, timeoutMs = 45_000): Promise<PaperReading | null> {
  let bytes: Uint8Array;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    const type = response.headers.get("content-type") ?? "";
    if (!/pdf/i.test(type) && !/\.pdf$/i.test(url)) return null;
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
  let read: { text: string; pages: number };
  try {
    read = await pdfText(bytes);
  } catch {
    return null;
  }
  const tariffs = [...read.text.matchAll(/\[\s*(\d+)\s*marks?\s*\]/gi)].map((m) => Number(m[1]));
  if (tariffs.length === 0) return null;
  return {
    url,
    pages: read.pages,
    tariffs,
    total: tariffs.reduce((sum, marks) => sum + marks, 0),
    sections: [...new Set([...read.text.matchAll(/\bSection\s+([A-F])\b/g)].map((m) => m[1]))].sort(),
    durationText: /Time allowed:?\s*([^\n]{0,40})/i.exec(read.text)?.[1]?.trim(),
    calculator: /you must not use a calculator/i.test(read.text)
      ? "not_allowed"
      : /calculator/i.test(read.text) ? "mentioned" : "unstated",
  };
}

const same = <T>(values: T[]) => values.length > 0 && values.every((value) => value === values[0]);

/**
 * What several papers agree on.
 *
 * A figure only becomes a fact here when every paper read shows it. Anything
 * that varies is reported as a range in the notes, where it reads as a range
 * rather than as a rule the designer must hit exactly.
 */
export async function measurePaperStructure(
  urls: readonly string[],
  options: { limit?: number; timeoutMs?: number } = {}
): Promise<MeasuredStructure> {
  const limit = options.limit ?? 4;
  const readings: PaperReading[] = [];
  for (const url of urls.slice(0, limit * 2)) {
    if (readings.length >= limit) break;
    const reading = await readQuestionPaper(url, options.timeoutMs);
    if (reading) readings.push(reading);
  }
  if (readings.length === 0) return { papersRead: 0, notes: [], readings: [] };

  const totals = readings.map((r) => r.total);
  const counts = readings.map((r) => r.tariffs.length);
  const sectionSets = readings.map((r) => r.sections.join(""));
  const notes: string[] = [];

  const agreedTotal = same(totals) ? totals[0] : undefined;
  notes.push(
    agreedTotal !== undefined
      ? `Every one of the ${readings.length} papers read totals exactly ${agreedTotal} marks.`
      : `The papers read total ${totals.join(", ")}, which do not agree -- treat the stated total as authoritative and this reading as unreliable.`
  );

  const agreedSections = same(sectionSets) ? readings[0].sections : undefined;
  if (agreedSections) {
    notes.push(
      agreedSections.length > 0
        ? `Every paper carries sections ${agreedSections.join(", ")}.`
        : "No paper carries a section heading; the questions run continuously."
    );
  } else {
    notes.push(`Sections differ between papers (${sectionSets.map((s) => s || "none").join(" | ")}).`);
  }

  const low = Math.min(...counts);
  const high = Math.max(...counts);
  notes.push(
    low === high
      ? `Each paper carries ${low} mark-bearing parts.`
      : `The papers carry ${low} to ${high} mark-bearing parts, so no single count is the specification.`
  );

  const sizes = readings.flatMap((r) => r.tariffs);
  notes.push(
    `Individual parts are worth ${Math.min(...sizes)} to ${Math.max(...sizes)} marks.`
  );
  for (const reading of readings) {
    notes.push(`Observed tariffs, ${reading.url.split("/").pop()}: ${reading.tariffs.join("+")} = ${reading.total}.`);
  }

  const durations = readings.map((r) => r.durationText ?? "");
  const calculators = readings.map((r) => r.calculator);
  return {
    papersRead: readings.length,
    totalMarks: agreedTotal,
    sections: agreedSections,
    partsRange: [low, high],
    durationText: same(durations) && durations[0] ? durations[0] : undefined,
    calculator: same(calculators) ? calculators[0] : undefined,
    notes,
    readings,
  };
}
