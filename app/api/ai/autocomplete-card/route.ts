import type { NextRequest } from "next/server";
import { getAdminAuth, getAdminDb } from "@/services/firebase/admin";
import { getBearerToken } from "@/lib/auth/bearer";
import { checkRateLimit } from "@/lib/ai/rate-limit";
import {
  cleanGeneratedCardBack,
  detectCardBackSubject,
  getStylePrompt,
  getSubjectPrompt,
  isCardBackAutocompleteStyle,
  type CardBackAutocompleteStyle,
} from "@/lib/ai/card-autocomplete";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const runtime = "nodejs";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
const MAX_AUTOCOMPLETE_PER_HOUR = 50;
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_RELATED_CARDS = 5;
const MAX_BACK_OUTPUT_LENGTH = 2000;

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
  let style: CardBackAutocompleteStyle;

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
    style = isCardBackAutocompleteStyle(body.style) ? body.style : "auto";

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

    const subject = detectCardBackSubject({ front, deckName, tags, style });
    const subjectPrompt = getSubjectPrompt(subject);
    const systemPrompt = `You write the BACK side of a flashcard for a student.

Non-negotiable rules:
- Return only the finished back-of-card text. No labels, no preamble, no markdown fence.
- Be accurate, compact, and easy to review during active recall.
- Prefer one strong answer over a mini textbook section.
- Use line breaks or bullets only when they make the card easier to scan.
- If the front is ambiguous, give the most likely useful answer and include the key assumption in a short phrase.
- If equations are useful, keep symbols readable, define them briefly, and avoid malformed characters.
- Never output raw HTML entities, literal unicode escape codes, or broken symbol substitutes.
- Do not invent niche facts that are not implied by the front, deck, tags, or related cards.
- Match the user's existing card style when nearby cards give a clear pattern.

${getStylePrompt(style)}

${subjectPrompt}`;

    const userPrompt = `Deck: ${deckName ?? "Unknown"}
Tags: ${tags.length ? tags.join(", ") : "None"}

Front:
${front}

Current back draft:
${currentBack || "(empty)"}

${relatedCardsPrompt}

Write the best flashcard back. If there is already a draft, improve or complete it without making it bloated.`;

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        temperature: 0.2,
        topP: 0.85,
        maxOutputTokens: 650,
      },
    });
    const result = await withRequestTimeout(
      model.generateContent({
        systemInstruction: systemPrompt,
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      })
    );
    const reply = cleanGeneratedCardBack(result.response.text());

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
