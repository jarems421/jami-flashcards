import "server-only";

import type { AiContentPart } from "@/lib/ai/content-parts";
import { candidateTextFromParts } from "@/lib/ai/evidence-grounding";
import { parsePracticePaperMarkingModelAnswer } from "@/lib/ai/practice-paper-marking";
import { classifyMarkingParseFailure } from "@/lib/ai/marking-parse-failure";
import {
  countAiInputTokens,
  generateAiText,
  type AiResponseDiagnostics,
} from "@/lib/ai/provider-router";
import {
  failoverProvidersFor,
  type AiGenerationRole,
  type AiReasoningEffort,
} from "@/lib/ai/provider-policy";
import type { QuestionTypeRule } from "@/lib/practice/question-types";
import {
  buildMarkerRequest,
  levelsAdjudicatorRole,
  marksByLevels,
} from "@/services/ai/practice-paper-marking-request.server";
import {
  markerTimeoutMs,
  PracticePaperMarkingFailedError,
  type MarkingCostAccounting,
  MARKER_STALL_TIMEOUT_MS,
  type PracticePaperMarkerStage,
  type PracticePaperMarkerStageResult,
} from "@/lib/practice/marker-stages";
import {
  assertCostRoom,
  costAccounting,
  failedStageCost,
  modelsUsed,
  PracticePaperMarkingCostLimitError,
  rethrowWithMarkingCost,
  successfulCost,
} from "@/lib/practice/marking-accounting";
import type {
  PracticePaper,
  PracticePaperMarkingAudit,
  PracticePaperResult,
} from "@/lib/practice/practice-papers";

export type PracticePaperMarkingInput = {
  paper: PracticePaper;
  answerParts: AiContentPart[];
  thirdViewParts?: AiContentPart[];
  originalPaperParts?: AiContentPart[];
  /**
   * Previously marked work, shown to the marker as calibration.
   *
   * Optional and absent in production today: this exists so the evaluation can
   * measure whether exemplars actually improve marking before the feature is
   * committed to. Omitting it produces byte-identical requests to before, so
   * the control arm really is the current behaviour rather than an
   * approximation of it.
   *
   * Exemplars are reference data, not instructions, and are labelled as such
   * in the prompt for the same reason student work is.
   */
  exemplarParts?: AiContentPart[];
  /**
   * Called when a report cannot be read, with the model's own output.
   *
   * Observation only, and off in production. "Invalid report" covered at least
   * five distinct faults, and without the raw text there was no way to tell a
   * truncated response from a refusal from one the parser discarded for
   * quoting no evidence.
   */
  onParseFailure?: (failure: {
    role: string;
    modelRole: string;
    raw: string;
    kind: string;
    detail: string;
    length: number;
  }) => void;
  /**
   * What one marker decided, before the ensemble combined it with anything.
   *
   * Observation only, off in production, and deliberately not part of the
   * marking audit: that audit is persisted against real student papers, and a
   * diagnostic has no business leaving a trace in their data.
   *
   * Every blind marker already produces full criterion decisions and the
   * pipeline throws them away -- `scoreMap` keeps question totals, and
   * `criterionMap` computes the rest only to detect a dispute before
   * discarding it. Keeping them is what makes a combination rule answerable
   * without building it: given what both markers said, whether requiring them
   * to agree would have marked better is arithmetic rather than another run.
   */
  onMarkerReport?: (report: {
    role: string;
    modelRole: string;
    questions: {
      questionId: string;
      awardedMarks: number;
      /** How sure the marker said it was, which nothing has yet checked. */
      confidence: string;
      criteria: {
        criterionId: string;
        awarded: boolean;
        schemeValue?: string;
        candidateValue?: string;
        /**
         * The marker's own quotation of the line it judged. Recorded because a
         * verdict can be read at scale but only evidence can be checked against
         * the page, and hand-reading five disagreements was what found the
         * generosity in the first place.
         */
        evidence?: string;
      }[];
    }[];
  }) => void;
  signal?: AbortSignal;
  deadlineAt: number;
  maxOutputTokens: number;
  callTimeoutMs?: number;
  logFallback?: (fields: Record<string, unknown>) => void;
  /** Successful provider calls may not cross this workflow-owned ceiling. */
  maxEstimatedCostUsd?: number;
  /**
   * Which per-call timeout policy to run.
   *
   * `durable` is what students get, and it is the absence of a policy: no
   * override at all, so every call falls through to `markerTimeoutMs`, the
   * timeout derived from what the role actually writes and how slowly the
   * slowest endpoint writes it.
   *
   * The other two exist because single-question marking once ran inside the
   * request that started it, under a 55-second route deadline, and had to
   * squeeze three sequential provider calls into it. `shipped` was that: two
   * tight attempts of 30 seconds with images and 20 without. `singleLongAttempt`
   * was the alternative to measure it against. Both were arithmetic about a
   * budget that no longer exists -- 30 seconds against a supervisor report the
   * measurements size at 408 -- and they are kept only so an evaluation can
   * still reproduce what the deadline used to do to a marking.
   */
  timeoutPolicy?: "durable" | "shipped" | "singleLongAttempt";
  /**
   * The largest request this workflow may send, in estimated tokens.
   *
   * Marking assembles more than the student's answer: the scheme, the original
   * page, a working image, and -- when two markers disagree -- both of their
   * full reports. Only the output was ever capped, so a long answer against a
   * banded scheme could send an adjudication request several times the size of
   * anything measured, and the first sign of it would be the bill.
   */
  inputTokenCap?: number | null;
  /**
   * A marking change switched off, so its effect can be measured.
   *
   * Evaluation only; production never sets it, and an unset variant is the
   * shipped marker. Each change was measured on one source, and the next source
   * pointed the other way, so a change has to be removable on the same answers
   * to be judged at all.
   */
  variant?: MarkingVariant;
  /**
   * How this board marks each kind of question in this subject, researched
   * from its own mark schemes (`services/practice/question-type-rules.server.ts`).
   * Preferred over the hand-written conventions wherever a question matches
   * one; absent, the hand-written conventions stand alone.
   */
  examinerPracticeRules?: QuestionTypeRule[];
  /** Server-only checkpoints used by durable workflows after a redeploy/retry. */
  cachedStageResults?: Partial<Record<PracticePaperMarkerStage, PracticePaperMarkerStageResult>>;
  onStageResult?: (
    stage: PracticePaperMarkerStage,
    result: PracticePaperMarkerStageResult
  ) => Promise<void>;
};

