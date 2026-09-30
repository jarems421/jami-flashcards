/**
 * How often a card comes out of preparation askable as multiple choice, and how
 * long it takes to get there.
 *
 * study-asset-latency.ts times the generation call alone. What a student waits
 * for is more than that -- generation, then the review call, then the builder
 * deciding whether the approved options are a fair question -- and what they
 * see when it goes wrong is "this card isn't ready". This runs the whole path
 * the route runs, a card at a time and a batch at a time, over cards shaped
 * like real decks: short terms, sentences, numbers, and LaTeX.
 *
 *   node --env-file-if-exists=.env.local scripts/run-ts.mjs scripts/eval/study-mcq-readiness.ts [batchSize] [concurrency] [maths]
 *
 * Costs two worker calls per batch. Nothing is written anywhere.
 */
import { isAnyAiProviderConfigured } from "@/lib/ai/provider-router";
import { buildMultipleChoiceQuestion } from "@/lib/study/mcq";
import type { Card } from "@/lib/study/cards";
import { mergeAssetIntoSettings } from "@/services/study/study-assets";
import {
  generateStudyAssetBatch,
  type StudyAssetBatchTiming,
  type StudyAssetCard,
} from "@/services/ai/study-asset-generation.server";

const CARDS: StudyAssetCard[] = [
  { id: "c01", front: "Which organelle releases usable energy in a cell?", back: "The mitochondrion" },
  { id: "c02", front: "What is osmosis?", back: "The movement of water across a partially permeable membrane from a dilute to a concentrated solution" },
  { id: "c03", front: "What is the acceleration due to gravity on Earth?", back: "9.8 m/s²" },
  { id: "c04", front: "Which structure builds proteins?", back: "The ribosome" },
  { id: "c05", front: "State the first law of thermodynamics.", back: "Energy cannot be created or destroyed, only transferred between stores" },
  { id: "c06", front: "Why is the Haber process run at a compromise temperature?", back: "A higher temperature speeds the reaction but lowers the yield, so a middle value gives enough ammonia quickly enough to be economic" },
  { id: "c07", front: "What was the immediate cause of the 1929 Wall Street Crash?", back: "Panic selling after speculative share prices collapsed" },
  { id: "c08", front: "Differentiate $x^3$", back: "$3x^2$" },
  { id: "c09", front: "What is the formula for kinetic energy?", back: "$E_k = \\frac{1}{2}mv^2$" },
  { id: "c10", front: "What is the capital of Australia?", back: "Canberra" },
  { id: "c11", front: "Who wrote 'An Inspector Calls'?", back: "J. B. Priestley" },
  { id: "c12", front: "What does 'la bibliothèque' mean?", back: "The library" },
  { id: "c13", front: "What is the function of the loop of Henle?", back: "It reabsorbs water and salts to concentrate the urine" },
  { id: "c14", front: "Define opportunity cost.", back: "The value of the next best alternative given up when a choice is made" },
  { id: "c15", front: "Solve $2x + 3 = 11$", back: "$x = 4$" },
  { id: "c16", front: "What year did the Battle of Hastings take place?", back: "1066" },
];

/*
 * Cards whose answer is mostly maths.
 *
 * These are never sent for preparation today (see needsStudyAssetPreparation):
 * a model's wrong formula is the most convincing kind of wrong. This set is
 * how that is re-judged -- how often a question comes out, and, read by eye
 * from the printed options, whether exactly one of them is right.
 */
const MATHS_CARDS: StudyAssetCard[] = [
  { id: "m01", front: "Differentiate $x^3$", back: "$3x^2$" },
  { id: "m02", front: "What is the formula for kinetic energy?", back: "$E_k = \\frac{1}{2}mv^2$" },
  { id: "m03", front: "Solve $2x + 3 = 11$", back: "$x = 4$" },
  { id: "m04", front: "Integrate $2x$ with respect to $x$", back: "$x^2 + c$" },
  { id: "m05", front: "State the quadratic formula", back: "$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$" },
  { id: "m06", front: "What is $\\sin 30^\\circ$?", back: "$\\frac{1}{2}$" },
  { id: "m07", front: "What is the equation linking power, current and resistance?", back: "$P = I^2 R$" },
  { id: "m08", front: "Expand $(x + 3)(x - 2)$", back: "$x^2 + x - 6$" },
  { id: "m09", front: "What is the derivative of $\\sin x$?", back: "$\\cos x$" },
  { id: "m10", front: "What is the area of a circle of radius $r$?", back: "$\\pi r^2$" },
  { id: "m11", front: "Factorise $x^2 - 9$", back: "$(x - 3)(x + 3)$" },
  { id: "m12", front: "What is the equation for the wave speed?", back: "$v = f\\lambda$" },
  { id: "m13", front: "Simplify $\\log_a a^n$", back: "$n$" },
  { id: "m14", front: "What is the gradient of the line $y = 4x - 7$?", back: "$4$" },
  { id: "m15", front: "Write $\\frac{3}{8}$ as a decimal", back: "$0.375$" },
  { id: "m16", front: "What is the equation for density?", back: "$\\rho = \\frac{m}{V}$" },
];

