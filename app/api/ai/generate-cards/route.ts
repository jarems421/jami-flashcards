import type { NextRequest } from "next/server";
import { getAdminAuth } from "@/services/firebase/admin";
import { getBearerToken } from "@/lib/auth/bearer";
import { checkRateLimit } from "@/lib/ai/rate-limit";
import { generateGeminiText, isGeminiTimeoutError } from "@/lib/ai/gemini";
import {
  MAX_NOTES_FOR_CARD_GENERATION,
  MIN_NOTES_FOR_CARD_GENERATION,
  parseGeneratedCardDrafts,
} from "@/lib/ai/card-generation";
import { hasDemoClaim } from "@/lib/demo/token";

export const runtime = "nodejs";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim() ?? "";
const MAX_GENERATE_CARDS_PER_HOUR = 25;
const REQUEST_TIMEOUT_MS = 20_000;

export async function POST(request: NextRequest) {
  if (!GEMINI_API_KEY) {
    return Response.json(
      { error: "AI features are not configured" },
      { status: 503 }
    );
  }

  const token = getBearerToken(request.headers.get("authorization"));
  if (!token) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let uid: string;
  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    if (hasDemoClaim(decoded)) {
      return Response.json({ error: "AI is disabled in the shared demo account." }, { status: 403 });
    }
    uid = decoded.uid;
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const allowed = await checkRateLimit(uid, "generate-cards", MAX_GENERATE_CARDS_PER_HOUR);
  if (!allowed) {
    return Response.json({ error: "AI limit reached for now." }, { status: 429 });
  }

  let notes: string;
  let deckName: string | undefined;
  let tags: string[];

  try {
    const body = (await request.json()) as Record<string, unknown>;
    notes = typeof body.notes === "string" ? body.notes.trim().slice(0, MAX_NOTES_FOR_CARD_GENERATION) : "";
    deckName = typeof body.deckName === "string" && body.deckName.trim() ? body.deckName.trim().slice(0, 120) : undefined;
    tags = Array.isArray(body.tags)
      ? body.tags
          .filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
          .map((tag) => tag.trim().slice(0, 60))
          .slice(0, 10)
      : [];
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (notes.length < MIN_NOTES_FOR_CARD_GENERATION) {
    return Response.json(
      { error: `Paste at least ${MIN_NOTES_FOR_CARD_GENERATION} characters of notes.` },
      { status: 400 }
    );
  }

  try {
    const systemPrompt = `You turn student notes into import-ready flashcards.

Return only a JSON array. No markdown, no preamble.
Each array item must be an object with exactly these string fields:
- "front": a clear active-recall question or cue
- "back": a concise answer that is accurate and easy to review

Rules:
- Prefer testable concepts, definitions, causes, steps, formulas, dates, and contrasts.
- Do not invent facts that are not in the notes.
- Keep fronts under 160 characters where possible.
- Keep backs compact; use short bullets only when they improve scanning.
- Avoid duplicates and overly broad questions.`;

    const userPrompt = `Deck: ${deckName ?? "Unknown"}
Tags: ${tags.length ? tags.join(", ") : "None"}

Notes:
${notes}`;

    const text = await generateGeminiText({
      apiKey: GEMINI_API_KEY,
      timeoutMs: REQUEST_TIMEOUT_MS,
      generationConfig: {
        temperature: 0.2,
        topP: 0.85,
        maxOutputTokens: 2600,
      },
      request: {
        systemInstruction: systemPrompt,
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      },
      onRetry: ({ error, modelName, nextModelName }) => {
        console.warn(
          `Gemini card generation failed on ${modelName}; retrying with ${nextModelName}.`,
          error,
        );
      },
    });

    const cards = parseGeneratedCardDrafts(text);
    if (cards.length === 0) {
      return Response.json(
        { error: "AI could not turn those notes into usable cards." },
        { status: 502 }
      );
    }

    return Response.json({ cards });
  } catch (error) {
    console.error("Gemini card generation error:", error);
    const message =
      isGeminiTimeoutError(error)
        ? "AI is taking longer than usual."
        : "AI could not generate cards right now.";
    return Response.json({ error: message }, { status: 502 });
  }
}
