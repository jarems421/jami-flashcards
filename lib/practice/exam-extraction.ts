import { createHash } from "node:crypto";
import {
  findQuestionStarts,
  readPrintedTariff,
  readPrintedTariffs,
  regionsForQuestion,
  schemeCoversQuestion,
  type PdfPageText,
  type QuestionRegion,
} from "@/lib/practice/exam-page-regions";
import { normalizeMarkSchemeItem, schemeCriteria, validateMarkSchemeItem } from "@/lib/practice/mark-schemes";
import {
  canPublishExamQuestion,
  type ExamDifficulty,
  type ExamIngestionVerification,
  type ExamQuestion,
  type ExamQuestionSecret,
  type ExamRightsSnapshot,
} from "@/lib/practice/exam-questions";
import type { ExamPaperIngestionManifest } from "@/lib/practice/exam-ingestion-manifest";

/**
 * Turning a model's reading of a paper into questions, or into reasons not to.
 *
 * Separated from the ingestion route because this is the part that keeps being
 * wrong, and it was welded to two vision calls and two PDF downloads -- so the
 * only way to find out whether a change helped was a slow paid run against a
 * live board, and three prompt changes went out on that basis, two of them
 * broken. Nothing here does any I/O: given a saved response and a saved page
 * layout it decides exactly what a real run would decide, in milliseconds.
 */

export type ExtractedQuestion = Record<string, unknown>;

export type ExamExtractionInput = {
  manifest: ExamPaperIngestionManifest;
  paperId: string;
  /** Page text with positions, which is what locates a question on the paper. */
  paperPages: PdfPageText[];
  /** The whole mark scheme document as text, for the pairing check. */
  schemeText: string;
  questions: ExtractedQuestion[];
  identityMatches: boolean;
  approvedQuestionNumbers: string[];
  issuesByQuestion: Record<string, string[]>;
  rights: ExamRightsSnapshot;
  paperSha256: string;
  schemeSha256: string;
  now: number;
  /** Injected so a test gets the same question every time. */
  selectionKey?: () => number;
};

export type ExamExtractionEntry = {
  question: ExamQuestion;
  secret: ExamQuestionSecret;
  verification: ExamIngestionVerification;
  page: number;
  regions: QuestionRegion[];
  schemePageNumber: number;
};

export type ExamExtractionResult = {
  entries: ExamExtractionEntry[];
  /** Candidates that never became questions, and why. */
  rejected: Array<{ questionNumber: string; reasons: string[] }>;
};