export type MarkingVariant = {
  /** The levels-of-response guidance for banded and weighted-trait questions. */
  levelsGuidance?: boolean;
  /** The board's examiner practice for each kind of question. */
  examinerPractice?: boolean;
  /** False to use only the hand-written conventions, never the researched rules. */
  researchedRules?: boolean;
  /** Which model settles a disputed levels-marked question. */
  levelsAdjudicator?: AiGenerationRole;
  /** False to adjudicate every disputed levels-marked question, however close the markers are. */
  settleCloseLevelsDisputes?: boolean;
  /** False to let the primary think on short point-marked questions too. */
  quickShortQuestions?: boolean;
  /** True to mark every question with the primary's thinking off, to measure what thinking buys. */
  quickAllQuestions?: boolean;
  /** False to let the primary think on levels-marked questions. */
  quickLevelsQuestions?: boolean;
  /** False to leave out how to read handwriting that runs across pages. */
  workAcrossPages?: boolean;
};

/**
 * The largest point-marked question whose primary marks without thinking.
 *
 * A student waiting on a two-mark answer was waiting on the supervisor's
 * thinking, not its report. Re-marking recent real attempts through the
 * production path, the primary spent 22 to 54 seconds writing 4,900 to 10,000
 * tokens on one- and two-mark questions, nearly all of it reasoning, while the
 * verifier beside it -- the same answer against the same scheme -- reported in
 * 8 to 12 seconds and 400 tokens. The marking cannot finish before the slower
 * of the two, so every short answer took the supervisor's full minute, and in
 * production the median one-or-two-mark question took 53 seconds.
 *
 * Off rather than reduced, because reduced does not happen: the supervisor's
 * endpoints ignore `low`, `minimal` and a token budget alike, and think for as
 * long as they would have anyway.
 *
 * Short and point-marked only. Each of those marks names one achievement the
 * scheme states, and the two blind markers are still compared criterion by
 * criterion, so a primary that missed something is caught by the verifier and
 * the dispute settled by an adjudicator that does think. Longer point-marked
 * questions keep their thinking.
 *
 * Levels-marked questions mark without it too, since October 2026. The
 * expectation had been that there the judgement is the work; measured, it was
 * not. On 74 real AQA and Pearson GCSE extended answers, paired, thinking off
 * moved 18 answers closer to the board's mark and 13 further (exact 25 -> 28),
 * and on 36 unseen double-marked Medly English answers it sat 1.22 marks from
 * the examiners' mean against 1.28, between the two examiners on 21 against
 * 19 (paired 7 closer, 10 further: noise both ways). The supervisor's median
 * call fell from 43 seconds to 8, and thinking calls were the ones that hit
 * the output ceiling or a two-minute 502. `--variant=slow-levels` is the
 * other arm. On point-marked maths over four marks it went the other way,
 * slightly (3 closer, 5 further), so those keep thinking.
 *
 * Measured, thinly, on handwritten Higher Maths questions of up to four marks
 * (`criterion-run --max-marks=4 --variant=slow-short` is the other arm): the
 * account ran out of credit part way, leaving seven records both arms marked.
 * On those the primary's own report matched the examiner on 6 of 7 without
 * thinking and 5 of 7 with it, the final marks were identical on the five both
 * finished, and across fourteen records the no-thinking arm's bias was -0.07
 * marks. It marked twice as many records in the same time. Re-run both arms
 * over all 28 before reading anything finer into it.
 */
const QUICK_MARKING_MAX_MARKS = 4;

function primaryReasoningEffort(paper: PracticePaper, variant?: MarkingVariant) {
  if (variant?.quickAllQuestions) return "none" as const;
  if (paper.questions.length !== 1) return undefined;
  if (marksByLevels(paper)) return variant?.quickLevelsQuestions === false ? undefined : ("none" as const);
  if (variant?.quickShortQuestions === false) return undefined;
  return paper.totalMarks <= QUICK_MARKING_MAX_MARKS ? ("none" as const) : undefined;
}

/**
 * A disputed essay whose two blind markers are within a mark of each other,
 * settled by the worker's report instead of an adjudicator.
 *
 * Adjudication is the slow step in marking an essay -- a second sequential
 * call of about 29 seconds after the two markers' 34, needed on 30 of 36
 * GCSE English answers. Replayed from the markers' own logged decisions,
 * taking the worker's report whenever the two were within one mark skipped 11
 * of those 30 adjudications with no loss of accuracy (average error from the
 * examiners 1.07 against 1.10), and 10 of the adjudications on handwritten
 * Chemistry and History answers at about the same accuracy. The worker is the
 * marker measured closer to examiners on levels-marked answers.
 *
 * Levels-marked questions only. On the 67 real maths scripts the same rule
 * would have skipped 15 of 25 adjudications and got two answers wrong that
 * adjudication got right: a mark of difference on a four-mark question is a
 * real disagreement, and one on a twenty-mark essay is ordinary marking noise.
 */
