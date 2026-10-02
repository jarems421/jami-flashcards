import { generateAiText } from "@/lib/ai/provider-router";
import { applyTutorMemoryOperations, buildTutorMemoryInstruction, emptyTutorMemory } from "@/lib/ai/tutor-memory";
import { TUTOR_VOICE_INSTRUCTION } from "@/lib/ai/tutor-voice";
import { buildAssistantResponseSchema } from "@/app/api/ai/assistant/response-schema";
import { parseJamiAssistantModelAnswer } from "@/lib/ai/jami-assistant";

/**
 * Does Tutor propose memories, and only when it should?
 *
 * Calls the Tutor model with its voice, the memory block, the answer schema and
 * the route's field list, on turns where a tutor plainly should remember
 * something (a repeated mistake, a goal, a plan) and on ordinary questions
 * where it should not. Nothing is stored.
 *
 * Measured 1 Oct 2026 on the worker (GLM 5.3 Flash), two runs a turn: with the
 * field optional, 0 of 8 answers carried a memory, the repeated mistake
 * included, and no student had one in production. Required, every turn that
 * should remember did.
 *
 *   node --env-file-if-exists=.env.local scripts/run-ts.mjs scripts/eval/tutor-memory-probe.ts --confirm [--role=worker] [--runs=2]
 */

const TURNS: Array<{ text: string; expect: "memory" | "none" }> = [
  { text: "I keep getting circle area questions wrong, I always do 2πr instead of πr². Can you give me one to try?", expect: "memory" },
  { text: "My GCSE maths exam is AQA higher on 5 June and I'm aiming for a grade 9. What should I focus on?", expect: "memory" },
  { text: "I'm going to revise moles and Avogadro's constant tonight, can you explain what a mole is?", expect: "memory" },
  { text: "Can you explain photosynthesis simply?", expect: "none" },
  { text: "What is the difference between mitosis and meiosis?", expect: "none" },
  { text: "Differentiate 3x^2 + 5x", expect: "none" },
];

const FORMAT = `Return JSON only with exactly these fields:
{"memory":[],"answer":"student-facing response","sourceRefs":["S1"],"usedCurrentContext":true,"usedGeneralKnowledge":true,"usedWebResearch":false,"graphs":[],"diagrams":[],"studyMaterial":"none","studyMaterialFocus":""}`;

export default async function main(args: string[]) {
  const role = (args.find((a) => a.startsWith("--role="))?.split("=")[1] ?? "worker") as "worker";
  const runs = Number(args.find((a) => a.startsWith("--runs="))?.split("=")[1] ?? 2);
  if (!args.includes("--confirm")) {
    process.stdout.write("Nothing called. Re-run with --confirm.\n");
    return;
  }
  const { instruction } = buildTutorMemoryInstruction({
    memories: [],
    recent: [],
    now: Date.now(),
    boundaryToken: "probe",
    firstTurn: true,
    canWrite: true,
  });
  const schema = buildAssistantResponseSchema([], false, false, false, true, ["flashcards", "practice"]);
  const systemInstruction = `${TUTOR_VOICE_INSTRUCTION}\n${instruction}\n${FORMAT}`;

  const tally = { memory: { hit: 0, total: 0 }, none: { hit: 0, total: 0 } };
  for (const turn of TURNS) {
    for (let run = 0; run < runs; run += 1) {
      try {
        const text = await generateAiText({
          role,
          routeReason: "routine",
          timeoutMs: 90_000,
          deadlineAt: Date.now() + 90_000,
          generationConfig: {
            temperature: 0.2,
            topP: 0.85,
            maxOutputTokens: 4_000,
            responseMimeType: "application/json",
            responseSchema: schema,
          },
          request: { systemInstruction, contents: [{ role: "user", parts: [{ text: turn.text }] }] },
        });
        const parsed = parseJamiAssistantModelAnswer(text, []);
        const memory = parsed?.memory;
        // What would be saved, after the same checks the route applies.
        const saved = applyTutorMemoryOperations({
          state: emptyTutorMemory(),
          operations: memory,
          context: { topicIds: [] },
          refs: new Map(),
          now: Date.now(),
          makeId: () => "probe",
        }).state.items.map((item) => `${item.kind}: ${item.text}`);
        const remembered = saved.length > 0;
        tally[turn.expect].total += 1;
        if (remembered) tally[turn.expect].hit += 1;
        process.stdout.write(
          `${turn.text.slice(0, 40).padEnd(40)} | ${parsed ? "parsed" : "UNPARSED"} | proposed ${JSON.stringify(memory ?? null)} | saved ${JSON.stringify(saved)}\n`
        );
      } catch (error) {
        process.stdout.write(`${turn.text.slice(0, 40).padEnd(40)} | FAILED ${error instanceof Error ? error.message.slice(0, 120) : String(error)}\n`);
      }
    }
  }
  process.stdout.write(
    `\n${role}: saved a memory on ${tally.memory.hit}/${tally.memory.total} turns that should, ` +
      `${tally.none.hit}/${tally.none.total} ordinary questions that should not\n`
  );
}
