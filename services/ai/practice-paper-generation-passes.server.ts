import type { AiContentPart } from "@/lib/ai/content-parts";
import { captureGenerationPass } from "@/lib/ai/generation-capture";
import {
  readGenerationCheckpoint,
  writeGenerationCheckpoint,
  type CheckpointKey,
} from "@/lib/ai/generation-checkpoint";
import type { parsePracticePaperGenerationRequest } from "@/lib/ai/practice-paper-generation";
import {
  generateAiText,
  generateAiTextBufferedStream,
  type AiResponseDiagnostics,
} from "@/lib/ai/provider-router";
import type { AiGenerationRole, AiReasoningEffort, AiTaskClass } from "@/lib/ai/provider-policy";
import type { Logger } from "@/lib/observability/logger";
import { getAiTokenCap } from "@/services/ai/budgets";
import { PAPER_PASS_STALL_TIMEOUT_MS } from "@/services/ai/practice-paper-generation-request.server";

/**
 * How the practice-paper pipeline calls its models: one pass at a time,
 * checkpointed so a rerun keeps work already paid for, captured for replay,
 * and read without letting one malformed response end the run.
 */

/**
 * A model's response as an object, or an empty one when it is not.
 *
 * This threw. A mark-scheme batch came back as 33,000 characters of degenerate
 * token soup -- " worldBopre child only () defaultULats minconfig tem
 * recatingier static" -- twice on the same question, and the SyntaxError
 * propagated out of the request and ended the paper. Ten batches were already
 * banked and survived only because they were checkpointed.
 *
 * A batch that cannot be read is a case the pipeline already handles: it logs
 * mark_scheme.batch_unreadable and retries it. Returning an empty object routes
 * a collapsed response into that path instead of taking down the run around it,
 * because one unusable answer should cost its own call and nothing else.
 */
export function parseJsonObject(value: string) {
  const normalized = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = normalized.indexOf("{");
  const end = normalized.lastIndexOf("}");
  try {
    return JSON.parse(
    start >= 0 && end > start ? normalized.slice(start, end + 1) : normalized
    ) as Record<string, unknown>;
  } catch {
    return {} as Record<string, unknown>;
  }
}

/** What a pass sends: the student's fenced evidence, then what this pass is for. */
export type GenerationContents = { role: "user"; parts: AiContentPart[] }[];

/** A practice-paper request that has passed validation. */
export type ParsedGenerationRequest = NonNullable<ReturnType<typeof parsePracticePaperGenerationRequest>>;

/**
 * The pass runner for one request. Its passes share the request's deadline,
 * cancellation signal, streaming mode and diagnostics.
 */