function closeLevelsDispute(
  paper: PracticePaper,
  primary: PracticePaperResult,
  verifier: PracticePaperResult,
  variant?: MarkingVariant
) {
  if (variant?.settleCloseLevelsDisputes === false || !marksByLevels(paper)) return false;
  const left = primary.questionResults[0]?.awardedMarks;
  const right = verifier.questionResults[0]?.awardedMarks;
  return typeof left === "number" && typeof right === "number" && Math.abs(left - right) <= 1;
}

export {
  PracticePaperMarkingFailedError,
  type MarkingCostAccounting,
  type PracticePaperMarkerStage,
  type PracticePaperMarkerStageResult,
} from "@/lib/practice/marker-stages";

/**
 * Refused before the provider call rather than after it.
 *
 * Named rather than generic so the route can tell a student their answer was
 * too long to mark -- which is actionable -- instead of "Jami couldn't mark
 * this one", which is not.
 */
export class PracticePaperMarkingInputTooLargeError extends Error {
  constructor(readonly inputTokens: number, readonly inputTokenCap: number) {
    super("input_too_large");
    this.name = "PracticePaperMarkingInputTooLargeError";
  }
}

async function checkpointedMarkerCall(
  input: PracticePaperMarkingInput,
  stage: PracticePaperMarkerStage,
  operation: () => Promise<PracticePaperMarkerStageResult>
) {
  const cached = input.cachedStageResults?.[stage];
  if (cached) return cached;
  const completed = await operation();
  await input.onStageResult?.(stage, completed);
  return completed;
}

/**
 * How long each model gets, derived from what it actually writes.
 *
 * The number this replaces asked to be replaced: "180 seconds is deliberately
 * generous rather than tuned ... tighten it once the distribution is properly
 * known rather than leaving it here by default." Six calls were the sample
 * then. There are now 3,880.
 *
 * A marking timeout is not a patience budget, it is a token budget wearing a
 * clock's clothes, and reading it as a clock has now been wrong three times.
 * A report either fits in the time or is cut off mid-JSON and thrown away, so
 * the only honest way to choose the number is to divide what the role writes by
 * how fast the slowest endpoint writes it.
 *
 * Both halves are measured. Output per role, p99 over every logged call:
 * worker 1,636 tokens, supervisor 7,600, juror 9,598. Generation rate, p5 over
 * all 3,880: 23.3 tokens per second, which is DeepInfra having a bad day.
 *
 * What that exposes is not a rounding error. The supervisor marks the paper and
 * then adjudicates disputes, and its p99 report needs 327 seconds against a
 * ceiling of 60. The juror needs 412 against 180. So the ensemble's two most
 * expensive roles could not finish their work on the fast endpoint at all: they
 * spent a minute, failed, and did it again somewhere slower. That is why
 * coursework markings took 272 minutes for eight records.
 */

const fallbackTimeoutMs = markerTimeoutMs;

export { markerTimeoutMs };

