/**
 * How long preparing a study session actually takes.
 *
 * The session-start progress bar is built around a 25-second budget, and every
 * number in it -- batch size, how many run at once, the per-call timeout -- was
 * chosen from reasoning about output tokens rather than from measurement. This
 * measures it: one real call per batch size against the worker model, then a
 * parallel wave shaped exactly like a session start.
 *
 *   node --env-file-if-exists=.env.local scripts/run-ts.mjs scripts/eval/study-asset-latency.ts
 *
 * Costs a handful of worker-model calls. Nothing is written anywhere.
 */
import { generateAiText, isAnyAiProviderConfigured } from "@/lib/ai/provider-router";
import { getAiTokenCap } from "@/lib/ai/budgets";
import {
  buildStudyAssetUserPrompt,
  parseStudyAssetResponse,
  STUDY_ASSET_SYSTEM_PROMPT,
} from "@/lib/ai/study-assets";

const CARDS = [
  {
    id: "c1",
    front: "Which organelle releases usable energy in a cell?",
    back: "The mitochondrion releases usable energy inside every cell",
  },
  {
    id: "c2",
    front: "What is the powerhouse molecule of the cell?",
    back: "Adenosine triphosphate",
  },
  {
    id: "c3",
    front: "What is the acceleration due to gravity on Earth?",
    back: "9.8 m/s",
  },
  {
    id: "c4",
    front: "Which structure builds proteins?",
    back: "The ribosome assembles amino acids into proteins",
  },
  {
    id: "c5",
    front: "What does the first law of thermodynamics state?",
    back: "Energy cannot be created or destroyed, only transferred between stores",
  },
  {
    id: "c6",
    front: "Why is the Haber process run at a compromise temperature?",
    back: "A higher temperature speeds the reaction but lowers the yield, so a middle value gives an acceptable amount of ammonia quickly enough to be economic",
  },
  {
    id: "c7",
    front: "What is osmosis?",
    back: "The movement of water across a partially permeable membrane from a dilute to a concentrated solution",
  },
  {
    id: "c8",
    front: "What was the immediate cause of the 1929 Wall Street Crash?",
    back: "A wave of panic selling after speculative share prices collapsed",
  },
];

const TOKEN_CAP = getAiTokenCap("studyAssetGeneration");

async function runBatch(size: number, timeoutMs: number) {
  const batch = CARDS.slice(0, size);
  const startedAt = Date.now();
  let text = "";
  let failure: string | null = null;
  try {
    text = await generateAiText({
      role: "worker",
      routeReason: "explicit_role",
      allowRoleEscalation: false,
      timeoutMs,
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: TOKEN_CAP,
        responseMimeType: "application/json",
      },
      request: {
        systemInstruction: STUDY_ASSET_SYSTEM_PROMPT,
        contents: [
          { role: "user" as const, parts: [{ text: buildStudyAssetUserPrompt(batch) }] },
        ],
      },
    });
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  const ms = Date.now() - startedAt;
  const assets = failure ? [] : parseStudyAssetResponse(text, batch);
  return {
    size,
    ms,
    failure,
    chars: text.length,
    parsed: assets.length,
    distractors: assets.map((asset) => asset.distractors.length),
    gaps: assets.map((asset) => asset.clozeCandidates.length),
  };
}

export default async function main() {
  if (!isAnyAiProviderConfigured("worker")) {
    console.log("No worker provider is configured. Set OPENROUTER_* in .env.local.");
    return;
  }

  console.log(`token cap ${TOKEN_CAP}\n`);

  for (const size of [1, 3, 6]) {
    const result = await runBatch(size, 60_000);
    console.log(
      `batch of ${size}: ${result.ms}ms  parsed ${result.parsed}/${size}  ` +
        `chars ${result.chars}  distractors ${JSON.stringify(result.distractors)}  ` +
        `gaps ${JSON.stringify(result.gaps)}` +
        (result.failure ? `  FAILED: ${result.failure}` : "")
    );
  }

  // The shape a session start actually makes: several batches at once.
  console.log("\nparallel wave of 4 batches of 6 (24 cards):");
  const waveStartedAt = Date.now();
  const wave = await Promise.all(
    [0, 1, 2, 3].map(() => runBatch(6, 60_000))
  );
  console.log(
    `  wall ${Date.now() - waveStartedAt}ms  ` +
      `each ${JSON.stringify(wave.map((entry) => entry.ms))}  ` +
      `parsed ${JSON.stringify(wave.map((entry) => entry.parsed))}`
  );
}
