import {
  PAPER_GENERATION_BENCHMARK_BLOCKERS,
  PAPER_GENERATION_BENCHMARK_SCORE_KEYS,
  type PaperGenerationBenchmarkBlocker,
  type PaperGenerationBenchmarkReviewScores,
} from "@/lib/practice/paper-generation-benchmark";
import type { PracticePaper } from "@/lib/practice/practice-papers";
import { paperSchemeAlignmentIssues } from "@/lib/practice/scheme-alignment";

/**
 * Reviewing a generated paper without a person reading every one.
 *
 * The benchmark asks each paper the questions a careful teacher would: can it
 * be answered, is the scheme right, do the marks add up, does anything give the
 * answer away. Some of those are arithmetic and some are judgement. The
 * arithmetic is done here, by code, so a model can never talk a paper past a
 * total that does not add up; the judgement is asked of a model that did not
 * write the paper, and its verdict is read strictly -- every blocker must name
 * the question it is about and quote what shows it.
 */

/** Who made a review, when it was not a person. A person's review is never overwritten by one of these. */
export const AI_PAPER_REVIEWER_PREFIX = "ai:";

export function isAiPaperReviewer(reviewerUid: string | undefined) {
  return typeof reviewerUid === "string" && reviewerUid.startsWith(AI_PAPER_REVIEWER_PREFIX);
}

export type PaperReviewFinding = {
  blocker: PaperGenerationBenchmarkBlocker;
  /** The question it is about, when it is about one. */
  questionId?: string;
  /** What shows it: a quotation, or the arithmetic that fails. */
  evidence: string;
};

type ReviewablePaper = Pick<PracticePaper, "questions" | "markScheme" | "totalMarks" | "choiceGroups">;

/**
 * What can be established about a paper without judgement.
 *
 * A total that does not add up, a question with no scheme, a scheme that is
 * about a different question, a figure that failed its own validation. None of
 * these is an opinion, so none of them is left to a model.
 */
export function deterministicPaperFindings(paper: ReviewablePaper): PaperReviewFinding[] {
  const findings: PaperReviewFinding[] = [];
  const items = paper.markScheme?.items ?? [];
  const schemed = new Set(items.map((item) => item.questionId));

  for (const question of paper.questions) {
    if (!Number.isInteger(question.marks) || question.marks <= 0) {
      findings.push({
        blocker: "invalid_total",
        questionId: question.id,
        evidence: `${question.label} is worth ${question.marks} marks.`,
      });
    }
    if (!schemed.has(question.id)) {
      findings.push({
        blocker: "incorrect_scheme",
        questionId: question.id,
        evidence: `${question.label} has no mark scheme.`,
      });
    }
    for (const asset of question.assets ?? []) {
      if (asset.validationStatus === "invalid") {
        findings.push({
          blocker: "broken_visual",
          questionId: question.id,
          evidence: `${question.label}: "${asset.title}" failed its own validation.`,
        });
      }
    }
  }

  for (const issue of paperSchemeAlignmentIssues(paper.questions, items)) {
    findings.push({ blocker: "incorrect_scheme", questionId: issue.questionId, evidence: issue.detail });
  }

  /*
   * Only checkable by addition when every question counts. With optional
   * questions the total depends on which are chosen, and the choice-group
   * rule is the thing that decides it -- a model reads that, not a sum.
   */
  if ((paper.choiceGroups ?? []).length === 0) {
    const sum = paper.questions.reduce((total, question) => total + question.marks, 0);
    if (sum !== paper.totalMarks) {
      findings.push({
        blocker: "invalid_total",
        evidence: `The questions add up to ${sum} marks; the paper says ${paper.totalMarks}.`,
      });
    }
  }
  return findings;
}

export type AiPaperReview = {
  usable: boolean;
  scores: PaperGenerationBenchmarkReviewScores;
  findings: PaperReviewFinding[];
  comments: string;
};

/**
 * A model's verdict, or nothing.
 *
 * Read strictly because it stands in for a person. Every score must be a whole
 * number from 1 to 5; a blocker must be one of the benchmark's own, and must
 * name a question on this paper (or none, for a paper-wide fault) and say what
 * shows it -- a blocker without evidence is dropped rather than trusted, and a
 * verdict whose scores cannot be read is refused whole rather than guessed at.
 */
export function readAiPaperReview(
  payload: unknown,
  questionIds: ReadonlySet<string>
): AiPaperReview | null {
  if (!payload || typeof payload !== "object") return null;
  const raw = payload as Record<string, unknown>;
  const rawScores = raw.scores && typeof raw.scores === "object" ? (raw.scores as Record<string, unknown>) : null;
  if (!rawScores) return null;
  const scores = {} as PaperGenerationBenchmarkReviewScores;
  for (const key of PAPER_GENERATION_BENCHMARK_SCORE_KEYS) {
    const value = rawScores[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 5) return null;
    scores[key] = value;
  }

  const allowed = new Set<string>(PAPER_GENERATION_BENCHMARK_BLOCKERS);
  const findings = (Array.isArray(raw.blockers) ? raw.blockers : []).flatMap((entry): PaperReviewFinding[] => {
    if (!entry || typeof entry !== "object") return [];
    const blocker = (entry as Record<string, unknown>).code;
    const questionId = (entry as Record<string, unknown>).questionId;
    const evidence = (entry as Record<string, unknown>).evidence;
    if (typeof blocker !== "string" || !allowed.has(blocker)) return [];
    if (typeof evidence !== "string" || evidence.trim().length === 0) return [];
    if (questionId !== undefined && questionId !== null && questionId !== "") {
      if (typeof questionId !== "string" || !questionIds.has(questionId)) return [];
      return [{ blocker: blocker as PaperGenerationBenchmarkBlocker, questionId, evidence: evidence.trim().slice(0, 300) }];
    }
    return [{ blocker: blocker as PaperGenerationBenchmarkBlocker, evidence: evidence.trim().slice(0, 300) }];
  });

  return {
    usable: raw.usable === true,
    scores,
    findings,
    comments: typeof raw.comments === "string" ? raw.comments.trim().slice(0, 1_200) : "",
  };
}

/**
 * The review the benchmark stores: the model's judgement and the arithmetic,
 * together, with any blocker from either making the paper unusable.
 */
export function combinePaperReview(ai: AiPaperReview, deterministic: readonly PaperReviewFinding[]) {
  const findings = [...deterministic, ...ai.findings];
  const blockers = [...new Set(findings.map((finding) => finding.blocker))];
  const lines = findings.map(
    (finding) => `${finding.blocker}${finding.questionId ? ` (${finding.questionId})` : ""}: ${finding.evidence}`
  );
  const comments = [ai.comments, ...lines].filter(Boolean).join("\n").slice(0, 2_000);
  return {
    usable: ai.usable && blockers.length === 0,
    scores: ai.scores,
    blockers,
    comments,
  };
}
