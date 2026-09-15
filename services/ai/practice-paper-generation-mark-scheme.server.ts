import { questionFingerprint } from "@/lib/ai/generation-checkpoint";
import {
  canonicalizeGeneratedMarkSchemeItems,
  normalizeGeneratedMarkSchemeBatch,
  partitionMarkSchemeQuestions,
  type ParsedPracticePaperModelAnswer,
} from "@/lib/ai/practice-paper-generation";
import { markSchemeIssues, sameFixedPaper } from "@/lib/ai/practice-paper-quality";
import type { AiGenerationRole } from "@/lib/ai/provider-policy";
import { normalizePracticePaperMarkScheme } from "@/lib/practice/practice-papers";
import type { ReadyPracticePaper } from "@/services/ai/practice-paper-generation-design.server";
import {
  parseJsonObject,
  type GenerationContents,
  type GenerationStageInput,
} from "@/services/ai/practice-paper-generation-passes.server";
import { MARK_SCHEME_INSTRUCTION } from "@/services/ai/practice-paper-generation-prompts.server";
import {
  MARK_SCHEME_BATCH_TIMEOUT_MS,
  failure,
} from "@/services/ai/practice-paper-generation-request.server";

/**
 * The mark-scheme stage: a scheme written for the fixed paper in parallel
 * batches, repaired where it is structurally wrong, and refused when it cannot
 * be made dependable.
 */

/**
 * Returns the paper carrying its scheme, or the refunded failure that ends the
 * request. A batch still unreadable after its retry throws, which the request
 * reports as a provider failure.
 */