function text(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function difficultyOf(value: unknown): ExamDifficulty {
  return value === "easy" || value === "hard" ? value : "medium";
}

function subjectKeyOf(subject: string) {
  return subject.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function buildExamQuestionsFromExtraction(
  input: ExamExtractionInput
): ExamExtractionResult {
  const { manifest, paperPages, schemeText } = input;
  const questionStarts = findQuestionStarts(paperPages);
  const paperText = paperPages
    .map((page) => page.items.map((item) => item.text).join(" "))
    .join(" ");
  const printedTariffs = readPrintedTariffs(paperText);
  const approved = new Set(input.approvedQuestionNumbers.map(String));

  /*
   * A paper prints one total per question, and a question may be several
   * parts. "(Total for Question 5 is 5 marks)" is the total of 5(a) and 5(b),
   * so comparing each part against it fails both -- which is what happened on
   * every multi-part question of a real paper until this existed. What has to
   * match the printed total is the sum of the parts.
   */
  const marksByRoot = new Map<string, number>();
  for (const item of input.questions) {
    const label = text(item.questionNumber, 80).match(/^\d{1,2}/)?.[0] ?? "";
    if (!label) continue;
    const value = Number.isFinite(Number(item.marks)) ? Math.round(Number(item.marks)) : 0;
    marksByRoot.set(label, (marksByRoot.get(label) ?? 0) + value);
  }
  const selectionKey = input.selectionKey ?? Math.random;

  const entries: ExamExtractionEntry[] = [];
  const rejected: ExamExtractionResult["rejected"] = [];

  for (const item of input.questions) {
    const number = text(item.questionNumber, 80);
    const prompt = text(item.prompt, 30_000);
    const pairedScheme = text(item.schemeText, 16_000);
    const marks = Number.isFinite(Number(item.marks)) ? Math.round(Number(item.marks)) : 0;
    const questionId = createHash("sha256").update(`${input.paperId}:${number}`).digest("hex").slice(0, 40);
    const markSchemeItem = normalizeMarkSchemeItem(item.markSchemeItem, { id: questionId, marks });
    const schemeIssues = markSchemeItem
      ? validateMarkSchemeItem(markSchemeItem)
      : [{ code: "invalid_scheme", detail: "Scheme could not be parsed.", questionId }];

    /*
     * Everything below compares two things. The previous version asked whether
     * a field was present -- "the tariff is a positive number" was true of
     * every wrong extraction, including one that read a question number as a
     * tariff.
     */
    const rootLabel = number.match(/^\d{1,2}/)?.[0] ?? "";
    const regions = rootLabel
      ? regionsForQuestion({ label: rootLabel, starts: questionStarts, pages: paperPages })
      : [];
    const printedTariff =
      printedTariffs.get(rootLabel) ??
      (regions.length ? readPrintedTariff(textInRegions(paperPages, regions)) : null);
    // Compared against the whole question's marks, which is the same as this
    // part's marks whenever the question has only one part.
    const rootMarks = marksByRoot.get(rootLabel) ?? marks;
    const labelFoundOnPaper = questionStarts.some((start) => start.label === rootLabel);
    const schemeMentionsLabel = schemeCoversQuestion(schemeText, rootLabel);
    const schemeMarkTotal = markSchemeItem
      ? schemeCriteria(markSchemeItem).reduce((sum, criterion) => sum + criterion.marks, 0)
      : 0;
    const page = Math.round(Number(item.questionPage));

    const issues = [
      !input.identityMatches ? "The paper does not identify itself as the one in the manifest." : "",
      !number ? "Missing question label." : "",
      !labelFoundOnPaper ? `Question ${number || "?"} was not found in the paper's margin.` : "",
      !prompt ? "Missing prompt." : "",
      marks < 1 ? "Invalid tariff." : "",
      printedTariff !== null && printedTariff !== rootMarks
        ? `Extracted ${rootMarks} marks for question ${rootLabel} but the paper prints ${printedTariff}.`
        : "",
      printedTariff === null ? "No tariff could be read for this question." : "",
      !pairedScheme ? "Missing scheme pairing." : "",
      !schemeMentionsLabel ? `The mark scheme does not cover question ${number || "?"}.` : "",
      markSchemeItem && schemeMarkTotal !== marks
        ? `The scheme awards ${schemeMarkTotal} marks against a ${marks}-mark question.`
        : "",
      regions.length === 0 ? "The question's own region of the paper could not be located." : "",
      ...schemeIssues.map((issue) => issue.detail),
      ...(input.issuesByQuestion[number] ?? []).map(String),
    ].filter(Boolean);

    const verification: ExamIngestionVerification = {
      paperIdentityMatches: input.identityMatches,
      questionLabelMatches: labelFoundOnPaper,
      tariffMatches: printedTariff === rootMarks,
      markSchemeLabelMatches: schemeMentionsLabel && Boolean(pairedScheme),
      questionComplete: Boolean(prompt) && markSchemeItem !== null && schemeMarkTotal === marks,
      assetsComplete: regions.length > 0,
      specificationCurrent: true,
      supervisorApproved: approved.has(number),
      issues,
    };

    if (!markSchemeItem) {
      rejected.push({
        questionNumber: number || "(unlabelled)",
        reasons: ["The mark scheme could not be read into any supported marking regime.", ...issues],
      });
      continue;
    }

    const publishable =
      canPublishExamQuestion(verification) && verification.supervisorApproved && issues.length === 0;

    entries.push({
      page,
      regions,
      schemePageNumber: Math.round(Number(item.schemePage)),
      verification,
      question: {
        id: questionId,
        paperId: input.paperId,
        subject: manifest.subject,
        subjectKey: subjectKeyOf(manifest.subject),
        studyLevel: manifest.studyLevel,
        label: text(item.label, 120) || `Question ${number}`,
        prompt,
        marks,
        assets: [],
        topicIds: Array.isArray(item.topicIds)
          ? item.topicIds.map((value) => text(value, 120)).filter(Boolean).slice(0, 20)
          : [],
        difficulty: difficultyOf(item.difficulty),
        aiDifficulty: difficultyOf(item.difficulty),
        difficultyScore:
          item.difficulty === "easy" ? 0.25 : item.difficulty === "hard" ? 0.8 : 0.55,
        difficultySource: "ai_ingest",
        origin: "official_past_paper",
        provenance: {
          board: manifest.board,
          boardLabel: manifest.boardLabel,
          qualification: manifest.qualification,
          specificationId: manifest.specificationId,
          specificationTitle: manifest.specificationTitle,
          componentCode: manifest.componentCode,
          componentTitle: manifest.componentTitle,
          year: manifest.year,
          series: manifest.series,
          paperReference: manifest.paperReference,
          questionNumber: number,
          sourceUrl: manifest.questionPaperUrl,
          sourceSha256: input.paperSha256,
        },
        rights: input.rights,
        status: publishable ? "published" : "needs_review",
        review: { status: "pending", notes: [] },
        selectionKey: selectionKey(),
        createdAt: input.now,
        updatedAt: input.now,
      },
      secret: {
        questionId,
        markSchemeItem,
        officialMarkScheme: pairedScheme,
        modelAnswer: text(item.exampleAnswer, 8_000),
        examinerNotes: [],
        acceptableAlternatives: markSchemeItem.acceptableAlternatives,
        sourceDocumentHash: input.schemeSha256,
      },
    });
  }

  return { entries, rejected };
}

/** The text inside one question's regions, for a fallback tariff read. */
export function textInRegions(pages: PdfPageText[], regions: QuestionRegion[]) {
  return regions
    .flatMap((region) => {
      const page = pages.find((item) => item.page === region.page);
      if (!page) return [];
      return page.items
        .filter((item) => {
          const top = (page.height - item.y) / page.height;
          return top >= region.fromRatio && top <= region.toRatio;
        })
        .map((item) => item.text);
    })
    .join(" ");
}

export function summariseExamExtraction(result: ExamExtractionResult) {
  return {
    extracted: result.entries.length + result.rejected.length,
    published: result.entries.filter((entry) => entry.question.status === "published").length,
    needsReview: result.entries.filter((entry) => entry.question.status === "needs_review").length,
    rejected: result.rejected,
  };
}