export function createGenerationPassRunner(context: {
  durableRequest: boolean;
  providerTimeoutMs: number;
  requestDeadlineMs: number;
  startedAt: number;
  signal: AbortSignal;
  log: Logger;
  diagnostics: AiResponseDiagnostics[];
}) {
  const {
    durableRequest,
    providerTimeoutMs,
    requestDeadlineMs,
    startedAt,
    signal,
    log,
    diagnostics,
  } = context;
  return async (input: {
    name: string;
    taskClass: AiTaskClass;
    role: AiGenerationRole;
    systemInstruction: string;
    contents: GenerationContents;
    temperature: number;
    maxOutputTokens?: number;
    /**
     * How much the model may think before answering. Left unset, the role's
     * own level applies. The supervisor model reasons by default, and on a
     * structured pass that reasoning is mostly waiting: one mark-scheme batch
     * thought for 116 seconds, hit its output cap and returned 46 characters.
     */
    reasoningEffort?: AiReasoningEffort;
    /** Silence after which an attempt moves to the next endpoint. */
    stallTimeoutMs?: number;
    /** A tighter call timeout than the pipeline default, for passes known to be short. */
    timeoutMs?: number;
    /**
     * What this call is about, so a rerun can recognise work already paid
     * for. Absent means the pass is always re-run.
     */
    checkpoint?: CheckpointKey;
    onResponseText?: (captured: {
      pass: string;
      role: AiGenerationRole;
      modelName: string;
      text: string;
    }) => void;
  }) => {
    const passDiagnostics: AiResponseDiagnostics[] = [];
    const execute = () => (durableRequest
      ? generateAiTextBufferedStream
      : generateAiText)({
      role: input.role,
      taskClass: input.taskClass,
      ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
      stallTimeoutMs: input.stallTimeoutMs ?? PAPER_PASS_STALL_TIMEOUT_MS,
      timeoutMs: input.timeoutMs ?? providerTimeoutMs,
      fallbackTimeoutMs: input.timeoutMs ?? providerTimeoutMs,
      deadlineAt: startedAt + requestDeadlineMs,
      signal,
      generationConfig: {
        temperature: input.temperature,
        topP: 0.85,
        maxOutputTokens: Math.min(
          getAiTokenCap("practicePaperGeneration"),
          input.maxOutputTokens ?? getAiTokenCap("practicePaperGeneration")
        ),
        responseMimeType: "application/json",
      },
      request: {
        systemInstruction: input.systemInstruction,
        contents: input.contents,
      },
      onResponse: (item) => {
        diagnostics.push(item);
        passDiagnostics.push(item);
      },
      onRetry: ({ error, provider, modelName, nextProvider, nextModelName }) =>
        log.warn("provider.model_fallback", {
          pass: input.name,
          error,
          provider,
          modelName,
          nextProvider,
          nextModelName,
        }),
    });

    /**
     * A pass this run has already completed, from an earlier attempt.
     *
     * Generation makes roughly 28 sequential calls against a provider that
     * rate-limits, returns gateway errors and drops connections. One run
     * failed at group 16 and discarded the fifteen valid groups before it.
     * Marking has kept its stages since it was made durable; this is the same
     * idea for the pipeline with seven times as many calls to lose.
     */
    if (input.checkpoint) {
      const stored = readGenerationCheckpoint(input.checkpoint);
      if (stored) {
        log.info("generation.checkpoint_hit", {
          pass: input.name,
          subject: input.checkpoint.subject.length,
        });
        return stored;
      }
    }

    const text = await execute();
    const modelName = passDiagnostics.at(-1)?.modelName ?? input.role;
    /**
     * Every model response, offered to the caller before anything reads it.
     *
     * Generation has been debugged by burning live runs. Five structural
     * faults were found that way -- inverted mark dependencies, band ranges
     * under provider aliases, a nested marking object the pre-check refused,
     * additive points not summing to the tariff, items with no usable credit
     * unit -- and not one of them needed a model to reproduce. They are
     * parser and validator faults, findable in milliseconds against a
     * recorded response, and each instead cost a two-hour run against a
     * provider that was rate-limiting and dropping connections.
     *
     * The responses were paid for and then discarded. Kept, they become
     * fixtures: the next defect of that class is caught by a test rather than
     * by a pilot, and the run that found it never has to happen again.
     */
    const captured = { pass: input.name, role: input.role, modelName, text };
    // A hook nobody passes captures nothing, and no call site passes this
    // one, so the responses above were still being discarded. The default
    // sink writes them where a run can be replayed from; a caller supplying
    // its own still wins.
    if (input.onResponseText) input.onResponseText(captured);
    else captureGenerationPass(captured);
    if (input.checkpoint) writeGenerationCheckpoint(input.checkpoint, { text, modelName });
    return { text, modelName };
  };
}

export type GenerationPassRunner = ReturnType<typeof createGenerationPassRunner>;

/** What every stage is handed by the request it runs in. */
export type GenerationStageInput = {
  runPass: GenerationPassRunner;
  refund: (reason: string) => Promise<void>;
  log: Logger;
  sourceRefs: string[];
  parsedRequest: ParsedGenerationRequest;
};
