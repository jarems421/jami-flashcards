import { createHash } from "node:crypto";
import {
  findQuestionStarts,
  normaliseQuestionLabel,
  rootQuestionLabel,
  readPrintedTariff,
  readPrintedTariffs,
  regionsForQuestion,
  schemeCoversQuestion,
  type PdfPageText,
  type QuestionRegion,
} from "@/lib/practice/exam-page-regions";
import {
  normalizeMarkSchemeItem,
  schemeMarkTotal,
  validateMarkSchemeItem,
} from "@/lib/practice/mark-schemes";
import { filterCanonicalTopicIds } from "@/lib/practice/exam-specification-topics";
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

  /*
   * A paper prints one total per question, and a question may be several
   * parts. "(Total for Question 5 is 5 marks)" is the total of 5(a) and 5(b),
   * so comparing each part against it fails both -- which is what happened on
   * every multi-part question of a real paper until this existed. What has to
   * match the printed total is the sum of the parts.
   */
  const marksByRoot = new Map<string, number>();
  for (const item of input.questions) {
    const label = rootQuestionLabel(text(item.questionNumber, 80));
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
    // Normalised, so AQA's "01.1" and Edexcel's "3" both name their question.
    const rootLabel = rootQuestionLabel(number);
    /*
     * A part is its own question on the page when the paper numbers it that
     * way. AQA prints `01.1` in the margin like any other question, so taking
     * the root's region gives only the stem -- a sentence of scene-setting
     * with no tariff in it, which read as "no tariff could be read" on every
     * question of the paper.
     */
    const fullLabel = normaliseQuestionLabel(number) ?? rootLabel;
    /*
     * Asked of the board, not of the one label: AQA numbers every part in the
     * margin, so `08.1` is its own question even on the one page where its
     * number was not picked up -- and comparing that part against question 8's
     * ten marks failed it for a tariff the paper prints correctly.
     */
    const boardNumbersParts = questionStarts.some(
      (start) => start.label !== rootLabel && rootQuestionLabel(start.label) === rootLabel
    );
    const partIsItsOwnQuestion = fullLabel !== rootLabel && boardNumbersParts;
    /*
     * Where to crop: the part's own number when the paper shows one, otherwise
     * the question it belongs to. The root's region starts at its stem and ends
     * at the next numbered part, so a part whose number was missed still gets
     * the right slice of paper rather than none at all.
     */
    const startLabel = questionStarts.some((start) => start.label === fullLabel)
      ? fullLabel
      : rootLabel;
    /*
     * Two crops, because they answer different questions.
     *
     * What the student sees has to carry the stem -- `11 (a) Write down
     * P(A n B)` is unanswerable without the Venn diagram printed once above
     * it. What the tariff is read from must not: the stem belongs to every
     * part, so reading it would let one part's `[3 marks]` verify another's.
     */
    const ownRegions = startLabel
      ? regionsForQuestion({ label: startLabel, starts: questionStarts, pages: paperPages })
      : [];
    const regions = startLabel
      ? regionsForQuestion({
          label: startLabel,
          starts: questionStarts,
          pages: paperPages,
          ...(partIsItsOwnQuestion ? { withStemOf: rootLabel } : {}),
        })
      : [];

    /*
     * Two ways a tariff is printed, and they are compared against different
     * totals. AQA numbers each part in the margin and prints `[3 marks]` inside
     * it, so a part is checked against its own region. Edexcel prints one
     * "(Total for Question 5 is 5 marks)" covering every part and no margin
     * number for `5(b)`, so its parts are summed and checked against that --
     * reading the region there finds the largest `(n)` belonging to some other
     * part, which failed four questions of a real paper.
     */
    const regionTariff = ownRegions.length
      ? readPrintedTariff(textInRegions(paperPages, ownRegions))
      : null;
    const documentTariff = printedTariffs.get(rootLabel) ?? null;
    const rootMarks = marksByRoot.get(rootLabel) ?? marks;
    const printedTariff = partIsItsOwnQuestion ? regionTariff : documentTariff ?? regionTariff;
    const expectedMarks = partIsItsOwnQuestion ? marks : rootMarks;
    const labelFoundOnPaper = questionStarts.some((start) => start.label === startLabel);
    const schemeMentionsLabel = schemeCoversQuestion(schemeText, rootLabel);
    const schemeTotal = markSchemeItem ? schemeMarkTotal(markSchemeItem) : 0;
    const page = Math.round(Number(item.questionPage));

    /*
     * Only topics the specification names. Whatever the model returns is a
     * suggestion, and an id the catalogue does not hold is not a near miss to
     * be corrected -- it is a topic that does not exist on this course. Left
     * unchecked these would have reached students as though the board had
     * written them, and would have silently narrowed a topic-filtered session
     * to the wrong questions.
     */
    const suggestedTopics = Array.isArray(item.topicIds)
      ? item.topicIds.map((value) => text(value, 120)).filter(Boolean).slice(0, 20)
      : [];
    const { topicIds: canonicalTopics, rejected: rejectedTopics } = filterCanonicalTopicIds(
      manifest.specificationId,
      suggestedTopics
    );

    const issues = [
      !input.identityMatches ? "The paper does not identify itself as the one in the manifest." : "",
      !number ? "Missing question label." : "",
      !labelFoundOnPaper ? `Question ${number || "?"} was not found in the paper's margin.` : "",
      !prompt ? "Missing prompt." : "",
      marks < 1 ? "Invalid tariff." : "",
      printedTariff !== null && printedTariff !== expectedMarks
        ? `Extracted ${expectedMarks} marks for question ${startLabel} but the paper prints ${printedTariff}.`
        : "",
      printedTariff === null ? "No tariff could be read for this question." : "",
      !pairedScheme ? "Missing scheme pairing." : "",
      !schemeMentionsLabel ? `The mark scheme does not cover question ${number || "?"}.` : "",
      rejectedTopics.length
        ? `Topics not on this specification were suggested and dropped: ${rejectedTopics.join(", ")}.`
        : "",
      markSchemeItem && schemeTotal !== marks
        ? `The scheme awards ${schemeTotal} marks against a ${marks}-mark question.`
        : "",
      regions.length === 0 ? "The question's own region of the paper could not be located." : "",
      ...schemeIssues.map((issue) => issue.detail),
      ...(input.issuesByQuestion[number] ?? []).map(String),
    ].filter(Boolean);

    const verification: ExamIngestionVerification = {
      paperIdentityMatches: input.identityMatches,
      questionLabelMatches: labelFoundOnPaper,
      tariffMatches: printedTariff !== null && printedTariff === expectedMarks,
      markSchemeLabelMatches: schemeMentionsLabel && Boolean(pairedScheme),
      questionComplete: Boolean(prompt) && markSchemeItem !== null && schemeTotal === marks,
      assetsComplete: regions.length > 0,
      specificationCurrent: true,
      issues,
    };

    if (!markSchemeItem) {
      rejected.push({
        questionNumber: number || "(unlabelled)",
        reasons: ["The mark scheme could not be read into any supported marking regime.", ...issues],
      });
      continue;
    }

    /*
     * No second opinion is taken here any more.
     *
     * Ingestion used to ask a model to audit its own extraction from the same
     * PDFs, and gate publication on the answer. That pass was sending
     * documents to a role whose capability entry declares no document
     * modality, so it was either failing or judging a paper it had not seen --
     * and it is now redundant besides: the reviewer is shown the rendered
     * question and its rendered scheme page, which is a stronger check than
     * the one being replaced.
     */
    const publishable = canPublishExamQuestion(verification) && issues.length === 0;
    /*
     * Everything a student is actually shown or marked against, hashed
     * together.
     *
     * This used to cover the wording, the tariff and the scheme, which left
     * the picture out. A question is very often the picture -- a graph, a
     * circuit, a source extract -- so re-ingesting a paper whose diagram had
     * been redrawn produced an identical version, and the live session that
     * checks its version before marking saw nothing to object to while the
     * image underneath it silently became a different image.
     *
     * The region and page say which part of which page is cut out, and the
     * paper's own hash says which document it was cut from, so any change to
     * the source is a change of identity.
     */
    const contentVersion = createHash("sha256")
      .update(JSON.stringify({
        prompt,
        marks,
        markSchemeItem,
        page,
        regions,
        paperSha256: input.paperSha256,
      }))
      .digest("hex")
      .slice(0, 16);

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
        topicIds: canonicalTopics,
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
        contentVersion,
        selectionKey: selectionKey(),
        createdAt: input.now,
        updatedAt: input.now,
      },
      secret: {
        questionId,
        contentVersion,
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
  /*
   * Why questions were held back, most common first.
   *
   * A count on its own says nothing: "0 published, 28 needing review" read
   * identically whether the mark schemes were empty or the tariffs disagreed,
   * and finding out which cost a paid run. Numbers in an issue are collapsed
   * so twenty-eight variations of the same problem read as one problem.
   */
  const issueCounts = new Map<string, number>();
  for (const entry of result.entries) {
    for (const issue of entry.verification.issues) {
      const shape = issue.replace(/\d+/g, "N");
      issueCounts.set(shape, (issueCounts.get(shape) ?? 0) + 1);
    }
  }
  const issueSummary = [...issueCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8)
    .map(([issue, count]) => ({ issue, count }));

  return {
    extracted: result.entries.length + result.rejected.length,
    published: result.entries.filter((entry) => entry.question.status === "published").length,
    needsReview: result.entries.filter((entry) => entry.question.status === "needs_review").length,
    rejected: result.rejected,
    issueSummary,
  };
}