async function callMarker(input: PracticePaperMarkingInput & {
  role: "primary" | "verifier" | "adjudicator" | "third-view";
  modelRole: AiGenerationRole;
  extraPrompt?: string;
  /** Left unset, the role's own effort applies. */
  reasoningEffort?: AiReasoningEffort | "none";
}) {
  const diagnostics: AiResponseDiagnostics[] = [];
  /*
   * Attempts that produced no diagnostic of their own. `onResponse` fires only
   * for a response that came back, so a failover or an abort leaves no trace
   * here -- and those are exactly the attempts that may have been billed for
   * work this side never received.
   */
  let unseenAttempts = 0;
  const request = buildMarkerRequest(input);
  /*
   * Measured on the request that is actually about to be sent, which is the
   * only thing that includes the adjudicator's copy of both marker reports.
   * The count is a local estimate, so this costs nothing.
   */
  if (typeof input.inputTokenCap === "number") {
    const inputTokens = await countAiInputTokens({ role: input.modelRole, request });
    if (inputTokens > input.inputTokenCap) {
      throw new PracticePaperMarkingInputTooLargeError(inputTokens, input.inputTokenCap);
    }
  }
  /*
   * A report that came back unreadable without thinking is asked again with it.
   *
   * Benchmarked on short handwritten maths, one primary marking without
   * thinking returned a report the parser rejected on both of its attempts, for
   * an answer the thinking primary read first time. A retry is already the
   * slow path, so it takes the role's own effort rather than failing the same
   * way twice and leaving the student with no mark at all.
   */
  const retryEffort = input.reasoningEffort === "none" ? undefined : input.reasoningEffort;
  const call = (
    providerOverride: readonly string[] | undefined,
    reasoningEffort: AiReasoningEffort | "none" | undefined
  ) => generateAiText({
    role: input.modelRole,
    ...(providerOverride?.length ? { providerOverride } : {}),
    taskClass: input.role === "verifier" ? "standard" : "important",
    ...(reasoningEffort ? { reasoningEffort } : {}),
    timeoutMs: input.callTimeoutMs ?? (providerOverride?.length
      ? fallbackTimeoutMs(input.modelRole)
      : markerTimeoutMs(input.modelRole)),
    fallbackTimeoutMs: input.callTimeoutMs ?? fallbackTimeoutMs(input.modelRole),
    stallTimeoutMs: MARKER_STALL_TIMEOUT_MS,
    deadlineAt: input.deadlineAt,
    signal: input.signal,
    generationConfig: {
      temperature: 0.05,
      topP: 0.75,
      maxOutputTokens: input.maxOutputTokens,
      responseMimeType: "application/json",
    },
    request,
    onResponse: (value) => diagnostics.push(value),
    onRetry: (value) => {
      unseenAttempts += 1;
      input.logFallback?.({ ...value, markerRole: input.role });
    },
  });

  const diagnose = (raw: string) =>
    classifyMarkingParseFailure({
      raw,
      expectedQuestionIds: input.paper.questions.map((question) => question.id),
      maxMarksByQuestion: Object.fromEntries(
        input.paper.questions.map((question) => [question.id, question.marks])
      ),
    });

  /**
   * How many attempts a failure is worth, and where they go.
   *
   * An empty `{}` is a two-byte response the supervisor's endpoint returns for
   * no reason anyone could find: not the prompt, not its length, not the
   * exemplars, not concurrency, not the time of the run. Six probes ruled each
   * of those out.
   *
   * What they did establish is that it is *sticky*. Of thirteen affected calls
   * in one run, eight returned `{}` on every one of four attempts. So asking
   * the same endpoint again is close to worthless, and the retry deliberately
   * moves to the role's approved failover instead — the same model at the same
   * precision and price, hosted elsewhere. Three attempts, because a fourth on
   * a second endpoint buys little that the move itself did not.
   *
   * Every other failure keeps its single retry on the primary. Those come back
   * as full responses and cost real money, and none of them has shown the
   * endpoint-sticky behaviour this exists for.
   */
  const isEmpty = (kind: string | undefined) => kind === "empty_object" || kind === "empty";
  /**
   * A truncated report is the one failure a retry cannot help.
   *
   * The others come back whole and wrong, and asking again can produce
   * something different. Truncation means the report did not fit in the budget,
   * and the same call with the same budget will not fit either -- so the retry
   * was a guaranteed second failure that cost real money before recording the
   * refusal it was always going to record.
   *
   * It should also now be rare. It was mostly the clock rather than the token
   * cap, and the clock is derived from what the role writes rather than picked.
   * What remains is a genuinely enormous report: the longest supervisor call
   * observed ran to 16,491 tokens, and at the floor rate a report that size
   * outruns even the derived timeout. If that starts appearing, the answer is a
   * terser evidence instruction rather than more patience.
   */
  /**
   * Except when the budget went on thinking, which the retry can turn off.
   *
   * Measured on 175 GCSE maths answers (Oct 2026): three markings failed
   * because the supervisor thought until it hit the 16,000-token ceiling and
   * its report was cut off; the report itself is a few hundred tokens. Thinking
   * off is the mode short questions already mark in, and the supervisor's
   * endpoints honour only "none" (the GLM worker rejects it, so this is the
   * supervisor's alone). A marked answer from a marker that did not think is
   * still checked by the blind verifier; a refusal is no mark at all.
   */
  const thinkingCanBeSwitchedOff =
    input.modelRole === "supervisor" && input.reasoningEffort !== "none";
  const attemptsFor = (kind: string | undefined) =>
    isEmpty(kind) ? 3 : kind === "truncated" ? (thinkingCanBeSwitchedOff ? 2 : 1) : 2;

  /*
   * What the student typed, so a quotation can be looked for in it. Taken from
   * the parts this marker was actually shown rather than from the attempt, so
   * the check covers the evidence the report could have drawn on.
   */
  const candidate = {
    text: candidateTextFromParts(input.answerParts),
    hasUntypedWorking: input.answerParts.some((part) => "inlineData" in part),
  };

  let generated = await call(undefined, input.reasoningEffort);
  let result = parsePracticePaperMarkingModelAnswer(generated, input.paper, candidate);
  let failure = result ? null : diagnose(generated);

  for (let attempt = 1; !result && attempt < attemptsFor(failure?.kind); attempt += 1) {
    input.logFallback?.({
      role: input.role,
      modelRole: input.modelRole,
      error: "invalid_structured_marking_report",
      parseFailure: failure?.kind,
      attempt,
    });
    input.onParseFailure?.({
      role: input.role,
      modelRole: input.modelRole,
      raw: generated,
      kind: failure?.kind ?? "unknown",
      detail: failure?.detail ?? "",
      length: failure?.length ?? generated.length,
    });
    // A sticky empty response is the one failure a different endpoint fixes.
    const failover = isEmpty(failure?.kind) ? failoverProvidersFor(input.modelRole) : [];
    generated = await call(failover, failure?.kind === "truncated" ? "none" : retryEffort);
    result = parsePracticePaperMarkingModelAnswer(generated, input.paper, candidate);
    failure = result ? null : diagnose(generated);
  }
  if (!result && failure) {
    input.onParseFailure?.({
      role: input.role,
      modelRole: input.modelRole,
      raw: generated,
      kind: failure.kind,
      detail: failure.detail,
      length: failure.length,
    });
  }
  /*
   * Never coerced into a score: a report that could not be read means the
   * marking did not happen, and the caller records a refusal.
   *
   * It carries its bill, though. Every attempt here came back with text -- that
   * is what made it parseable enough to reject -- so unless one of them failed
   * over invisibly, what this cost is known rather than merely unpaid-for.
   */
  if (!result) {
    const accounting = costAccounting(diagnostics);
    throw new PracticePaperMarkingFailedError(
      `${input.role} marker returned an invalid report (${failure?.kind ?? "unknown"}: ${failure?.detail ?? ""})`,
      accounting,
      accounting.unreportedCalls === 0 && unseenAttempts === 0
    );
  }
  input.onMarkerReport?.({
    role: input.role,
    modelRole: input.modelRole,
    questions: result.questionResults.map((question) => ({
      questionId: question.questionId,
      awardedMarks: question.awardedMarks,
      confidence: question.confidence,
      criteria: (question.criterionResults ?? []).flatMap((criterion) =>
        criterion.criterionId
          ? [
              {
                criterionId: criterion.criterionId,
                awarded: criterion.awarded,
                // Recorded so a run can be checked for whether the comparison
                // was actually stated, rather than assumed because it was asked
                // for. A field the model quietly omits looks identical to one it
                // filled in, everywhere except here.
                ...(criterion.schemeValue ? { schemeValue: criterion.schemeValue } : {}),
                ...(criterion.candidateValue
                  ? { candidateValue: criterion.candidateValue }
                  : {}),
                ...(criterion.evidence ? { evidence: criterion.evidence } : {}),
              },
            ]
          : []
      ),
    })),
  });

  return { result, diagnostics };
}

