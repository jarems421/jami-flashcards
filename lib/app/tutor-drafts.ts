import type { GeneratedContentDraft } from "@/lib/material/generated-content";
import type { Source, SourceType } from "@/lib/material/sources";

export type TutorDraftGroup = {
  sourceId: string | null;
  title: string;
  /** The first draft's own words, so the row says what is inside it. */
  preview: string;
  flashcards: number;
  questions: number;
  total: number;
};

const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  file: "File",
  link: "Link",
  manual_note: "Note",
  pasted_text: "Pasted text",
};

export function getSourceTypeLabel(type: SourceType) {
  return SOURCE_TYPE_LABELS[type] ?? "Source";
}

/** A single letter for the bubble, since a 40px circle fits nothing else. */
export function getSourceTypeMark(type: SourceType) {
  return type === "link" ? "↗" : type === "file" ? "▤" : "✎";
}

/**
 * What a draft is asking, in its own words.
 *
 * A queue that only counts is a reminder rather than something to act on: two
 * rows reading "4 flashcards" tell a student nothing about which to open. The
 * first draft's front, or its question, says what the group is about.
 */
export function getDraftPreview(draft: GeneratedContentDraft) {
  const text =
    draft.kind === "practice-question"
      ? draft.questionText ?? draft.title
      : draft.front ?? draft.title;
  return (text ?? "").trim();
}

/**
 * Groups the queue by the source that produced it.
 *
 * Reviewing happens one source at a time, because the workflow that edits
 * drafts belongs to a source -- so a row is only useful if it names the source
 * to open. Drafts with no source still get a row, or they would be invisible.
 */
export function groupTutorDrafts(
  drafts: readonly GeneratedContentDraft[],
  sources: readonly Source[]
): TutorDraftGroup[] {
  const titleById = new Map(sources.map((source) => [source.id, source.title]));
  const groups = new Map<string, TutorDraftGroup>();

  for (const draft of drafts) {
    const sourceId = draft.sourceId ?? null;
    const key = sourceId ?? "__unsourced__";
    const group = groups.get(key) ?? {
      sourceId,
      title: sourceId
        ? titleById.get(sourceId) ?? "A source you have removed"
        : "Written without a source",
      preview: "",
      flashcards: 0,
      questions: 0,
      total: 0,
    };

    if (draft.kind === "practice-question") group.questions += 1;
    else group.flashcards += 1;
    group.total += 1;
    if (!group.preview) group.preview = getDraftPreview(draft);
    groups.set(key, group);
  }

  return [...groups.values()].sort((left, right) => right.total - left.total);
}

/** "4 cards" / "2 questions", or nothing when there are none of that kind. */
export function describeDraftCounts(group: TutorDraftGroup) {
  const parts: string[] = [];
  if (group.flashcards > 0) {
    parts.push(`${group.flashcards} card${group.flashcards === 1 ? "" : "s"}`);
  }
  if (group.questions > 0) {
    parts.push(`${group.questions} question${group.questions === 1 ? "" : "s"}`);
  }
  return parts;
}
