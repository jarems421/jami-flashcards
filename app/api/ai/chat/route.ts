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

type ChatMessage = {
  role: "user" | "model";
  text: string;
};

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

    const cards: string[] = [];
    let contextLength = 0;
    for (const doc of cardsSnapshot.docs) {
      const data = doc.data();
      const entry = `Q: ${(data.front as string).slice(0, 200)}\nA: ${(data.back as string).slice(0, 400)}`;
      if (contextLength + entry.length > MAX_CONTEXT_LENGTH) break;
      cards.push(entry);
      contextLength += entry.length;
    }
    const cardsSummary = cards.join("\n---\n");

    const systemPrompt = `You are a concise study buddy. The student's flashcards:

${cardsSummary}

Help by quizzing, explaining concepts, suggesting mnemonics, or connecting ideas.
Under 150 words. Be conversational.`;

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
