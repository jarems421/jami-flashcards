import { readFileSync, writeFileSync } from "node:fs";
import { getAiInputTokenCap } from "@/lib/ai/budgets";
import { generateAiText } from "@/lib/ai/provider-router";
import type { MarkingCorpusRecord } from "@/lib/evaluation/marking-corpus";
import { adaptRecordToPaper } from "@/lib/evaluation/practice-paper-adapter";
import { getAiTokenCap } from "@/services/ai/budgets";
import { markSingleQuestionAdaptively } from "@/services/ai/practice-paper-marking.server";
import { matchQuestionTypeRule } from "@/lib/practice/question-types";
import { loadQuestionTypeRules } from "@/services/practice/question-type-rules.server";

/**
 * Feedback with and without the researched question-type rules, on the same
 * answers, compared blind.
 *
 *   GEMINI_DOCUMENT_MODEL=gemini-3.8-flash node --env-file-if-exists=.env.local \
 *     scripts/run-ts.mjs scripts/eval/feedback-comparison.ts --per-tariff=2 --out=report.md
 *
 * A small sample by design: each answer is marked twice by the production
 * single-question marker (blind double marking, as students get it), once with
 * the board's researched rules and once with only the hand-written
 * conventions. A judge from another model family then sees both sets of
 * feedback in random order, without knowing which is which, and says which a
 * student would learn more from. Nothing is stored.
 *
 * Only the Medly GCSE English answers are used: they are the corpus's only
 * answers presented as a real board's course (AQA GCSE English Language), so
 * the only ones the researched rules can reach.
 */

const JUDGE_INSTRUCTION = `You compare two sets of marking feedback given to the same GCSE student on the same answer. You are shown the question, the official mark scheme, the student's answer, the mark an experienced examiner gave, and Feedback A and Feedback B.

Judge which feedback would help this student more. For each, score 1-5:
- specific: points at what this answer actually did or did not do, rather than general advice
- actionable: the next step is something the student could do on their next attempt
- accurate: consistent with the mark scheme and the examiner's mark; no wrong claims about the answer
Then choose "A", "B" or "tie", with one sentence saying why.

Return JSON only: {"A":{"specific":0,"actionable":0,"accurate":0},"B":{"specific":0,"actionable":0,"accurate":0},"better":"A","why":"..."}`;

type Arm = "researched" | "conventions";
type Feedback = { awarded: number; feedback: string; nextStep: string; improvements: string[]; criteria: string[] };

function feedbackOf(result: Awaited<ReturnType<typeof markSingleQuestionAdaptively>>["result"]): Feedback {
  const question = result.questionResults[0];
  return {
    awarded: question?.awardedMarks ?? 0,
    feedback: question?.feedback ?? "",
    nextStep: question?.nextStep ?? "",
    improvements: question?.improvements ?? [],
    criteria: (question?.criterionResults ?? [])
      .filter((criterion) => !criterion.awarded)
      .map((criterion) => `${criterion.criterion}: wanted ${criterion.schemeValue ?? "?"}, found ${criterion.candidateValue ?? "?"}`),
  };
}

function printFeedback(item: Feedback) {
  return [
    `Mark: ${item.awarded}`,
    `Feedback: ${item.feedback}`,
    `Next step: ${item.nextStep}`,
    item.improvements.length ? `Improvements: ${item.improvements.join(" | ")}` : "",
    item.criteria.length ? `Marks not earned: ${item.criteria.join(" | ")}` : "",
  ].filter(Boolean).join("\n");
}