export async function buildPracticePaperMarkScheme(
  input: GenerationStageInput & {
    draft: ReadyPracticePaper;
    evidenceContents: GenerationContents;
    markSchemeRole: AiGenerationRole;
  }
): Promise<Response | ReadyPracticePaper> {
  const { runPass, refund, log, draft, evidenceContents, markSchemeRole } = input;
  const markSchemeInstruction = MARK_SCHEME_INSTRUCTION;
  const questionBatches = partitionMarkSchemeQuestions(draft.questions);
  const generatedItems: unknown[] = [];
  const batchShape = (value: unknown, questions: typeof draft.questions) => {
    const items = Array.isArray(value) ? value : [];
    const questionIds = new Set(questions.map((question) => question.id));
    const acceptedMarkings = new Set([
      "additive",
      "pointPool",
      "banded",
      "weightedTraits",
      "competency",
    ]);
    return {
      expectedItemCount: questions.length,
      returnedItemCount: items.length,
      exactQuestionIdMatches: items.filter((item) =>
        item && typeof item === "object" && questionIds.has(String((item as Record<string, unknown>).questionId ?? (item as Record<string, unknown>).id ?? ""))
      ).length,
      stringMarkingFields: items.filter((item) =>
        item && typeof item === "object" && typeof ((item as Record<string, unknown>).marking ?? (item as Record<string, unknown>).markingModel) === "string"
      ).length,
      acceptedMarkingFields: items.filter((item) => {
        if (!item || typeof item !== "object") return false;
        const candidate = (item as Record<string, unknown>).marking ?? (item as Record<string, unknown>).markingModel;
        return typeof candidate === "string" && acceptedMarkings.has(candidate);
      }).length,
    };
  };
  /*
   * Batches in parallel waves. Each batch is its own independent call, and
   * run one at a time a 25-question paper made thirteen calls in a row -- the
   * longest wait in the whole pipeline. Capped, because the provider
   * rate-limits and a burst of retries costs more than it saves.
   */
  const markSchemeConcurrency = Math.max(
    1,
    Math.min(8, Number.parseInt(process.env.PRACTICE_PAPER_MARK_SCHEME_CONCURRENCY ?? "", 10) || 4)
  );
  /*
   * A pool rather than waves: each slot takes the next batch the moment it
   * frees. In waves one slow endpoint held its finished neighbours -- a batch
   * that took 113 seconds kept three 10-second batches, and everything queued
   * behind them, waiting.
   */
  const batchResults: Array<{
    questions: (typeof questionBatches)[number];
    batchNumber: number;
    pass: Awaited<ReturnType<typeof runPass>>;
  }> = [];
  let nextBatch = 0;
  const runMarkSchemeSlot = async () => {
    while (nextBatch < questionBatches.length) {
      const batchIndex = nextBatch;
      nextBatch += 1;
      const questions = questionBatches[batchIndex];
      batchResults[batchIndex] = {
        questions,
        batchNumber: batchIndex + 1,
        pass: await runPass({
        name: `mark_scheme_batch_${batchIndex + 1}`,
        reasoningEffort: "low",
        // The questions, not the batch number. High-tariff questions are
        // split into batches of their own, so the same position covers
        // different questions between runs.
        checkpoint: {
          pass: "mark_scheme_batch",
          subject: questions.map((question) => question.id),
          // The questions themselves, because q5 means a different question
          // in every design and an id alone once served one paper's scheme
          // for another paper's question.
          fingerprint: questionFingerprint(questions),
        },
        taskClass: "important",
        role: markSchemeRole,
        systemInstruction: markSchemeInstruction,
        contents: [
          ...evidenceContents,
          {
            role: "user" as const,
            parts: [{
              text: `--- ASSESSMENT PROFILE ---\n${JSON.stringify(draft.assessmentProfile)}\n\n--- FIXED QUESTIONS ---\n${JSON.stringify(questions)}\n\nReturn only the matching mark-scheme items.`,
            }],
          },
        ],
        temperature: 0.1,
        maxOutputTokens: 8_000,
        timeoutMs: MARK_SCHEME_BATCH_TIMEOUT_MS,
      }),
      };
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(markSchemeConcurrency, questionBatches.length) }, () => runMarkSchemeSlot())
  );
  {
    for (const result of batchResults) {
      let payload: Record<string, unknown> | null = null;
      try {
        payload = parseJsonObject(result.pass.text);
      } catch {
        // A capped or malformed batch is small enough to retry atomically.
      }
      let batchItems = Array.isArray(payload?.items)
        ? normalizeGeneratedMarkSchemeBatch(payload.items, result.questions)
        : null;
      if (!batchItems) {
        log.warn("mark_scheme.batch_unreadable", {
          batchNumber: result.batchNumber,
          attempt: "initial",
          ...batchShape(payload?.items, result.questions),
        });
        const retry = await runPass({
          name: `mark_scheme_batch_${result.batchNumber}_structured_retry`,
          reasoningEffort: "low",
          taskClass: "important",
          role: markSchemeRole,
          systemInstruction: `${markSchemeInstruction}\nThe previous batch was truncated or structurally unreadable. Use each supplied question id exactly, use only the named marking values, include every required field, and return one concise complete JSON object.`,
          contents: [{
            role: "user" as const,
            parts: [{ text: JSON.stringify(result.questions) }],
          }],
          temperature: 0,
          maxOutputTokens: 8_000,
        });
        payload = parseJsonObject(retry.text);
        batchItems = Array.isArray(payload.items)
          ? normalizeGeneratedMarkSchemeBatch(payload.items, result.questions)
          : null;
        if (!batchItems) {
          log.warn("mark_scheme.batch_unreadable", {
            batchNumber: result.batchNumber,
            attempt: "structured_retry",
            ...batchShape(payload.items, result.questions),
          });
        }
      }
      if (!batchItems) {
        throw new Error("A mark-scheme batch did not return readable items for every question.");
      }
      generatedItems.push(...batchItems);
    }
  }
  let schemeCandidate: Extract<ParsedPracticePaperModelAnswer, { status: "ready" }> = {
    ...draft,
    markScheme: normalizePracticePaperMarkScheme(
      { ...draft.markScheme, items: generatedItems },
      draft.questions
    ),
  };
  let schemeFaults = markSchemeIssues(schemeCandidate, { alignment: true });
  /**
   * The repaired items, carried from one round to the next.
   *
   * This used to be reset to the batches' original output at the top of every
   * round, so round two threw away everything round one had fixed and started
   * again from the first draft, repairing only the faults round one had left.
   * Two runs show it exactly: ten issues, then one, then nine; and nine, then
   * two, then eight. The second round always ends near where the first began,
   * because it is repairing the same scheme a second time rather than the
   * scheme the first round produced.
   */
  let mergedItems: unknown[] = [...generatedItems];
  for (
    let repairRound = 1;
    repairRound <= 2 && schemeFaults.length > 0;
    repairRound += 1
  ) {
    log.warn("mark_scheme.validation_failed", {
      repairRound,
      readable: schemeCandidate.markScheme.items.length === draft.questions.length,
      fixedPaperPreserved: sameFixedPaper(draft, schemeCandidate),
      issueCount: schemeFaults.length,
      issueCodes: Array.from(new Set(schemeFaults.map((issue) => issue.code))),
    });
    const affectedIds = new Set(schemeFaults.map((issue) => issue.questionId));
    const repairQuestions = draft.questions.filter((question) =>
      affectedIds.size === 0 || affectedIds.has(question.id)
    );
    const repairBatches = partitionMarkSchemeQuestions(repairQuestions);
    // In waves, like the first draft: one repair at a time was most of an eight-minute stage.
    for (let index = 0; index < repairBatches.length; index += markSchemeConcurrency) {
      const wave = repairBatches.slice(index, index + markSchemeConcurrency);
      const passes = await Promise.all(wave.map(async (questions, offset) => {
        const questionIds = new Set(questions.map((question) => question.id));
        return runPass({
          name: `mark_scheme_targeted_repair_${repairRound}_${index + offset + 1}`,
          reasoningEffort: "low",
          taskClass: "important",
          role: markSchemeRole,
          systemInstruction: `${markSchemeInstruction}\nCorrect every listed structural fault. Return replacement items only for the supplied affected questions.`,
          contents: [{
            role: "user" as const,
            parts: [{
              text: `--- AFFECTED QUESTIONS ---\n${JSON.stringify(questions)}\n\n--- PREVIOUS ITEMS ---\n${JSON.stringify(mergedItems.filter((item) => item && typeof item === "object" && questionIds.has(String((item as Record<string, unknown>).questionId ?? ""))))}\n\n--- FAULTS TO CORRECT ---\n${schemeFaults.filter((issue) => questionIds.has(issue.questionId ?? "")).map((issue) => `${issue.questionId}: ${issue.code} — ${issue.detail}`).join("\n")}`,
            }],
          }],
          temperature: 0,
          maxOutputTokens: 8_000,
        });
      }));
      for (const pass of passes) {
        const payload = parseJsonObject(pass.text);
        const replacements = Array.isArray(payload.items)
          ? canonicalizeGeneratedMarkSchemeItems(payload.items)
          : [];
        const replacementIds = new Set(replacements.flatMap((item) =>
          item && typeof item === "object" && typeof (item as Record<string, unknown>).questionId === "string"
            ? [String((item as Record<string, unknown>).questionId)]
            : []
        ));
        mergedItems = [
          ...mergedItems.filter((item) =>
            !item || typeof item !== "object" || !replacementIds.has(String((item as Record<string, unknown>).questionId ?? ""))
          ),
          ...replacements,
        ];
      }
    }
    schemeCandidate = {
      ...draft,
      markScheme: normalizePracticePaperMarkScheme(
        { ...draft.markScheme, items: mergedItems },
        draft.questions
      ),
    };
    schemeFaults = markSchemeIssues(schemeCandidate, { alignment: true });
  }
  /*
   * A scheme whose only remaining fault is the topic check goes on to the
   * audit instead of failing the paper. That check is a word-overlap guess
   * (see scheme-alignment.ts), and a leftover false flag threw the whole paper
   * away: the workflow retried the step, redesigned the paper and built a new
   * scheme, so a job bounced between designing and marking for minutes.
   * Structural faults -- marks that do not sum, unreadable items -- still fail it.
   */
  const onlyTopicFlags =
    schemeFaults.length > 0 && schemeFaults.every((issue) => issue.code === "scheme_off_topic");
  if (onlyTopicFlags) {
    log.warn("mark_scheme.topic_flags_deferred_to_audit", {
      issueCount: schemeFaults.length,
      questionIds: schemeFaults.map((issue) => issue.questionId ?? ""),
    });
  }
  if (
    !schemeCandidate ||
    !sameFixedPaper(draft, schemeCandidate) ||
    (schemeFaults.length > 0 && !onlyTopicFlags)
  ) {
    log.warn("mark_scheme.validation_exhausted", {
      issueCount: schemeFaults.length,
      issueCodes: Array.from(new Set(schemeFaults.map((issue) => issue.code))),
    });
    await refund("invalid_mark_scheme_response");
    return failure(
      "Jami could not lock a dependable mark scheme to that paper. Try again with a clearer assessment brief or mark scheme.",
      502,
      "invalid_mark_scheme_response"
    );
  }
  return schemeCandidate;
}