function asCard(card: StudyAssetCard): Card {
  return { id: card.id, deckId: "eval", userId: "eval", front: card.front, back: card.back } as unknown as Card;
}

type CardResult = {
  id: string;
  variantsKept: number;
  askable: boolean;
  /** Each question a student could be shown, the correct option first, for reading by eye. */
  shown?: string[];
};

async function runBatch(batch: StudyAssetCard[]) {
  const timing: StudyAssetBatchTiming = { generateMs: 0, reviewMs: 0 };
  const startedAt = Date.now();
  try {
    const { assets } = await generateStudyAssetBatch(batch, { timeoutMs: 70_000, timing });
    const results: CardResult[] = batch.map((card): CardResult => {
      const asset = assets.find((entry) => entry.cardId === card.id);
      const settings = mergeAssetIntoSettings(asset, undefined);
      const asked = { ...asCard(card), studySettings: settings };
      const question = buildMultipleChoiceQuestion({ card: asked });
      const shown = (asset?.mcqVariants ?? []).flatMap((_, variantIndex) => {
        const built = buildMultipleChoiceQuestion({ card: asked, variantIndex });
        if (!built) return [];
        const correct = built.options.find((option) => option.id === built.correctOptionId)?.text;
        const wrong = built.options.filter((option) => option.id !== built.correctOptionId).map((option) => option.text);
        return [`  ${card.front}  =>  RIGHT ${correct}  |  WRONG ${wrong.join("  ;  ")}`];
      });
      return { id: card.id, variantsKept: asset?.mcqVariants?.length ?? 0, askable: Boolean(question), shown };
    });
    return { ms: Date.now() - startedAt, timing, results, failure: null as string | null };
  } catch (error) {
    return {
      ms: Date.now() - startedAt,
      timing,
      results: batch.map((card): CardResult => ({ id: card.id, variantsKept: 0, askable: false })),
      failure: error instanceof Error ? error.message : String(error),
    };
  }
}

export default async function main([batchArg, concurrencyArg, setArg]: string[] = []) {
  if (!isAnyAiProviderConfigured("worker")) {
    console.log("No worker provider is configured. Set OPENROUTER_* in .env.local.");
    return;
  }
  const batchSize = Math.max(1, Number(batchArg ?? 1));
  const concurrency = Math.max(1, Number(concurrencyArg ?? 8));

  const batches: StudyAssetCard[][] = [];
  const set = setArg === "maths" ? MATHS_CARDS : CARDS;
  for (let at = 0; at < set.length; at += batchSize) batches.push(set.slice(at, at + batchSize));

  const wallStartedAt = Date.now();
  const outcomes: Awaited<ReturnType<typeof runBatch>>[] = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, batches.length) }, async () => {
      for (;;) {
        const position = cursor;
        cursor += 1;
        if (position >= batches.length) return;
        outcomes[position] = await runBatch(batches[position]);
      }
    })
  );
  const wallMs = Date.now() - wallStartedAt;

  for (const outcome of outcomes) {
    console.log(
      `${outcome.results.map((result) => result.id).join(",")}  ${outcome.ms}ms ` +
        `(generate ${outcome.timing.generateMs}, review ${outcome.timing.reviewMs})  ` +
        outcome.results.map((result) => `${result.id}:${result.variantsKept}${result.askable ? "✓" : "✗"}`).join(" ") +
        (outcome.failure ? `  FAILED: ${outcome.failure}` : "")
    );
  }
  const all = outcomes.flatMap((outcome) => outcome.results);
  if (setArg === "maths") {
    console.log("\nQuestions as a student would see them:");
    for (const result of all) for (const line of result.shown ?? []) console.log(line);
  }
  const askable = all.filter((result) => result.askable).length;
  const times = outcomes.map((outcome) => outcome.ms).sort((a, b) => a - b);
  console.log(
    `\nbatch ${batchSize}, ${concurrency} at once: askable as multiple choice ${askable}/${all.length}, ` +
      `failed batches ${outcomes.filter((outcome) => outcome.failure).length}/${outcomes.length}, ` +
      `batch p50 ${times[Math.floor(times.length / 2)]}ms, max ${times[times.length - 1]}ms, wall ${wallMs}ms`
  );
}
