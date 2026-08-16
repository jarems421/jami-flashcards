import { generateAiText } from "@/lib/ai/provider-router";
import { getAiTokenCap } from "@/lib/ai/budgets";

/**
 * How long does the juror actually take?
 *
 * Production caps every marking call at 60 seconds, and 81% of juror calls hit
 * it. That censors the distribution: everything we have says "at least 60s",
 * which is enough to know the timeout is too tight and not nearly enough to
 * choose a better one. Proposing 70 or 90 seconds from censored data would be
 * guessing.
 *
 * This calls the juror directly with a generous eval-only ceiling to see the
 * uncensored distribution. It changes no production setting: the ceiling lives
 * in this file and is passed per call.
 */

const PROMPT = `You are reviewing a disputed mark on a GCSE English question worth 8 marks.

Question: Explain how the writer creates a sense of place in the extract.

Student answer: The writer uses lots of description to make the library feel old
and magical. Words like "faded" and "cracked spines" show it is old, and the
metaphor of a labyrinth makes it feel confusing and endless. This helps the
reader imagine being lost in the shelves. The writer also uses the senses,
mentioning the cold of the door handle, which makes it feel real.

Marker A awarded 5. Marker B awarded 3.

Return JSON only: {"awardedMarks":N,"reasoning":"..."} with your own judgement.`;

export default async function main(args: string[]) {
  const count = Number(args.find((a) => a.startsWith("--count="))?.split("=")[1] ?? 5);
  const ceilingMs = Number(args.find((a) => a.startsWith("--ceiling="))?.split("=")[1] ?? 300_000);

  process.stdout.write(
    `\nProbing the juror ${count} times with a ${(ceilingMs / 1000).toFixed(0)}s eval-only ceiling.\n` +
      `Production stays at 60s; nothing here changes it.\n\n`
  );

  if (!args.includes("--confirm")) {
    process.stdout.write(`Nothing called. Re-run with --confirm.\n`);
    return;
  }

  const latencies: number[] = [];
  let failures = 0;

  for (let attempt = 1; attempt <= count; attempt += 1) {
    const started = Date.now();
    try {
      await generateAiText({
        role: "juror",
        taskClass: "important",
        timeoutMs: ceilingMs,
        deadlineAt: Date.now() + ceilingMs,
        generationConfig: {
          temperature: 0.05,
          topP: 0.75,
          maxOutputTokens: getAiTokenCap("practicePaperMarking"),
          responseMimeType: "application/json",
        },
        request: {
          systemInstruction: "You are an assessment adjudicator. Return valid JSON only.",
          contents: [{ role: "user" as const, parts: [{ text: PROMPT }] }],
        },
      });
      const elapsed = Date.now() - started;
      latencies.push(elapsed);
      process.stdout.write(`  call ${attempt}: ${(elapsed / 1000).toFixed(1)}s\n`);
    } catch (error) {
      failures += 1;
      const elapsed = Date.now() - started;
      process.stdout.write(
        `  call ${attempt}: FAILED after ${(elapsed / 1000).toFixed(1)}s — ${
          error instanceof Error ? error.message.slice(0, 80) : String(error)
        }\n`
      );
    }
  }

  if (latencies.length === 0) {
    process.stdout.write(`\nNo successful calls; nothing to conclude about latency.\n`);
    return;
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  process.stdout.write(`\nuncensored juror latency (n=${sorted.length}, ${failures} failed)\n`);
  process.stdout.write(`  min ${(sorted[0] / 1000).toFixed(1)}s\n`);
  process.stdout.write(`  p50 ${(at(0.5) / 1000).toFixed(1)}s\n`);
  process.stdout.write(`  p90 ${(at(0.9) / 1000).toFixed(1)}s\n`);
  process.stdout.write(`  max ${(sorted[sorted.length - 1] / 1000).toFixed(1)}s\n`);
  process.stdout.write(
    `  over the production 60s cap: ${sorted.filter((ms) => ms > 60_000).length} of ${sorted.length}\n`
  );
}