function scoreMap(result: PracticePaperResult) {
  return Object.fromEntries(
    result.questionResults.map((question) => [question.questionId, question.awardedMarks])
  );
}

/**
 * A question's criterion verdicts, keyed by the scheme's id.
 *
 * Only criteria carrying an id are included. Prose is deliberately not used as
 * a fallback key: it is written independently by two different models and
 * never matches, so keying on it made every marking a dispute.
 */
function criterionMap(result: PracticePaperResult, questionId: string) {
  return new Map(
    result.questionResults
      .find((question) => question.questionId === questionId)
      ?.criterionResults?.flatMap((criterion) =>
        criterion.criterionId
          ? [
              [
                criterion.criterionId,
                {
                  awarded: criterion.awarded,
                  marks: typeof criterion.awardedMarks === "number" ? criterion.awardedMarks : null,
                },
              ] as const,
            ]
          : []
      ) ?? []
  );
}

/**
 * Whether two markers actually agree about one criterion.
 *
 * The boolean is exact only where a criterion is worth one mark. On a criterion
 * worth several, two markers giving 2 and 1 both wrote `awarded: true`, and on
 * a two-criterion question 2 + 1 against 1 + 2 also totals the same -- so a
 * real disagreement about where the marks went passed both checks and never
 * reached reconciliation.
 *
 * Where only one marker stated a number, the boolean is all they have in
 * common, and an unstated number is not a stated zero.
 */
function criteriaAgree(
  left: { awarded: boolean; marks: number | null },
  right: { awarded: boolean; marks: number | null }
) {
  if (left.marks !== null && right.marks !== null) return left.marks === right.marks;
  return left.awarded === right.awarded;
}

export function comparePracticePaperMarkings(
  primary: PracticePaperResult,
  verifier: PracticePaperResult
) {
  return primary.questionResults.flatMap((question) => {
    const other = verifier.questionResults.find(
      (candidate) => candidate.questionId === question.questionId
    );
    if (!other || other.awardedMarks !== question.awardedMarks) return [question.questionId];
    // Only criteria both markers ruled on. One marker mentioning a criterion
    // the other passed over is not a disagreement about the work, and treating
    // it as one -- which taking the union did -- disputed every marking ever
    // made, including ones where both awarded exactly the same mark.
    const leftCriteria = criterionMap(primary, question.questionId);
    const rightCriteria = criterionMap(verifier, question.questionId);
    const shared = [...leftCriteria.keys()].filter((id) => rightCriteria.has(id));
    return shared.some((id) => !criteriaAgree(leftCriteria.get(id)!, rightCriteria.get(id)!))
      ? [question.questionId]
      : [];
  });
}

/**
 * Interactive one-question marking. Easy cases return after one strong marker;
 * high-risk or ambiguous cases receive the same blind comparison discipline as
 * paper marking without paying that cost for every short recall question.
 */
