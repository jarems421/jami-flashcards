import { practicePaperSourceRole } from "@/lib/ai/practice-paper-generation";
import type { Source } from "@/lib/material/sources";
import { MAX_PRACTICE_PAPER_SOURCE_IDS } from "@/lib/practice/practice-papers";

/**
 * What the practice paper builder asks Jami for, worked out from the
 * student's choices.
 *
 * Kept apart from the builder's screen so the rules -- what a described exam
 * asks for, which material a paper starts from, and what has to be settled
 * before a request is sent -- can be read and tested on their own.
 */

export type DescribedExamKind = "final" | "midterm" | "test" | "resit";

export const DESCRIBED_EXAM_KINDS: ReadonlyArray<{ value: DescribedExamKind; label: string; phrase: string }> = [
  { value: "final", label: "Final exam", phrase: "final exam" },
  { value: "midterm", label: "Mid-term", phrase: "mid-term exam" },
  { value: "test", label: "Class test", phrase: "class test" },
  { value: "resit", label: "Resit", phrase: "resit exam" },
];

export type DescribedExamLength = "unsure" | "60" | "90" | "120" | "180";

export const DESCRIBED_EXAM_LENGTHS: ReadonlyArray<{ value: DescribedExamLength; label: string }> = [
  { value: "unsure", label: "Not sure" },
  { value: "60", label: "1 hour" },
  { value: "90", label: "1½ hours" },
  { value: "120", label: "2 hours" },
  { value: "180", label: "3 hours" },
];

/**
 * What a student describing their own exam is asked, in their terms: which
 * module, what kind of exam, how long, and what it covers. Jami's request is
 * written from those answers rather than asked for as a paragraph.
 */
export function describedExamRequest(input: {
  module: string;
  kind: DescribedExamKind;
  length: DescribedExamLength;
  withPastPapers: boolean;
}) {
  const kind = DESCRIBED_EXAM_KINDS.find((option) => option.value === input.kind)?.phrase ?? "exam";
  const length =
    input.length === "unsure"
      ? ""
      : `, ${DESCRIBED_EXAM_LENGTHS.find((option) => option.value === input.length)?.label}`;
  return input.withPastPapers
    ? `A new practice ${kind} for ${input.module}${length}, modelled closely on my past papers: the same structure, sections, number of questions, marks and kinds of question, with new questions throughout that stay within what my notes cover.`
    : `A complete practice ${kind} for ${input.module}${length}, in the format that exam uses.`;
}

/** A folder's material as the builder shows it: past papers and schemes, then notes. */
export function splitPaperMaterial<T extends Pick<Source, "title" | "fileName">>(sources: readonly T[]) {
  return {
    papers: sources.filter((source) => practicePaperSourceRole(source) !== "notes"),
    notes: sources.filter((source) => practicePaperSourceRole(source) === "notes"),
  };
}

/** Past papers and schemes first, then notes: what a new paper starts with. */
export function defaultPaperMaterial(sources: readonly Source[]) {
  const { papers, notes } = splitPaperMaterial(sources);
  return [...papers, ...notes].slice(0, MAX_PRACTICE_PAPER_SOURCE_IDS).map((source) => source.id);
}

/**
 * The title a file added as material is kept under. A past paper is named so
 * it is sorted as one, whatever the file was called.
 */
export function paperMaterialTitle(fileName: string, kind: "paper" | "notes") {
  const name = fileName.replace(/\.[^.]+$/, "");
  return kind === "paper" && practicePaperSourceRole({ title: name, fileName }) === "notes"
    ? `Past paper: ${name}`
    : name;
}

/**
 * Why a generated paper cannot be asked for yet, or null when it can.
 *
 * Checked in the order a student fills the builder in, so the first thing
 * missing is the one they are told about.
 */
export function generatedPaperRequestProblem(input: {
  folderId: string;
  /** A school course was picked from the catalogue. */
  hasCourse: boolean;
  /** The folder is a school folder, where a course is picked rather than described. */
  schoolFolder: boolean;
  moduleName: string;
  /** The picked course has a topic list, so at least one topic must be in the paper. */
  topicsRequired: boolean;
  topicCount: number;
  /** Jami proposed sources that the student has not reviewed and confirmed. */
  sourcesUnconfirmed: boolean;
  /** Sources and supporting files together. */
  materialCount: number;
}): string | null {
  if (!input.folderId) return "Choose a folder for this paper.";
  if (!input.hasCourse && !input.moduleName.trim()) {
    return input.schoolFolder ? "Choose your board and course, or name the course." : "Add the module this exam is for.";
  }
  if (input.topicsRequired && input.topicCount === 0) return "Choose at least one topic for this paper.";
  if (input.sourcesUnconfirmed) return "Review and confirm the sources Jami proposes for this paper.";
  if (input.materialCount > MAX_PRACTICE_PAPER_SOURCE_IDS) {
    return "That's more material than one paper can use. Untick some and try again.";
  }
  return null;
}
