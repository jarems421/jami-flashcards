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
import katex from "katex";

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
import type { RevisionLesson } from "@/lib/revision/types";
import {
  buildRevisionLessonInstruction,
  buildRevisionRetryInstruction,
  TEACHING_REASONING_EFFORT,
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
    reasoningEffort: TEACHING_REASONING_EFFORT,
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

/**
 * What a usable lesson can still get wrong that a reader would see at once.
 *
 * Each of these was found by reading real lessons, September 2026: maths KaTeX
 * cannot draw (`\imes`, `\text{ \Omega}`), a hint that contains its answer,
 * claims about exams nobody can check, and markdown shown as asterisks. None
 * judges whether the teaching is right -- that still needs reading.
 */
function flagLesson(lesson: RevisionLesson): string[] {
  const flags: string[] = [];
  const tasks = { guided: lesson.guided, independent: lesson.independent, apply: lesson.apply, retrieve: lesson.retrieve };
  const texts = [
    ...lesson.goals,
    lesson.orientation,
    lesson.explanation.body,
    lesson.explanation.example.problem,
    ...lesson.explanation.example.steps,
    ...Object.values(tasks).flatMap((task) => [task.prompt, task.hint, task.answer, ...task.markScheme, task.solution]),
  ];
  for (const text of texts) {
    for (const [, latex] of text.matchAll(/\$([^$]+)\$/g)) {
      try {
        katex.renderToString(latex, { throwOnError: true });
      } catch {
        flags.push(`maths that will not render: $${latex}$`);
      }
    }
    if (/\*[^*\s][^*]*\*/.test(text)) flags.push(`markdown emphasis: ${text.slice(0, 60)}`);
  }
  const bare = (text: string) => text.toLowerCase().replace(/[$\s.]/g, "");
  for (const [key, task] of Object.entries(tasks)) {
    if (bare(task.answer).length >= 2 && bare(task.hint).includes(bare(task.answer))) {
      flags.push(`${key} hint contains its answer`);
    }
  }
  if (/\b(exam|examiner|paper|marks)\b/i.test(lesson.orientation)) flags.push(`orientation talks about exams`);
  return flags;
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
  const tally = { lessons: 0, lessonsUsable: 0, flagged: 0, retries: 0, retriesUsable: 0 };

  for (const context of concepts) {
    console.log(`\n${context.conceptLabel}`);
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
      const flags = flagLesson(lesson.value);
      tally.flagged += flags.length > 0 ? 1 : 0;
      for (const flag of flags) console.log(`  ! ${flag}`);

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
    `\nlessons ${tally.lessonsUsable} of ${tally.lessons} usable (${tally.flagged} flagged), ` +
      `retries ${tally.retriesUsable} of ${tally.retries}`
  );
}
