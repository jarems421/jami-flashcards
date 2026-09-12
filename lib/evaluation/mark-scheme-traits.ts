import type { PracticePaperMarkTrait } from "@/lib/practice/mark-schemes";
import { parseBandsFromScheme } from "./mark-scheme-bands.ts";

/** Recover published AO rubrics only. Human scores must never supply maxima. */
export function parseTraitsFromScheme(text: string, maxMarks: number): PracticePaperMarkTrait[] {
  if (!Number.isInteger(maxMarks) || maxMarks <= 0 || maxMarks > 1_000) return [];
  const sections: { id: string; label: string; maxMarks: number; lines: string[] }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const heading = /^\s*(AO\d+)\b\s*[:–—-]?\s*(.*?)\s*\((\d+)\s*marks?\)\s*:?\s*$/i.exec(line);
    if (heading) {
      sections.push({ id: heading[1].toUpperCase(), label: `${heading[1].toUpperCase()} ${heading[2]}`.trim(), maxMarks: Number(heading[3]), lines: [] });
    } else {
      // An unsupported AO heading is not continuation of the previous rubric.
      if (/^\s*AO\d+\b/i.test(line)) return [];
      sections.at(-1)?.lines.push(line);
    }
  }
  if (sections.length < 2 || new Set(sections.map((section) => section.id)).size !== sections.length ||
    sections.reduce((sum, section) => sum + section.maxMarks, 0) !== maxMarks) return [];
  const traits = sections.map(({ lines, ...section }) => ({
    ...section, bands: parseBandsFromScheme(lines.join("\n"), section.maxMarks),
  }));
  if (traits.some((trait) => {
    if (trait.maxMarks <= 0 || trait.bands.length < 2) return true;
    // Require non-overlapping coverage of every positive integer mark.
    return Array.from({ length: trait.maxMarks }, (_, index) => index + 1)
      .some((mark) => trait.bands.filter((band) => mark >= band.minMarks && mark <= band.maxMarks).length !== 1);
  })) return [];
  return traits;
}