export async function markSingleQuestionAdaptively(
  input: PracticePaperMarkingInput & { forceVerification?: boolean }
) {
  if (input.paper.questions.length !== 1) {
    throw new Error("Adaptive question marking requires exactly one question.");
  }

  const diagnostics: AiResponseDiagnostics[] = [];
  let primaryNeededParseRetry = false;
  /*
   * How long one call gets, and what happens when it runs out.
   *
   * The default is to say nothing. `markerTimeoutMs` already derives a per-role
   * timeout from the p99 report length and the p5 generation rate, and nothing
   * here knows better than that. Overriding it was never a judgement about
   * marking: it was the 55-second route deadline being divided up, and it gave
   * the supervisor 30 seconds for a report those same measurements size at 408.
   * Measured successful image markings ran 9.6 to 28.6 seconds, so the ceiling
   * sat inside the observed range -- some real markings hit it, and one of them
   * is why this comment exists.
   *
   * The two overrides are kept so an evaluation can still reproduce what the
   * deadline did to a marking. Neither is what a student gets.
   */
  const hasImages = [...input.answerParts, ...(input.originalPaperParts ?? [])].some(
    (part) => "inlineData" in part
  );
  const policy = input.timeoutPolicy ?? "durable";
  const callTimeoutMs =
    input.callTimeoutMs ??
    (policy === "durable"
      ? undefined
      : policy === "singleLongAttempt"
        ? hasImages
          ? 50_000
          : 40_000
        : hasImages
          ? 30_000
          : 20_000);
  /*
   * Each stage is a checkpoint, because each stage is money.
   *
   * A marking that threw after two markers had reported used to lose both of
   * them. The route wrote `marking_failed`, refunded the student's daily
   * allowance -- which is not the money that was spent -- and the retry bought
   * the same two reports again. Under a durable job the stages that already
   * completed are read back instead, so a resumed marking pays only for the
   * work still missing.
   */
  const quickEffort = primaryReasoningEffort(input.paper, input.variant);
  const runPrimary = () => checkpointedMarkerCall(input, "primary", async () => {
    let neededParseRetry = false;
    const completed = await callMarker({
      ...input,
      callTimeoutMs,
      onParseFailure: (failure) => { neededParseRetry = true; input.onParseFailure?.(failure); },
      role: "primary",
      modelRole: "supervisor",
      ...(quickEffort ? { reasoningEffort: quickEffort } : {}),
    });
    return { ...completed, neededParseRetry };
  });
  const runVerifier = () => checkpointedMarkerCall(input, "verifier", () => callMarker({
    ...input,
    callTimeoutMs,
    role: "verifier",
    modelRole: "worker",
  }));

  let primary: PracticePaperMarkerStageResult;
  let verifier: PracticePaperMarkerStageResult | undefined;
  if (input.forceVerification) {
    /*
     * Settled, not `all`, so a marker that reported stays on the books.
     *
     * The two run together, so when one throws the other has often already
     * answered and been billed. `Promise.all` rejects on the first failure and
     * drops the other outcome, and with it a provider call that was genuinely
     * paid for -- the failure was then reported as costing less than it did,
     * and `haltOnUnreportedCost` had one fewer call to see.
     *
     * Either failure still fails the marking. A forced verification is the
     * guarantee that the mark was checked before the student saw it, and one
     * report is not that guarantee; the retry buys the missing stage back from
     * its checkpoint rather than re-running both.
     */
    const [primaryOutcome, verifierOutcome] = await Promise.allSettled([runPrimary(), runVerifier()]);
    if (primaryOutcome.status === "rejected") {
      return rethrowWithMarkingCost(
        primaryOutcome.reason,
        [...diagnostics, ...(verifierOutcome.status === "fulfilled" ? verifierOutcome.value.diagnostics : [])],
        failedStageCost(verifierOutcome)
      );
    }
    if (verifierOutcome.status === "rejected") {
      return rethrowWithMarkingCost(verifierOutcome.reason, [
        ...diagnostics,
        ...primaryOutcome.value.diagnostics,
      ]);
    }
    primary = primaryOutcome.value;
    verifier = verifierOutcome.value;
  } else {
    try {
      primary = await runPrimary();
    } catch (error) {
      return rethrowWithMarkingCost(error, diagnostics);
    }
  }
  primaryNeededParseRetry = primary.neededParseRetry ?? false;
  /*
   * A checkpoint brings its diagnostics with it, and they are counted.
   *
   * The money was spent on this marking, on an earlier attempt at it. Both
   * things reading these care about the marking rather than the run: the audit
   * says what marking this answer cost, and the ceiling says what one marking
   * may cost before it is stopped. Dropping a resumed stage's cost would let a
   * marking that failed repeatedly spend without limit, one attempt at a time.
   */
  diagnostics.push(...primary.diagnostics, ...(verifier?.diagnostics ?? []));

  const primaryQuestion = primary.result.questionResults[0];
  /*
   * A mark nobody could reconcile buys the second marker.
   *
   * `unverifiable` means the marker gave a total and no criterion awards that
   * could be checked against the scheme -- so the number rests on nothing that
   * can be inspected. That is a measurable signal of exactly the kind the
   * post-check exists for, and a better one than the model's own confidence,
   * which the corpus work found generous and uninformative.
   */
  const primaryUnverifiable = primaryQuestion?.markConsistency?.status === "unverifiable";
  const needsPostCheck =
    !verifier &&
    (primaryNeededParseRetry ||
      primaryUnverifiable ||
      primaryQuestion?.confidence === "low" ||
      Boolean(primaryQuestion?.transcriptionNote));
  if (needsPostCheck) {
    try {
      verifier = await runVerifier();
    } catch (error) {
      return rethrowWithMarkingCost(error, diagnostics);
    }
    diagnostics.push(...verifier.diagnostics);
  }

  let result = primary.result;
  let adjudicated = false;
  if (verifier) {
    const disputed = comparePracticePaperMarkings(primary.result, verifier.result);
    if (disputed.length > 0 && closeLevelsDispute(input.paper, primary.result, verifier.result, input.variant)) {
      result = verifier.result;
    } else if (disputed.length > 0) {
      let adjudication;
      try {
        adjudication = await checkpointedMarkerCall(input, "adjudication", () => callMarker({
        ...input,
        callTimeoutMs,
        role: "adjudicator",
        modelRole: levelsAdjudicatorRole(input.paper, undefined, input.variant),
        extraPrompt: `Resolve this one disputed question from two independent reports. Neither report has priority.\nReport A: ${JSON.stringify(primary.result.questionResults)}\nReport B: ${JSON.stringify(verifier.result.questionResults)}`,
        }));
      } catch (error) {
        return rethrowWithMarkingCost(error, diagnostics);
      }
      diagnostics.push(...adjudication.diagnostics);
      result = adjudication.result;
      adjudicated = true;
    }
  }

  return {
    result,
    estimatedCostUsd: successfulCost(diagnostics),
    costAccounting: costAccounting(diagnostics),
    models: modelsUsed(diagnostics),
    audit: {
      primaryScore: primary.result.questionResults[0]?.awardedMarks ?? 0,
      verifierScore: verifier?.result.questionResults[0]?.awardedMarks,
      adaptivelyVerified: Boolean(verifier),
      adjudicated,
    },
  };
}

