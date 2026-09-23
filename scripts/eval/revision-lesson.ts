/**
 * Does the model write a usable Revision Session lesson -- and, after a wrong
 * guided answer, a usable second explanation -- and how long does each take?
 *
 *   npm run eval:revision-lesson [-- --concept "Completing the square" --course "AQA GCSE Mathematics"]
 *
 * Calls the real provider, exactly as the prepare route does, for a handful of
 * concepts across subjects, and reports for each: how long it took, how much it
 * wrote, and -- when a draft is refused -- which fields the validator refused,
 * by name. Nothing is stored. Prints the raw reply only with --raw.
 *
 * Run `npm run check:ai-release` first: a dead failover makes every failure
 * here look like the prompt's fault.
 */
import { getAiTokenCap } from "@/lib/ai/budgets";
import {
  closeUnbalancedJson,
  repairModelJsonBackslashes,
  unwrapModelJsonObject,
} from "@/lib/ai/model-json";
import { generateAiText } from "@/lib/ai/provider-router";
import {
  explainRevisionLessonRejection,
  explainRevisionRetryRejection,
  readRevisionLesson,
  readRevisionRetry,
} from "@/lib/revision/lesson";
import {
  buildRevisionLessonInstruction,
  buildRevisionRetryInstruction,
  type RevisionConceptContext,
} from "@/services/ai/revision-session.server";

const DEFAULT_CONCEPTS: RevisionConceptContext[] = [
  { conceptLabel: "Completing the square", course: "AQA GCSE Mathematics", level: "GCSE" },
  { conceptLabel: "Osmosis", course: "AQA GCSE Biology", level: "GCSE" },
  { conceptLabel: "Differentiation from first principles", course: "Edexcel A-level Mathematics", level: "A-level" },
  { conceptLabel: "Macbeth's ambition", course: "AQA GCSE English Literature", level: "GCSE" },
];

function readArg(args: readonly string[], name: string) {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

function parse(text: string): unknown {
  for (const candidate of [unwrapModelJsonObject(text.trim()), text.trim()]) {
    try {
      return JSON.parse(closeUnbalancedJson(repairModelJsonBackslashes(candidate)));
    } catch {
      // Try the next reading.
    }
  }
  return null;
}

/** Where the reply stops being JSON, with the text either side of it. */
function describeParseFailure(text: string) {
  const repaired = closeUnbalancedJson(repairModelJsonBackslashes(unwrapModelJsonObject(text.trim())));
  try {
    JSON.parse(repaired);
    return "  parses, but is not an object";
  } catch (error) {
    const message = (error as Error).message;
    const at = Number(/position (\d+)/.exec(message)?.[1]);
    const context = Number.isFinite(at)
      ? `\n  ...${repaired.slice(Math.max(0, at - 90), at)}<<HERE>>${repaired.slice(at, at + 40)}...`
      : "";
    return `  ${message}${context}`;
  }
}

type Draw<T> = { value: T | null; seconds: string; chars: number; problems: string[]; text: string };

/** One call as the app makes it, read by the app's own reader. */
async function draw<T>(input: {
  instruction: string;
  ask: string;
  temperature: number;
  timeoutMs: number;
  read: (value: unknown) => T | null;
  explain: (value: unknown) => string[];
}): Promise<Draw<T>> {
  const startedAt = Date.now();
  const text = await generateAiText({
    role: "worker",
    routeReason: "routine",
    timeoutMs: input.timeoutMs,
    generationConfig: {
      temperature: input.temperature,
      maxOutputTokens: getAiTokenCap("revisionLesson"),
      responseMimeType: "application/json",
    },
    request: {
      systemInstruction: input.instruction,
      contents: [{ role: "user", parts: [{ text: input.ask }] }],
    },
  });
  const parsed = parse(text);
  const value = input.read(parsed);
  return {
    value,
    seconds: ((Date.now() - startedAt) / 1000).toFixed(1),
    chars: text.length,
    problems: value ? [] : parsed === null ? [describeParseFailure(text).trim()] : input.explain(parsed),
    text,
  };
}

function report(label: string, result: Draw<unknown>, raw: boolean) {
  console.log(`${label}: ${result.value ? "USABLE" : "REFUSED"} in ${result.seconds}s, ${result.chars} chars`);
  for (const problem of result.problems) console.log(`  - ${problem}`);
  if (raw) console.log(result.text);
}

export default async function main(args: string[] = []) {
  const concept = readArg(args, "--concept");
  const course = readArg(args, "--course");
  const concepts = concept ? [{ conceptLabel: concept, ...(course ? { course } : {}) }] : DEFAULT_CONCEPTS;
  const raw = args.includes("--raw");
  const tally = { lessons: 0, lessonsUsable: 0, retries: 0, retriesUsable: 0 };

  for (const context of concepts) {
    console.log(`
${context.conceptLabel}`);
    try {
      const lesson = await draw({
        instruction: buildRevisionLessonInstruction(context),
        ask: "Write the session.",
        temperature: 0.4,
        timeoutMs: 45_000,
        read: readRevisionLesson,
        explain: explainRevisionLessonRejection,
      });
      tally.lessons += 1;
      if (lesson.value) tally.lessonsUsable += 1;
      report("  lesson", lesson, raw);
      if (!lesson.value) continue;

      // The second explanation, as the guided step asks for it after a wrong answer.
      const retry = await draw({
        instruction: buildRevisionRetryInstruction({ context, lesson: lesson.value }),
        ask: "Explain it another way.",
        temperature: 0.5,
        timeoutMs: 30_000,
        read: readRevisionRetry,
        explain: explainRevisionRetryRejection,
      });
      tally.retries += 1;
      if (retry.value) tally.retriesUsable += 1;
      report("  retry", retry, raw);
    } catch (error) {
      console.log(`  CALL FAILED: ${(error as Error).message}`);
    }
  }
  console.log(
    `
lessons ${tally.lessonsUsable} of ${tally.lessons} usable, retries ${tally.retriesUsable} of ${tally.retries}`
  );
}
