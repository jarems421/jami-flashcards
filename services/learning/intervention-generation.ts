import type { GeneratedCardDraft } from "@/lib/ai/card-generation";
import type { InterventionDraft } from "@/lib/learning/interventions/draft";
import type { PracticeQuestionDraft } from "@/lib/learning/interventions/practice-request";
import { auth } from "@/services/firebase/client";
import { withTimeout } from "@/services/firebase/firestore";

/**
 * Asking Jami to write the material for one recommendation.
 *
 * Returns a draft or throws. Nothing is stored either way -- storing is the
 * student's decision, taken on the review screen -- so a failure here costs a
 * button press and leaves the recommendation exactly where it was.
 */

/** Generation runs two model calls at worst and is started by a deliberate press. */
const GENERATE_MS = 60_000;

export class InterventionGenerationError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "InterventionGenerationError";
    this.code = code;
  }
}

type GenerateResponse = {
  kind?: unknown;
  conceptId?: unknown;
  conceptLabel?: unknown;
  interventionId?: unknown;
  cards?: unknown;
  questions?: unknown;
  dropped?: unknown;
};

function asCards(value: unknown): GeneratedCardDraft[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const record = entry as { front?: unknown; back?: unknown };
    return typeof record?.front === "string" && typeof record.back === "string"
      ? [{ front: record.front, back: record.back }]
      : [];
  });
}

function asQuestions(value: unknown): PracticeQuestionDraft[] {
  // The route has already run these through the fail-closed validator; this is
  // only the shape check any parsed response needs before it is trusted.
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is PracticeQuestionDraft => {
    const record = entry as Partial<PracticeQuestionDraft>;
    return (
      typeof record?.prompt === "string" &&
      typeof record.answer === "string" &&
      typeof record.marks === "number" &&
      Array.isArray(record.points)
    );
  });
}

export async function generateInterventionDraft(input: {
  kind: "create_flashcards" | "create_practice";
  conceptId: string;
  folderId: string;
  interventionId: string;
}): Promise<InterventionDraft> {
  const user = auth.currentUser;
  if (!user) throw new InterventionGenerationError("You are not signed in.", "unauthorized");
  const token = await user.getIdToken();

  const response = await withTimeout(
    fetch("/api/learning/interventions/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
    }),
    GENERATE_MS,
    "Write study material"
  );
  const data = (await response.json().catch(() => null)) as GenerateResponse | null;
  if (!response.ok || !data) {
    throw new InterventionGenerationError(
      typeof (data as { error?: unknown } | null)?.error === "string"
        ? ((data as { error: string }).error)
        : "Jami could not write this right now.",
      typeof (data as { code?: unknown } | null)?.code === "string"
        ? ((data as { code: string }).code)
        : "generation_failed"
    );
  }

  const conceptId = typeof data.conceptId === "string" ? data.conceptId : input.conceptId;
  const conceptLabel = typeof data.conceptLabel === "string" ? data.conceptLabel : conceptId;
  const dropped = typeof data.dropped === "number" ? data.dropped : 0;
  const base = {
    interventionId: input.interventionId,
    conceptId,
    conceptLabel,
    dropped,
    generatedAt: Date.now(),
  };

  if (data.kind === "create_practice") {
    const questions = asQuestions(data.questions);
    if (questions.length === 0) {
      throw new InterventionGenerationError(
        "Jami could not write usable questions for this.",
        "no_usable_questions"
      );
    }
    return { ...base, payload: { kind: "create_practice", questions } };
  }

  const cards = asCards(data.cards);
  if (cards.length === 0) {
    throw new InterventionGenerationError(
      "Jami could not write usable cards for this.",
      "no_usable_cards"
    );
  }
  return { ...base, payload: { kind: "create_flashcards", cards } };
}
