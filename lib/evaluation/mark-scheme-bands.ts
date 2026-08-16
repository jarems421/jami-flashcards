import type { PracticePaperMarkBand } from "@/lib/practice/mark-schemes";

/**
 * Recovering real band descriptors from a published mark scheme.
 *
 * This exists because of a measurement failure worth remembering. The corpus
 * adapter used to hand every banded question a single band spanning nought to
 * maximum with one descriptor, which is not a scale at all — there is no
 * gradient to navigate, and one of the two markers responded by collapsing to
 * roughly the same number whatever the tariff. That was read, briefly and
 * wrongly, as the model being broken. It was the rubric being empty.
 *
 * So bands are parsed from what the source actually published rather than
 * invented. Two formats cover the sources that publish them:
 *
 *   Level 4: Detailed, perceptive analysis (7-8 marks)   — Medly, exam boards
 *   SCORE OF 6: An essay in this category demonstrates…  — ASAP 2.0
 *
 * Sources that publish only a reference answer get no bands from here, and the
 * caller is expected to say so rather than fabricate them.
 */

const LEVEL_PATTERN =
  /^\s*(?:Level|Band)\s+(\d+)\s*[:.]?\s*(.*?)\s*\((\d+)\s*[-–—]\s*(\d+)\s*marks?\)\s*$/i;
const SINGLE_MARK_PATTERN = /^\s*SCORE OF\s+(\d+)\s*[:.]\s*(.*)$/i;

/**
 * Bands in ascending mark order, or an empty array when the text publishes
 * none. Descriptors run from the heading to the next heading, so the bullet
 * lines beneath a level belong to it.
 */
export function parseBandsFromScheme(text: string, maxMarks: number): PracticePaperMarkBand[] {
  if (!text.trim() || maxMarks <= 0) return [];
  const lines = text.split(/\r?\n/);

  type Draft = { min: number; max: number; label: string; body: string[] };
  const drafts: Draft[] = [];

  for (const line of lines) {
    const level = LEVEL_PATTERN.exec(line);
    if (level) {
      const min = Number(level[3]);
      const max = Number(level[4]);
      drafts.push({
        min: Math.min(min, max),
        max: Math.max(min, max),
        label: `Level ${level[1]}${level[2] ? `: ${level[2]}` : ""}`.trim(),
        body: [],
      });
      continue;
    }
    const single = SINGLE_MARK_PATTERN.exec(line);
    if (single) {
      const mark = Number(single[1]);
      drafts.push({ min: mark, max: mark, label: `Score of ${mark}`, body: [single[2]] });
      continue;
    }
    if (drafts.length > 0 && line.trim()) drafts[drafts.length - 1].body.push(line.trim());
  }

  const usable = drafts.filter(
    (draft) =>
      Number.isFinite(draft.min) &&
      Number.isFinite(draft.max) &&
      draft.min >= 0 &&
      draft.max <= maxMarks
  );
  // One band is not a scale, and is what caused the original problem.
  if (usable.length < 2) return [];

  return usable
    .sort((left, right) => left.min - right.min)
    .map((draft, index) => ({
      id: `b${index + 1}`,
      label: draft.label,
      minMarks: draft.min,
      maxMarks: draft.max,
      descriptor: draft.body.join(" ").replace(/\s+/g, " ").trim() || draft.label,
    }));
}

/**
 * Bands for a scale whose source published a reference answer and no
 * descriptors, as Mohler, JorGPT and the graduate set all do.
 *
 * These are derived, not published, and the caller marks the scheme
 * `estimated` to say so. What they encode is only what the source states its
 * scale to mean — how fully the response matches the reference — rather than
 * invented claims about quality that nobody wrote.
 */
export function bandsForReferenceScale(maxMarks: number): PracticePaperMarkBand[] {
  if (maxMarks <= 0) return [];
  // Small scales get a band per mark; larger ones would produce an unreadable
  // wall, so they are quartered.
  const steps = maxMarks <= 6 ? maxMarks + 1 : 5;
  const width = maxMarks / (steps - 1);

  return Array.from({ length: steps }, (_unused, index) => {
    const min = Math.round(index * width);
    const max = index === steps - 1 ? maxMarks : Math.round((index + 1) * width) - 1;
    const share = maxMarks === 0 ? 0 : min / maxMarks;
    const descriptor =
      share === 0
        ? "Nothing in the response corresponds to the reference answer."
        : share >= 1
          ? "The response corresponds fully to the reference answer."
          : `Roughly ${Math.round(share * 100)}% of the reference answer is met.`;
    return {
      id: `b${index + 1}`,
      label: min === max ? `${min} marks` : `${min}-${max} marks`,
      minMarks: min,
      maxMarks: Math.max(min, max),
      descriptor,
    };
  });
}
