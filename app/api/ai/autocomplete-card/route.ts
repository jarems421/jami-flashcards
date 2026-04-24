import type { NextRequest } from "next/server";
import { getAdminAuth, getAdminDb } from "@/services/firebase/admin";
import { getBearerToken } from "@/lib/auth/bearer";
import { checkRateLimit } from "@/lib/ai/rate-limit";
import { generateGeminiText, isGeminiTimeoutError } from "@/lib/ai/gemini";
import {
  cleanGeneratedCardBack,
  detectCardBackSubject,
  getStylePrompt,
  getSubjectPrompt,
  isCardBackAutocompleteStyle,
  type CardBackAutocompleteStyle,
} from "@/lib/ai/card-autocomplete";
import { hasDemoClaim } from "@/lib/demo/token";

export const runtime = "nodejs";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
const MAX_AUTOCOMPLETE_PER_HOUR = 50;
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_RELATED_CARDS = 5;
const MAX_BACK_OUTPUT_LENGTH = 2000;
const MIN_COMPLETE_BACK_LENGTH = 42;

function hasBalancedPairs(text: string, left: string, right: string) {
  let depth = 0;
  for (const char of text) {
    if (char === left) {
      depth += 1;
    } else if (char === right) {
      depth -= 1;
      if (depth < 0) {
        return false;
      }
    }
  }
  return depth === 0;
}

function isLikelyIncompleteBack(text: string, front: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return true;
  }

  if (
    !hasBalancedPairs(trimmed, "(", ")") ||
    !hasBalancedPairs(trimmed, "[", "]") ||
    !hasBalancedPairs(trimmed, "{", "}")
  ) {
    return true;
  }

  if (/[:;,(\[{/\-]$/.test(trimmed)) {
    return true;
  }

  if (/\b(?:etc|e\.g)\.?$/i.test(trimmed)) {
    return true;
  }

  if (trimmed.length < MIN_COMPLETE_BACK_LENGTH) {
    return true;
  }

  const frontWords = front.trim().split(/\s+/).filter(Boolean).length;
  const backWords = trimmed.split(/\s+/).filter(Boolean).length;
  if (frontWords >= 8 && backWords < 7) {
    return true;
  }

  return false;
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

  const allowed = await checkRateLimit(uid, "autocomplete-card", MAX_AUTOCOMPLETE_PER_HOUR);
  if (!allowed) {
    return Response.json(
      { error: "AI limit reached for now." },
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

    const generateDraft = async (prompt: string) => {
      const text = await generateGeminiText({
        apiKey: GEMINI_API_KEY,
        timeoutMs: REQUEST_TIMEOUT_MS,
        generationConfig: {
          temperature: 0.15,
          topP: 0.85,
          maxOutputTokens: 900,
        },
        request: {
          systemInstruction: systemPrompt,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
        },
        onRetry: ({ error, modelName, nextModelName }) => {
          console.warn(
            `Gemini card autocomplete failed on ${modelName}; retrying with ${nextModelName}.`,
            error,
          );
        },
      });
      return cleanGeneratedCardBack(text);
    };

    let reply = await generateDraft(userPrompt).catch(async (error) => {
      console.warn("Gemini card autocomplete first attempt failed:", error);
      const quickPrompt = `Write a complete, concise flashcard back for this front.

Front:
${front}

Current draft:
${currentBack || "(empty)"}

Return only the finished back text.`;
      return generateDraft(quickPrompt);
    });

    if (isLikelyIncompleteBack(reply, front)) {
      const retryPrompt = `The previous draft looks incomplete.

Front:
${front}

Previous draft:
${reply || "(empty)"}

Rewrite the complete final back in one concise response.
- Keep it accurate and fully usable as the back of a flashcard.
- Finish all equations/sentences.
- Do not output placeholders like "etc." or unfinished fragments.`;
      const retriedReply = await generateDraft(retryPrompt);
      if (
        !isLikelyIncompleteBack(retriedReply, front) ||
        retriedReply.length > reply.length
      ) {
        reply = retriedReply;
      }
    }

    if (!reply) {
      return Response.json({ error: "AI could not return a usable answer right now." }, { status: 502 });
    }

    return Response.json({ back: reply.slice(0, MAX_BACK_OUTPUT_LENGTH) });
  } catch (error) {
    console.error("Gemini card autocomplete error:", error);
    const message =
      isGeminiTimeoutError(error)
        ? "AI is taking longer than usual."
        : "AI could not complete the draft right now.";
    return Response.json({ error: message }, { status: 502 });
  }
}
