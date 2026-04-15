import type { NextRequest } from "next/server";
import { getAdminAuth, getAdminDb } from "@/services/firebase/admin";
import { getBearerToken } from "@/lib/auth/bearer";
import { checkRateLimit } from "@/lib/ai/rate-limit";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const runtime = "nodejs";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";

const MAX_CARDS = 200;
const MAX_MESSAGES = 20;
const MAX_CONTEXT_LENGTH = 8000;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_CHAT_PER_HOUR = 30;
const MAX_RELATED_CARDS = 6;

type ChatMessage = {
  role: "user" | "model";
  text: string;
};

type StudyChatContext = {
  mode?: unknown;
  front?: unknown;
  back?: unknown;
  deckId?: unknown;
  deckName?: unknown;
  tags?: unknown;
  difficulty?: unknown;
  lapses?: unknown;
  reps?: unknown;
  scheduledDays?: unknown;
  elapsedDays?: unknown;
};

type StudyChatIntent =
  | "clue"
  | "strong-clue"
  | "self-test"
  | "explain-simple"
  | "mnemonic"
  | "why-wrong"
  | "follow-up";

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

  const allowed = await checkRateLimit(uid, "chat", MAX_CHAT_PER_HOUR);
  if (!allowed) {
    return Response.json(
      { error: "Rate limit exceeded. Try again later." },
      { status: 429 },
    );
  }

  let message: string;
  let history: ChatMessage[];
  let intent: StudyChatIntent = "follow-up";
  let studyContext: {
    mode: "clue" | "review";
    front: string;
    back: string;
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
    message = typeof body.message === "string" ? body.message.slice(0, 1000) : "";
    history = Array.isArray(body.history)
      ? (body.history as ChatMessage[])
          .slice(-MAX_MESSAGES)
          .filter(
            (m) =>
              (m.role === "user" || m.role === "model") &&
              typeof m.text === "string",
          )
      : [];
    const rawStudyContext = body.studyContext as StudyChatContext | undefined;
    if (
      body.intent === "clue" ||
      body.intent === "strong-clue" ||
      body.intent === "self-test" ||
      body.intent === "explain-simple" ||
      body.intent === "mnemonic" ||
      body.intent === "why-wrong" ||
      body.intent === "follow-up"
    ) {
      intent = body.intent;
    }
    if (
      rawStudyContext &&
      (rawStudyContext.mode === "clue" || rawStudyContext.mode === "review") &&
      typeof rawStudyContext.front === "string" &&
      typeof rawStudyContext.back === "string"
    ) {
      studyContext = {
        mode: rawStudyContext.mode,
        front: rawStudyContext.front.slice(0, 500),
        back: rawStudyContext.back.slice(0, 1000),
        deckId:
          typeof rawStudyContext.deckId === "string" &&
          rawStudyContext.deckId.trim()
            ? rawStudyContext.deckId.slice(0, 120)
            : undefined,
        deckName:
          typeof rawStudyContext.deckName === "string" &&
          rawStudyContext.deckName.trim()
            ? rawStudyContext.deckName.slice(0, 120)
            : undefined,
        tags: Array.isArray(rawStudyContext.tags)
          ? rawStudyContext.tags
              .filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
              .slice(0, 8)
          : undefined,
        difficulty:
          typeof rawStudyContext.difficulty === "number"
            ? rawStudyContext.difficulty
            : undefined,
        lapses:
          typeof rawStudyContext.lapses === "number"
            ? rawStudyContext.lapses
            : undefined,
        reps:
          typeof rawStudyContext.reps === "number"
            ? rawStudyContext.reps
            : undefined,
        scheduledDays:
          typeof rawStudyContext.scheduledDays === "number"
            ? rawStudyContext.scheduledDays
            : undefined,
        elapsedDays:
          typeof rawStudyContext.elapsedDays === "number"
            ? rawStudyContext.elapsedDays
            : undefined,
      };
    }

    if (!message) {
      return Response.json(
        { error: "message is required" },
        { status: 400 },
      );
    }
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const adminDb = getAdminDb();
    const cardsSnapshot = await adminDb
      .collection("cards")
      .where("userId", "==", uid)
      .limit(MAX_CARDS)
      .get();

    const prioritizedCards = cardsSnapshot.docs
      .map((doc) => {
        const data = doc.data();
        const front = typeof data.front === "string" ? data.front : "";
        const back = typeof data.back === "string" ? data.back : "";
        const deckId = typeof data.deckId === "string" ? data.deckId : "";
        const tags = Array.isArray(data.tags)
          ? data.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
          : [];

        let score = 0;
        if (studyContext?.deckId && deckId === studyContext.deckId) {
          score += 6;
        }

        if (studyContext?.tags?.length) {
          const matchingTags = tags.filter((tag) => studyContext.tags?.includes(tag));
          score += matchingTags.length * 3;
        }

        if (
          studyContext &&
          front.trim() === studyContext.front.trim() &&
          back.trim() === studyContext.back.trim()
        ) {
          score = -1;
        }

        return { front, back, tags, score };
      })
      .sort((left, right) => right.score - left.score);

    const cards: string[] = [];
    let contextLength = 0;
    for (const card of prioritizedCards) {
      const entry = `Q: ${card.front.slice(0, 200)}\nA: ${card.back.slice(0, 400)}`;
      if (contextLength + entry.length > MAX_CONTEXT_LENGTH) break;
      cards.push(entry);
      contextLength += entry.length;
    }
    const cardsSummary = cards.join("\n---\n");
    const relatedCards = prioritizedCards
      .filter((card) => card.score > 0)
      .slice(0, MAX_RELATED_CARDS);
    const relatedCardsPrompt = relatedCards.length
      ? `Nearby related cards from the same deck or overlapping tags:
${relatedCards
  .map(
    (card) =>
      `- Q: ${card.front.slice(0, 140)}
  A: ${card.back.slice(0, 220)}${
        card.tags.length ? `\n  Tags: ${card.tags.map((tag) => `#${tag}`).join(", ")}` : ""
      }`
  )
  .join("\n")}`
      : "";

    const intentPrompt =
      intent === "clue"
        ? "Give one gentle clue or leading question. Do not reveal the answer."
        : intent === "strong-clue"
          ? "Give a stronger clue with more structure, but still avoid directly revealing the answer unless explicitly requested."
          : intent === "self-test"
            ? "Ask one short quiz question or mini-check that helps the student recall the answer actively."
            : intent === "explain-simple"
              ? "Explain the concept simply in 2-4 short sentences using plain language."
              : intent === "mnemonic"
                ? "Give one compact mnemonic, memory hook, or vivid association tied to this card."
                : intent === "why-wrong"
                  ? "Explain the most likely confusion or trap behind getting this card wrong, then clarify the key distinction."
                  : "Answer the student's follow-up directly and helpfully, keeping it concise and study-focused.";

    const memoryProfilePrompt = studyContext
      ? `Memory profile:
- Difficulty: ${
          typeof studyContext.difficulty === "number"
            ? studyContext.difficulty >= 7
              ? "high"
              : studyContext.difficulty >= 4
                ? "medium"
                : studyContext.difficulty > 0
                  ? "low"
                  : "new"
            : "unknown"
        }
- Times struggled: ${studyContext.lapses ?? 0}
- Successful reps: ${studyContext.reps ?? 0}
- Current interval: ${studyContext.scheduledDays ?? 0} day(s)
- Days since last review window: ${studyContext.elapsedDays ?? 0}

If this profile looks shaky (hard card, repeated struggles, short review gaps), give more scaffolding, point out likely confusion, and prefer compact memory hooks.
If it looks stable, keep the answer concise and avoid overexplaining.`
      : "";

    const studyContextPrompt = studyContext
      ? studyContext.mode === "clue"
        ? `The student is currently looking at this flashcard front and has NOT flipped it yet.

Front:
${studyContext.front}

Deck:
${studyContext.deckName ?? "Unknown"}

Tags:
${studyContext.tags?.length ? studyContext.tags.map((tag) => `#${tag}`).join(", ") : "None"}

Correct answer:
${studyContext.back}

${memoryProfilePrompt}

${relatedCardsPrompt}

Use nearby related cards only to infer likely mix-ups or useful contrasts.
Your job is to give hints, leading questions, mnemonics, or nudges WITHOUT directly revealing the answer unless the user explicitly asks you to give it away.`
        : `The student has already flipped this flashcard and can see both sides.

Front:
${studyContext.front}

Deck:
${studyContext.deckName ?? "Unknown"}

Tags:
${studyContext.tags?.length ? studyContext.tags.map((tag) => `#${tag}`).join(", ") : "None"}

Answer:
${studyContext.back}

${memoryProfilePrompt}

${relatedCardsPrompt}

Use nearby related cards to spot likely confusion patterns, important distinctions, or useful comparisons when helpful.
Your job is to explain, clarify, connect ideas, answer follow-up questions, and help them understand the card more deeply.`
      : "";

    const systemPrompt = `You are a concise study buddy. The student's flashcards:

${cardsSummary}

${studyContextPrompt}

Current response style:
${intentPrompt}

Help by quizzing, explaining concepts, suggesting mnemonics, or connecting ideas.
Under 120 words. Be conversational, specific, and useful for flashcard study.`;

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const contents = [
      ...history.map((m) => ({
        role: m.role,
        parts: [{ text: m.text.slice(0, 1000) }],
      })),
      {
        role: "user" as const,
        parts: [{ text: message }],
      },
    ];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let reply: string;
    try {
      const result = await model.generateContent({
        systemInstruction: systemPrompt,
        contents,
      });
      reply = result.response.text().trim();
    } finally {
      clearTimeout(timeout);
    }

    if (!reply) {
      return Response.json(
        { error: "Empty response from AI" },
        { status: 502 },
      );
    }

    return Response.json({ reply });
  } catch (error) {
    console.error("Gemini chat error:", error);
    const message = error instanceof Error && error.name === "AbortError"
      ? "Request timed out"
      : "Failed to generate response";
    return Response.json(
      { error: message },
      { status: 502 },
    );
  }
}
