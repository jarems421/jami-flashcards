import type { NextRequest } from "next/server";
import { getAdminAuth, getAdminDb } from "@/services/firebase/admin";
import { getBearerToken } from "@/lib/auth/bearer";
import { checkRateLimit } from "@/lib/ai/rate-limit";
import { cleanGeneratedStudyText } from "@/lib/ai/card-autocomplete";
import { generateGeminiText } from "@/lib/ai/gemini";
import { hasDemoClaim } from "@/lib/demo/token";

export const runtime = "nodejs";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim() ?? "";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_EXPLAIN_PER_HOUR = 20;
const MAX_RELATED_CARDS = 6;

const BASE_SYSTEM_PROMPT = `You are a study tutor helping after a flashcard mistake.
Give a compact response with three goals:
1. clarify the answer in plain language,
2. point out the likely confusion or trap,
3. give one memory hook or mnemonic.

Keep it under 120 words.
Do not simply repeat the front and back verbatim.
Sound encouraging and concrete.`;

type ExplanationContext = {
  deckId?: unknown;
  deckName?: unknown;
  tags?: unknown;
  difficulty?: unknown;
  lapses?: unknown;
  reps?: unknown;
  scheduledDays?: unknown;
  elapsedDays?: unknown;
};

function getFallbackExplanation(front: string, back: string) {
  return `AI is taking longer than usual. Quick recovery: compare what you answered with the correct answer, then make one small rule that separates them. For this card, the answer to "${front.slice(0, 90)}" is: ${back.slice(0, 220)}`;
}

export async function POST(request: NextRequest) {
  if (!GEMINI_API_KEY) {
    return Response.json(
      { error: "AI features are not configured" },
      { status: 503 },
    );
  }

  const token = getBearerToken(request.headers.get("authorization"));
  if (!token) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let uid: string;
  try {
    const adminAuth = getAdminAuth();
    const decoded = await adminAuth.verifyIdToken(token);
    if (hasDemoClaim(decoded)) {
      return Response.json({ error: "AI is disabled in the shared demo account." }, { status: 403 });
    }
    uid = decoded.uid;
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const allowed = await checkRateLimit(uid, "explain", MAX_EXPLAIN_PER_HOUR);
  if (!allowed) {
    return Response.json(
      { error: "AI limit reached for now." },
      { status: 429 },
    );
  }

  let front: string;
  let back: string;
  let context: {
    deckId?: string;
    deckName?: string;
    tags?: string[];
    difficulty?: number;
    lapses?: number;
    reps?: number;
    scheduledDays?: number;
    elapsedDays?: number;
  } | null = null;

  try {
    const body = await request.json();
    front = typeof body.front === "string" ? body.front.slice(0, 400) : "";
    back = typeof body.back === "string" ? body.back.slice(0, 2000) : "";
    const rawContext = body.context as ExplanationContext | undefined;

    if (rawContext) {
      context = {
        deckId:
          typeof rawContext.deckId === "string" && rawContext.deckId.trim()
            ? rawContext.deckId.slice(0, 120)
            : undefined,
        deckName:
          typeof rawContext.deckName === "string" && rawContext.deckName.trim()
            ? rawContext.deckName.slice(0, 120)
            : undefined,
        tags: Array.isArray(rawContext.tags)
          ? rawContext.tags
              .filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
              .slice(0, 8)
          : undefined,
        difficulty:
          typeof rawContext.difficulty === "number"
            ? rawContext.difficulty
            : undefined,
        lapses:
          typeof rawContext.lapses === "number"
            ? rawContext.lapses
            : undefined,
        reps:
          typeof rawContext.reps === "number"
            ? rawContext.reps
            : undefined,
        scheduledDays:
          typeof rawContext.scheduledDays === "number"
            ? rawContext.scheduledDays
            : undefined,
        elapsedDays:
          typeof rawContext.elapsedDays === "number"
            ? rawContext.elapsedDays
            : undefined,
      };
    }

    if (!front || !back) {
      return Response.json(
        { error: "front and back are required" },
        { status: 400 },
      );
    }
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const memoryProfilePrompt = context
      ? `Card context:
- Deck: ${context.deckName ?? "Unknown"}
- Tags: ${context.tags?.length ? context.tags.map((tag) => `#${tag}`).join(", ") : "None"}
- Difficulty: ${
          typeof context.difficulty === "number"
            ? context.difficulty >= 7
              ? "high"
              : context.difficulty >= 4
                ? "medium"
                : context.difficulty > 0
                  ? "low"
                  : "new"
            : "unknown"
        }
- Times struggled: ${context.lapses ?? 0}
- Successful reps: ${context.reps ?? 0}
- Current interval: ${context.scheduledDays ?? 0} day(s)
- Days since last review window: ${context.elapsedDays ?? 0}

If this looks like a shaky card, be extra clear about the key distinction and give a memorable hook.`
      : "";
    let relatedCardsPrompt = "";

    if (context) {
      const adminDb = getAdminDb();
      const cardsSnapshot = await adminDb
        .collection("cards")
        .where("userId", "==", uid)
        .limit(200)
        .get();

      const relatedCards = cardsSnapshot.docs
        .map((doc) => {
          const data = doc.data();
          const cardFront = typeof data.front === "string" ? data.front : "";
          const cardBack = typeof data.back === "string" ? data.back : "";
          const deckId = typeof data.deckId === "string" ? data.deckId : "";
          const tags = Array.isArray(data.tags)
            ? data.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
            : [];

          let score = 0;
          if (context.deckId && deckId === context.deckId) {
            score += 6;
          }

          if (Array.isArray(context.tags) && context.tags.length > 0) {
            const matchingTags = tags.filter((tag) => context.tags?.includes(tag));
            score += matchingTags.length * 3;
          }

          if (
            cardFront.trim() === front.trim() &&
            cardBack.trim() === back.trim()
          ) {
            score = -1;
          }

          return { front: cardFront, back: cardBack, tags, score };
        })
        .filter((card) => card.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, MAX_RELATED_CARDS);

      if (relatedCards.length > 0) {
        relatedCardsPrompt = `\n\nNearby related cards:
${relatedCards
  .map(
    (card) =>
      `- Q: ${card.front.slice(0, 140)}
  A: ${card.back.slice(0, 220)}${
        card.tags.length ? `\n  Tags: ${card.tags.map((tag) => `#${tag}`).join(", ")}` : ""
      }`
  )
  .join("\n")}

Use these only to infer likely confusion patterns or useful distinctions.`;
      }
    }

    const generateExplanation = async () => {
      const text = await generateGeminiText({
        apiKey: GEMINI_API_KEY,
        timeoutMs: REQUEST_TIMEOUT_MS,
        request: {
          systemInstruction: `${BASE_SYSTEM_PROMPT}\n\n${memoryProfilePrompt}${relatedCardsPrompt}`.trim(),
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: `Flashcard front (question): ${front}\nFlashcard back (answer): ${back}`,
                },
              ],
            },
          ],
        },
        onRetry: ({ error, modelName, nextModelName }) => {
          console.warn(
            `Gemini explanation failed on ${modelName}; retrying with ${nextModelName}.`,
            error,
          );
        },
      });

      return cleanGeneratedStudyText(text);
    };

    let text = await generateExplanation().catch(async (error) => {
      console.warn("Gemini explanation first attempt failed:", error);
      return generateExplanation();
    });

    if (!text) {
      text = getFallbackExplanation(front, back);
    }

    return Response.json({ explanation: text });
  } catch (error) {
    console.error("Gemini API error:", error);
    return Response.json({
      explanation: getFallbackExplanation(front, back),
      fallback: true,
    });
  }
}