export default async function main(args: string[]) {
  const flag = (name: string) => args.find((value) => value.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
  const perTariff = Number(flag("per-tariff") ?? 2);
  const out = flag("out") ?? "feedback-comparison.md";
  const records = (JSON.parse(readFileSync("artifacts/corpus/medly-gcse.json", "utf8")) as { records: MarkingCorpusRecord[] }).records
    .filter((record) => record.subject === "english" && record.answer.kind === "text" && record.answer.text.trim().length > 40);
  // A spread of kinds, not a pile of one: at each tariff, different questions first, then other answers to them.
  const sample: MarkingCorpusRecord[] = [];
  for (const marks of [...new Set(records.map((record) => record.maxMarks))].sort((a, b) => a - b)) {
    const atTariff = records.filter((item) => item.maxMarks === marks);
    const firsts = atTariff.filter((record, index) => atTariff.findIndex((item) => item.questionId === record.questionId) === index);
    sample.push(...[...firsts, ...atTariff.filter((record) => !firsts.includes(record))].slice(0, perTariff));
  }
  process.stdout.write(`Comparing feedback on ${sample.length} answers (tariffs ${[...new Set(sample.map((r) => r.maxMarks))].join(", ")}).\n`);

  const sections: string[] = [];
  const tally = { researched: 0, conventions: 0, tie: 0 };
  const scores: Record<Arm, { specific: number; actionable: number; accurate: number; n: number }> = {
    researched: { specific: 0, actionable: 0, accurate: 0, n: 0 },
    conventions: { specific: 0, actionable: 0, accurate: 0, n: 0 },
  };
  let cost = 0;
  for (const record of sample) {
    const adapted = adaptRecordToPaper(record);
    if (!adapted.ok) continue;
    const { paper, answerParts } = adapted.adapted;
    const rules = await loadQuestionTypeRules(paper.assessmentProfile, paper.title);
    // Said, so a tie cannot come from the rules never reaching the question. A first run on a
    // starved machine timed out every rule read and compared two identical prompts.
    const matched = matchQuestionTypeRule(rules, paper.questions[0]);
    if (!matched) {
      process.stdout.write(`  ${record.id}: no researched rule reached this question (${rules.length} loaded), skipped\n`);
      continue;
    }
    const mark = (researched: boolean) =>
      markSingleQuestionAdaptively({
        paper, answerParts, examinerPracticeRules: rules,
        deadlineAt: Date.now() + 600_000,
        maxOutputTokens: getAiTokenCap("examQuestionMarking"),
        inputTokenCap: getAiInputTokenCap("examQuestionMarking"),
        forceVerification: true,
        ...(researched ? {} : { variant: { researchedRules: false } }),
      });
    let marked: Record<Arm, Feedback>;
    try {
      const [withRules, without] = await Promise.all([mark(true), mark(false)]);
      cost += (withRules.estimatedCostUsd ?? 0) + (without.estimatedCostUsd ?? 0);
      marked = { researched: feedbackOf(withRules.result), conventions: feedbackOf(without.result) };
    } catch (error) {
      process.stdout.write(`  ${record.id}: marking failed (${error instanceof Error ? error.name : "error"}), skipped\n`);
      continue;
    }
    // Blind: the judge sees A and B in an order it cannot infer.
    const researchedFirst = Math.random() < 0.5;
    const [a, b]: Arm[] = researchedFirst ? ["researched", "conventions"] : ["conventions", "researched"];
    const examiner = record.humanMarks.join(" and ");
    let verdict: { A?: Record<string, number>; B?: Record<string, number>; better?: string; why?: string } = {};
    try {
      const reply = await generateAiText({
        role: "documentVision",
        taskClass: "important",
        timeoutMs: 120_000,
        generationConfig: { temperature: 0, maxOutputTokens: 2_000, responseMimeType: "application/json" },
        request: {
          systemInstruction: JUDGE_INSTRUCTION,
          contents: [{ role: "user", parts: [{ text: [
            `Question (${record.maxMarks} marks): ${record.questionPrompt}`,
            `Mark scheme:\n${String(record.markScheme ?? "").slice(0, 6_000)}`,
            `Student answer:\n${record.answer.kind === "text" ? record.answer.text : ""}`,
            `Examiner's mark: ${examiner} out of ${record.maxMarks}`,
            `--- Feedback A ---\n${printFeedback(marked[a])}`,
            `--- Feedback B ---\n${printFeedback(marked[b])}`,
          ].join("\n\n") }] }],
        },
      } as Parameters<typeof generateAiText>[0]);
      verdict = JSON.parse(String(reply).replace(/^```(?:json)?\s*|\s*```$/g, ""));
    } catch {
      verdict = {};
    }
    const winner: Arm | "tie" | undefined =
      verdict.better === "A" ? a : verdict.better === "B" ? b : verdict.better === "tie" ? "tie" : undefined;
    if (winner) tally[winner] += 1;
    for (const [label, arm] of [["A", a], ["B", b]] as const) {
      const given = verdict[label];
      if (!given) continue;
      scores[arm].specific += Number(given.specific ?? 0);
      scores[arm].actionable += Number(given.actionable ?? 0);
      scores[arm].accurate += Number(given.accurate ?? 0);
      scores[arm].n += 1;
    }
    process.stdout.write(`  ${record.maxMarks}-mark ${record.id}: examiner ${examiner}, with rules ${marked.researched.awarded}, without ${marked.conventions.awarded} -> ${winner ?? "no verdict"}\n`);
    sections.push([
      `## ${record.maxMarks}-mark question (${record.id})`,
      `Researched rule: ${matched?.name ?? "none matched"}. Examiner: ${examiner}/${record.maxMarks}. Judge preferred: **${winner === "researched" ? "with researched rules" : winner === "conventions" ? "hand-written conventions only" : winner ?? "no verdict"}**. ${verdict.why ?? ""}`,
      `### With researched rules\n${printFeedback(marked.researched)}`,
      `### Hand-written conventions only\n${printFeedback(marked.conventions)}`,
    ].join("\n\n"));
  }
  const mean = (arm: Arm, key: "specific" | "actionable" | "accurate") =>
    scores[arm].n ? (scores[arm][key] / scores[arm].n).toFixed(2) : "-";
  const summary = [
    `# Feedback with and without researched rules`,
    `${sections.length} AQA GCSE English Language answers, marked twice each by the production marker; judged blind by a different model family. Marking cost about $${cost.toFixed(3)}.`,
    `Judge preferred: with researched rules ${tally.researched}, conventions only ${tally.conventions}, tie ${tally.tie}.`,
    `| | specific | actionable | accurate |\n| --- | --- | --- | --- |\n| with researched rules | ${mean("researched", "specific")} | ${mean("researched", "actionable")} | ${mean("researched", "accurate")} |\n| conventions only | ${mean("conventions", "specific")} | ${mean("conventions", "actionable")} | ${mean("conventions", "accurate")} |`,
  ].join("\n\n");
  writeFileSync(out, `${summary}\n\n${sections.join("\n\n")}\n`);
  process.stdout.write(`\n${summary}\n\nReport: ${out}\n`);
}