/** One student-requested, independent view of an already marked question. */
export async function reviewSingleQuestionIndependently(
  input: PracticePaperMarkingInput & { originalResult: PracticePaperResult }
) {
  if (input.paper.questions.length !== 1) {
    throw new Error("Question review requires exactly one question.");
  }
  const juror = await checkpointedMarkerCall(input, "juror", () => callMarker({
    ...input,
    role: "third-view",
    modelRole: "juror",
    extraPrompt:
      "Mark this response independently from the official scheme. Do not assume the existing mark is right; identify the student's exact evidence for every award.",
  }));
  const diagnostics = [...juror.diagnostics];
  const disputed = comparePracticePaperMarkings(input.originalResult, juror.result);
  let result = input.originalResult;
  let reconciled = false;
  if (disputed.length > 0) {
    const reconciliation = await checkpointedMarkerCall(input, "final_reconciliation", () => callMarker({
      ...input,
      role: "adjudicator",
      modelRole: "supervisor",
      extraPrompt: `Reconcile the existing result with an independent review. Apply the official scheme and return the complete final report.\nExisting result: ${JSON.stringify(input.originalResult.questionResults)}\nIndependent review: ${JSON.stringify(juror.result.questionResults)}`,
    })).catch((error: unknown) => rethrowWithMarkingCost(error, diagnostics));
    diagnostics.push(...reconciliation.diagnostics);
    result = reconciliation.result;
    reconciled = true;
  }
  return {
    result,
    estimatedCostUsd: successfulCost(diagnostics),
    audit: {
      jurorScore: juror.result.questionResults[0]?.awardedMarks ?? 0,
      reviewedScore: result.questionResults[0]?.awardedMarks ?? 0,
      changed: disputed.length > 0,
      reconciled,
    },
    costAccounting: costAccounting(diagnostics),
    models: modelsUsed(diagnostics),
  };
}

/**
 * Which disputed questions deserve the independent third view.
 *
 * This deliberately does not consult the marker's own `confidence`. Models
 * report confidence in a narrow, generous band and almost never emit "low", so
 * routing on it produced a safety net that looked present and never caught
 * anything. The two signals here are observable from outside the model: how far
 * apart the blind markers actually landed, and whether reading the work was
 * flagged as ambiguous. A single mark of daylight is ordinary marking variance;
 * two or more is a substantive disagreement about the work.
 */
export function selectThirdViewQuestionIds(input: {
  adjudicated: PracticePaperResult;
  primary: PracticePaperResult;
  verifier: PracticePaperResult;
  disputedQuestionIds: string[];
}) {
  const marksFor = (marking: PracticePaperResult, questionId: string) =>
    marking.questionResults.find((item) => item.questionId === questionId)?.awardedMarks;

  return input.adjudicated.questionResults
    .filter((question) => {
      if (!input.disputedQuestionIds.includes(question.questionId)) return false;
      if (question.transcriptionNote) return true;
      const left = marksFor(input.primary, question.questionId);
      const right = marksFor(input.verifier, question.questionId);
      if (left === undefined || right === undefined) return true;
      return Math.abs(left - right) >= 2;
    })
    .map((question) => question.questionId);
}

export async function markPracticePaperWithAudit(input: PracticePaperMarkingInput): Promise<{
  result: PracticePaperResult;
  audit: PracticePaperMarkingAudit;
  estimatedCostUsd: number;
  costAccounting: MarkingCostAccounting;
  /** The models that actually answered, which routing can change mid-run. */
  models: string[];
}> {
  // Blind markers run concurrently. The verifier sees the paper, rubric and
  // original answers, but never the primary marker's scores.
  const [primary, verifier] = await Promise.all([
    checkpointedMarkerCall(input, "primary", () => callMarker({
      ...input,
      role: "primary",
      modelRole: "supervisor",
    })),
    checkpointedMarkerCall(input, "verifier", () => callMarker({
      ...input,
      role: "verifier",
      modelRole: "worker",
    })),
  ]);
  const disputedQuestionIds = comparePracticePaperMarkings(
    primary.result,
    verifier.result
  );
  let result = primary.result;
  let adjudicatedQuestionIds: string[] = [];
  let thirdViewQuestionIds: string[] = [];
  const diagnostics: AiResponseDiagnostics[] = [
    ...primary.diagnostics,
    ...verifier.diagnostics,
  ];

  if (disputedQuestionIds.length > 0) {
    assertCostRoom(input.maxEstimatedCostUsd, diagnostics);
    const disputedFrom = (marking: PracticePaperResult) =>
      marking.questionResults.filter((item) =>
        disputedQuestionIds.includes(item.questionId)
      );
    // Whichever report is presented first wins disputes more often than it
    // should, so neither marker is named and the order is drawn per marking.
    // The adjudicator returns a whole report, so nothing needs unmapping.
    const primaryFirst = Math.random() < 0.5;
    const [firstReport, secondReport] = primaryFirst
      ? [primary.result, verifier.result]
      : [verifier.result, primary.result];
    const adjudication = await checkpointedMarkerCall(input, "adjudication", () => callMarker({
      ...input,
      role: "adjudicator",
      modelRole: levelsAdjudicatorRole(input.paper, disputedQuestionIds, input.variant),
      extraPrompt: `Resolve only these disputed questions: ${disputedQuestionIds.join(", ")}.
Two independent markers of equal standing produced these reports. Neither has priority; judge each disputed question on the fixed guide and the student's own work.
Report A: ${JSON.stringify(disputedFrom(firstReport))}
Report B: ${JSON.stringify(disputedFrom(secondReport))}
Return the complete final report for every question, preserving agreed questions unless the fixed rubric proves a deterministic error.`,
    }));
    result = adjudication.result;
    diagnostics.push(...adjudication.diagnostics);
    adjudicatedQuestionIds = disputedQuestionIds;
    thirdViewQuestionIds = selectThirdViewQuestionIds({
      adjudicated: result,
      primary: primary.result,
      verifier: verifier.result,
      disputedQuestionIds,
    });
  }

  // The third view is an extra safeguard over questions the adjudicator has
  // already resolved, so losing it must not lose the marking with it. If the
  // juror is unavailable -- an outage, or OPENROUTER_JUROR_KILL_SWITCH thrown
  // deliberately, which the runbook offers as a juror-only measure -- the
  // adjudicated result stands, exactly as it would had no question qualified.
  //
  // Adjudication itself is not treated this way and should not be: it resolves
  // a genuine disagreement between two markers, and silently shipping one of
  // them would bury the conflict rather than settle it.
  try {
    if (thirdViewQuestionIds.length > 0) assertCostRoom(input.maxEstimatedCostUsd, diagnostics);
    const thirdView = await runThirdView({
      input,
      result,
      primary: primary.result,
      verifier: verifier.result,
      thirdViewQuestionIds,
    });
    result = thirdView.result;
    diagnostics.push(...thirdView.diagnostics);
  } catch (error) {
    if (error instanceof PracticePaperMarkingCostLimitError) throw error;
    if (input.signal?.aborted) throw error;
    input.logFallback?.({
      role: "third-view",
      modelRole: "juror",
      error,
      degradedToAdjudication: true,
    });
    // The audit must not claim a third view that never happened.
    thirdViewQuestionIds = [];
  }

  return {
    result,
    estimatedCostUsd: successfulCost(diagnostics),
    costAccounting: costAccounting(diagnostics),
    models: modelsUsed(diagnostics),
    audit: {
      version: 1,
      primaryScores: scoreMap(primary.result),
      verifierScores: scoreMap(verifier.result),
      disputedQuestionIds,
      adjudicatedQuestionIds,
      thirdViewQuestionIds,
      createdAt: Date.now(),
    },
  };
}

