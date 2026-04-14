import type { NextRequest } from "next/server";
import { getAdminAuth, getAdminDb } from "@/services/firebase/admin";
import { getBearerToken } from "@/lib/auth/bearer";
import { checkRateLimit } from "@/lib/ai/rate-limit";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const runtime = "nodejs";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
const MAX_AUTOCOMPLETE_PER_HOUR = 50;
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_RELATED_CARDS = 5;
const MAX_BACK_OUTPUT_LENGTH = 2000;

const answerStyles = [
  "auto",
  "definition",
  "equation",
  "explanation",
  "steps",
  "example",
  "compare",
] as const;

type AnswerStyle = (typeof answerStyles)[number];

function isAnswerStyle(value: unknown): value is AnswerStyle {
  return typeof value === "string" && answerStyles.includes(value as AnswerStyle);
}

function cleanGeneratedBack(text: string) {
  return text
    .replace(/^```(?:\w+)?\s*/i, "")
    .replace(/```$/i, "")
    .replace(/^(answer|back)\s*:\s*/i, "")
    .trim();
}

async function withRequestTimeout<T>(promise: Promise<T>) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("Request timed out")), REQUEST_TIMEOUT_MS);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function getStylePrompt(style: AnswerStyle) {
  switch (style) {
    case "definition":
      return `Definition-focused:
- Start with the clearest definition or identity.
- Include the minimum context needed to distinguish it from similar terms.
- Avoid long paragraphs.`;
    case "equation":
      return `Equation-focused:
- Give the key formula/equation first.
- Define every symbol briefly.
- Add units or conditions if they matter.
- Include one tiny note about when to use it.`;
    case "explanation":
      return `Explanation-focused:
- Explain the idea in plain language.
- Use cause/effect or intuition where helpful.
- Keep it compact enough to review quickly.`;
    case "steps":
      return `Process/steps-focused:
- Use a short numbered or line-broken sequence.
- Make each step actionable and memorable.
- Do not add unnecessary theory.`;
    case "example":
      return `Example-focused:
- Give the answer plus one concise example.
- Make the example concrete and easy to review.
- Avoid turning the back into a full lesson.`;
    case "compare":
      return `Comparison-focused:
- State the key distinction from the closest confusing idea.
- Use "X is..., while Y is..." if useful.
- Keep the contrast sharp and testable.`;
    case "auto":
    default:
      return `Auto-detect the best flashcard back style:
- If the front asks "what is/define", write a definition.
- If it contains symbols, numbers, units, or asks "calculate", write an equation/formula answer.
- If it asks "why/how", write a short explanation.
- If it asks for a method/process, write concise steps.
- If it asks for differences, write a compact comparison.`;
  }
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
    uid = decoded.uid;
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const allowed = await checkRateLimit(uid, "autocomplete-card", MAX_AUTOCOMPLETE_PER_HOUR);
  if (!allowed) {
    return Response.json(
      { error: "Rate limit exceeded. Try again later." },
      { status: 429 },
    );
  }

  let front: string;
  let currentBack: string;
  let deckId: string | undefined;
  let deckName: string | undefined;
  let tags: string[];
  let style: AnswerStyle;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    front = typeof body.front === "string" ? body.front.slice(0, 700).trim() : "";
    currentBack = typeof body.currentBack === "string" ? body.currentBack.slice(0, 1500).trim() : "";
    deckId = typeof body.deckId === "string" && body.deckId.trim() ? body.deckId.slice(0, 120) : undefined;
    deckName = typeof body.deckName === "string" && body.deckName.trim() ? body.deckName.slice(0, 120) : undefined;
    tags = Array.isArray(body.tags)
      ? body.tags
          .filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
          .map((tag) => tag.trim().slice(0, 60))
          .slice(0, 10)
      : [];
    style = isAnswerStyle(body.style) ? body.style : "auto";

    if (!front) {
      return Response.json({ error: "front is required" }, { status: 400 });
    }
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const adminDb = getAdminDb();
    const cardsSnapshot = await adminDb
      .collection("cards")
      .where("userId", "==", uid)
      .limit(120)
      .get();

    const relatedCards = cardsSnapshot.docs
      .map((cardDoc) => {
        const data = cardDoc.data();
        const cardFront = typeof data.front === "string" ? data.front : "";
        const cardBack = typeof data.back === "string" ? data.back : "";
        const cardDeckId = typeof data.deckId === "string" ? data.deckId : "";
        const cardTags = Array.isArray(data.tags)
          ? data.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
          : [];

        let score = 0;
        if (deckId && cardDeckId === deckId) score += 5;
        if (tags.length > 0) {
          score += cardTags.filter((tag) => tags.includes(tag)).length * 3;
        }
        if (cardFront.trim() === front.trim()) score -= 10;

        return { front: cardFront, back: cardBack, tags: cardTags, score };
      })
      .filter((card) => card.score > 0 && card.front && card.back)
      .sort((left, right) => right.score - left.score)
      .slice(0, MAX_RELATED_CARDS);

    const relatedCardsPrompt = relatedCards.length
      ? `Nearby cards for tone, level, and formatting:
${relatedCards
  .map(
    (card) =>
      `- Front: ${card.front.slice(0, 160)}
  Back: ${card.back.slice(0, 260)}
  Tags: ${card.tags.length ? card.tags.join(", ") : "None"}`,
  )
  .join("\n")}`
      : "No nearby cards are available.";

    const systemPrompt = `You write the BACK side of a flashcard.

Non-negotiable rules:
- Return only the finished back-of-card text. No labels, no preamble, no markdown fence.
- Be accurate, compact, and easy to review.
- Prefer one strong answer over a mini textbook section.
- Use line breaks or bullets only when they make the card easier to scan.
- If the front is ambiguous, give the most likely useful answer and include the key assumption in a short phrase.
- If equations are useful, keep symbols readable and define them briefly.
- Do not invent niche facts that are not implied by the front, deck, tags, or related cards.

${getStylePrompt(style)}`;

    const userPrompt = `Deck: ${deckName ?? "Unknown"}
Tags: ${tags.length ? tags.join(", ") : "None"}

Front:
${front}

Current back draft:
${currentBack || "(empty)"}

${relatedCardsPrompt}

Write the best flashcard back. If there is already a draft, improve or complete it without making it bloated.`;

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await withRequestTimeout(
      model.generateContent({
        systemInstruction: systemPrompt,
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      })
    );
    const reply = cleanGeneratedBack(result.response.text());

    if (!reply) {
      return Response.json({ error: "Empty response from AI" }, { status: 502 });
    }

    return Response.json({ back: reply.slice(0, MAX_BACK_OUTPUT_LENGTH) });
  } catch (error) {
    console.error("Gemini card autocomplete error:", error);
    const message =
      error instanceof Error && error.message === "Request timed out"
        ? error.message
        : "Failed to draft card back";
    return Response.json({ error: message }, { status: 502 });
  }
}
