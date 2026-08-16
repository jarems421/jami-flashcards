import type { AiContentPart } from "@/lib/ai/content-parts";
import type {
  PracticePaper,
  PracticePaperMarkScheme,
} from "@/lib/practice/practice-papers";
import type { PracticePaperMarkSchemeItem } from "@/lib/practice/mark-schemes";
import type { MarkingCorpusRecord } from "@/lib/evaluation/marking-corpus";
import { stageOf } from "@/lib/evaluation/marking-corpus";
import { bandsForReferenceScale, parseBandsFromScheme } from "./mark-scheme-bands.ts";

/**
 * A corpus record, dressed as a one-question practice paper.
 *
 * The point of this module is that the evaluation marks through Jami's real
 * marking path rather than a stand-in. A stand-in can tell you a model is
 * accurate; it cannot tell you the shipped prompt, the shipped mark-scheme
 * shape or the shipped JSON parsing are. Every one of those is a place the
 * feature can be wrong while the model is fine.
 *
 * The adapter is deliberately thin, and the risk it carries is worth naming:
 * anything invented here that production would not invent makes the
 * measurement drift from the product. So the paper is minimal, the mark scheme
 * carries only what the record actually holds, and nothing is padded to look
 * realistic.
 *
 * One judgement worth flagging. The marking prompt adapts itself to the
 * subject by matching words in the assessment profile — quantitative subjects
 * get method-mark guidance, essay subjects get knowledge-and-evaluation
 * guidance. The profile is therefore written to name the subject plainly, so a
 * corpus English essay reaches the same branch a student's English essay
 * would. Leaving it vague would quietly evaluate the fallback branch instead.
 */

const SUBJECT_DESCRIPTIONS: Record<string, string> = {
  english: "English essay writing",
  maths: "mathematics",
  statistics: "statistics",
  dataScience: "data science with statistics",
  computerScience: "computer science",
  economics: "economics essay writing",
  physics: "physics",
  chemistry: "chemistry",
  biology: "biology",
  history: "history essay writing",
  engineering: "engineering",
  business: "business studies",
};

const LEVEL_DESCRIPTIONS: Record<string, string> = {
  gcse: "GCSE",
  alevel: "A-level",
  advancedHigher: "Advanced Higher",
  usStateAssessment: "US state assessment",
  undergraduate: "Undergraduate",
  postgraduate: "Postgraduate",
};

export type AdaptedPaper = {
  paper: PracticePaper;
  answerParts: AiContentPart[];
};

export type AdaptResult =
  | { ok: true; adapted: AdaptedPaper }
  | { ok: false; reason: string };

const QUESTION_ID = "q1";

/**
 * The mark scheme, in whichever shape the record's regime calls for.
 *
 * A record knows its regime and, for criterion-marked sources, what each mark
 * is for. Where it knows nothing beyond the total, the scheme says so rather
 * than inventing points the source never published — a fabricated scheme would
 * be marked against, and the resulting figure would measure the fabrication.
 */
function markSchemeFor(record: MarkingCorpusRecord): PracticePaperMarkScheme {
  const common = {
    questionId: QUESTION_ID,
    maxMarks: record.maxMarks,
    answer: record.markScheme ?? "",
    acceptableAlternatives: [],
    commonMistakes: [],
  };

  let item: PracticePaperMarkSchemeItem;
  if (record.criteria && record.criteria.length > 0 && record.regime !== "banded") {
    const points = record.criteria.map((criterion, index) => ({
      id: `p${index + 1}`,
      marks: criterion.available,
      code: "B" as const,
      text: criterion.description ?? criterion.id,
      dep: [],
      ft: criterion.followThrough ?? false,
      essentialTerms: [],
      allow: [],
      reject: [],
    }));
    item =
      record.regime === "pointPool"
        ? { ...common, marking: "pointPool", points, awardable: record.maxMarks }
        : { ...common, marking: "additive", points };
  } else if (record.regime === "banded" || record.regime === "weightedTraits") {
    /**
     * Real bands where the source published them, derived ones where it did
     * not — never a single band across the whole scale.
     *
     * That single band was a measurement bug, not a simplification. A marker
     * given one undifferentiated band from nought to maximum has no gradient
     * to reason about, and one of the two blind markers responded by returning
     * roughly the same mark whatever the tariff. It looked exactly like a
     * broken model.
     */
    const published = parseBandsFromScheme(record.markScheme ?? "", record.maxMarks);
    item = {
      ...common,
      marking: "banded",
      bands: published.length > 0 ? published : bandsForReferenceScale(record.maxMarks),
    };
  } else {
    item = {
      ...common,
      marking: record.regime === "pointPool" ? "pointPool" : "additive",
      points: [
        {
          id: "p1",
          marks: record.maxMarks,
          code: "B",
          text: record.markScheme ?? "Award against the stated standard.",
          dep: [],
          ft: false,
          essentialTerms: [],
          allow: [],
          reject: [],
        },
      ],
      ...(record.regime === "pointPool" ? { awardable: record.maxMarks } : {}),
    } as PracticePaperMarkSchemeItem;
  }

  // Whether the band structure came from the source or was derived from its
  // scale, said plainly rather than left for a reader to assume.
  const derivedBands =
    item.marking === "banded" && parseBandsFromScheme(record.markScheme ?? "", record.maxMarks).length === 0;

  return {
    kind: !record.markScheme ? "missing" : derivedBands ? "estimated" : "official",
    label: !record.markScheme
      ? "No published scheme"
      : derivedBands
        ? "Reference answer, with a scale derived from it"
        : "Published mark scheme",
    notice: !record.markScheme
      ? "The source published no scheme for this question; mark against the question alone."
      : derivedBands
        ? "The source published a reference answer but no band descriptors. The bands below describe how fully a response matches that reference, which is what the source states its scale to mean."
        : "Taken verbatim from the source that published this marked work.",
    items: [item],
  };
}