async function runThirdView(context: {
  input: PracticePaperMarkingInput;
  result: PracticePaperResult;
  primary: PracticePaperResult;
  verifier: PracticePaperResult;
  thirdViewQuestionIds: string[];
}) {
  const { input, primary, verifier, thirdViewQuestionIds } = context;
  let result = context.result;
  const diagnostics: AiResponseDiagnostics[] = [];
  if (thirdViewQuestionIds.length > 0) {
    const unresolved = new Set(thirdViewQuestionIds);
    const filteredThirdViewParts = filterReferencePartsForQuestions(
      input.thirdViewParts ?? input.answerParts,
      unresolved
    );
    const jurorPaper: PracticePaper = {
      ...input.paper,
      questions: input.paper.questions.filter((question) => unresolved.has(question.id)),
      choiceGroups: [],
      totalMarks: input.paper.questions
        .filter((question) => unresolved.has(question.id))
        .reduce((total, question) => total + question.marks, 0),
      markScheme: {
        ...input.paper.markScheme,
        items: input.paper.markScheme.items.filter((item) =>
          unresolved.has(item.questionId)
        ),
      },
      gradeGuidance: {
        kind: "none",
        label: "Question-only independent view",
        notice: "",
        boundaries: [],
      },
    };
    const third = await checkpointedMarkerCall(input, "juror", () => callMarker({
      ...input,
      paper: jurorPaper,
      answerParts: filteredThirdViewParts,
      thirdViewParts: filteredThirdViewParts,
      originalPaperParts: undefined,
      role: "third-view",
      modelRole: "juror",
      extraPrompt: `Give an independent visual reading and mark only these unresolved questions: ${thirdViewQuestionIds.join(", ")}.
Dispute summary: ${JSON.stringify(thirdViewQuestionIds.map((questionId) => ({
  questionId,
  primary: primary.questionResults.find((item) => item.questionId === questionId)?.awardedMarks,
  verifier: verifier.questionResults.find((item) => item.questionId === questionId)?.awardedMarks,
  adjudicated: result.questionResults.find((item) => item.questionId === questionId)?.awardedMarks,
})))}. Return a complete report shape for these questions only.`,
    }));
    diagnostics.push(...third.diagnostics);
    assertCostRoom(input.maxEstimatedCostUsd, diagnostics);
    const final = await checkpointedMarkerCall(input, "final_reconciliation", () => callMarker({
      ...input,
      role: "adjudicator",
      modelRole: "supervisor",
      extraPrompt: `Produce the final complete report. Give special attention to ${thirdViewQuestionIds.join(", ")}.
Previous adjudication: ${JSON.stringify(result.questionResults)}
Independent visual third view: ${JSON.stringify(third.result.questionResults.filter((item) => thirdViewQuestionIds.includes(item.questionId)))}`,
    }));
    diagnostics.push(...final.diagnostics);
    result = final.result;
  }
  return { result, diagnostics };
}

function filterReferencePartsForQuestions(
  parts: readonly AiContentPart[],
  questionIds: ReadonlySet<string>
) {
  const selected: AiContentPart[] = [];
  let include = false;
  for (const part of parts) {
    if ("text" in part && part.text.startsWith("--- BEGIN UNTRUSTED REFERENCE")) {
      include = [...questionIds].some((questionId) => part.text.includes(questionId));
    }
    if (include) selected.push(part);
    if ("text" in part && part.text.startsWith("--- END UNTRUSTED REFERENCE")) {
      include = false;
    }
  }
  return selected;
}