function describe(record: MarkingCorpusRecord) {
  const subject = SUBJECT_DESCRIPTIONS[record.subject] ?? record.subject;
  const level = LEVEL_DESCRIPTIONS[record.level] ?? record.level;
  return { subject, level };
}

export type AdaptOptions = {
  /**
   * Pages of a scanned answer, already loaded and encoded.
   *
   * Passed in rather than read here, because this module is pure domain logic
   * and opening a PDF is I/O. A caller that has not loaded them gets the same
   * refusal as before, so a scan is never marked blind.
   */
  answerImages?: readonly AiContentPart[];
};

export function adaptRecordToPaper(
  record: MarkingCorpusRecord,
  options: AdaptOptions = {}
): AdaptResult {
  const scanned = record.answer.kind === "image";
  if (scanned && (options.answerImages?.length ?? 0) === 0) {
    return {
      ok: false,
      reason: `${record.id}: answer is a scanned page and no image was supplied.`,
    };
  }
  if (record.answer.kind === "text" && !record.answer.text.trim()) {
    return { ok: false, reason: `${record.id}: empty answer.` };
  }

  const { subject, level } = describe(record);
  const now = 0;
  const paper: PracticePaper = {
    id: `eval-${record.id}`,
    notebookId: "evaluation",
    folderId: "evaluation",
    title: `Evaluation: ${record.sourceId} ${record.questionId}`,
    origin: "uploaded",
    status: "submitted",
    sourceIds: [],
    sourceLabels: [],
    request: "",
    coverage: "",
    length: "full",
    focus: "balanced",
    durationMinutes: 0,
    timingMode: "untimed",
    timingState: "submitted",
    totalPausedMs: 0,
    deadlineVersion: 1,
    tutorEnabled: false,
    tutorUsed: false,
    timerEnabled: false,
    instructions: [],
    assessmentProfile: {
      studyLevel: `${level}${record.levelDetail ? ` (${record.levelDetail})` : ""}`,
      qualificationOrModule: level,
      awardingBodyOrInstitution: record.sourceId,
      specificationOrCourse: subject,
      tierOrComponent: stageOf(record),
      // The marking prompt branches on the words in this profile, so the
      // subject is named plainly here rather than left implicit.
      formatSummary: `Single ${subject} question worth ${record.maxMarks} marks, marked by ${record.regime}.`,
      confidence: "high",
    },
    questions: [
      {
        id: QUESTION_ID,
        label: "Question 1",
        prompt: record.questionPrompt || "See the mark scheme; the source published no prompt text.",
        marks: record.maxMarks,
        assets: [],
      },
    ],
    choiceGroups: [],
    totalMarks: record.maxMarks,
    markScheme: markSchemeFor(record),
    gradeGuidance: { kind: "none", label: "Not applicable", notice: "", boundaries: [] },
    examinerInsights: [],
    attemptCount: 1,
    createdAt: now,
    updatedAt: now,
  };

  return {
    ok: true,
    adapted: {
      paper,
      answerParts: scanned
        ? [
            {
              text: `--- STUDENT ANSWER (Question 1) ---\nThe candidate's working is photographed below. Read it as written; do not assume anything the page does not show.`,
            },
            ...(options.answerImages ?? []),
          ]
        : [
            {
              text: `--- STUDENT ANSWER (Question 1) ---\n${
                record.answer.kind === "text" ? record.answer.text : ""
              }`,
            },
          ],
    },
  };
}

/**
 * Exemplars as prompt parts.
 *
 * Each carries the question, the answer and the mark a human actually gave,
 * because a marked example with the mark removed is just more reading. Scanned
 * exemplars are skipped rather than described, and the examiner's own reasoning
 * is included where the source published it, since that is the part a marker
 * would learn most from.
 */
export function exemplarsToParts(exemplars: readonly MarkingCorpusRecord[]): AiContentPart[] {
  const usable = exemplars.filter((record) => record.answer.kind === "text");
  if (usable.length === 0) return [];

  return usable.map((record, index) => {
    const { subject, level } = describe(record);
    const marks = record.humanMarks.join(" and ");
    const answer = record.answer.kind === "text" ? record.answer.text : "";
    return {
      text: [
        `Example ${index + 1} — ${level} ${subject}, marked by ${record.regime}.`,
        `Question: ${record.questionPrompt || "(not published)"}`,
        `Student answer: ${answer}`,
        `Human marker awarded: ${marks} out of ${record.maxMarks}.`,
        record.examinerCommentary ? `Marker's reasoning: ${record.examinerCommentary}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    };
  });
}
