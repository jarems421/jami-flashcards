import type { NextRequest } from "next/server";
import { getAdminAuth } from "@/services/firebase/admin";
import { getBearerToken } from "@/lib/auth/bearer";
import { checkRateLimit } from "@/lib/ai/rate-limit";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const runtime = "nodejs";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_EXPLAIN_PER_HOUR = 20;

const SYSTEM_PROMPT = `You are a study tutor. A student got a flashcard wrong.
Explain the correct answer clearly and memorably using analogies or mnemonics.
Under 120 words. Don't repeat the question or answer verbatim.`;

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

  const allowed = await checkRateLimit(uid, "explain", MAX_EXPLAIN_PER_HOUR);
  if (!allowed) {
    return Response.json(
      { error: "Rate limit exceeded. Try again later." },
      { status: 429 },
    );
  }

  let front: string;
  let back: string;

  try {
    const body = await request.json();
    front = typeof body.front === "string" ? body.front.slice(0, 400) : "";
    back = typeof body.back === "string" ? body.back.slice(0, 2000) : "";

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
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let text: string;
    try {
      const result = await model.generateContent({
        systemInstruction: SYSTEM_PROMPT,
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
      });
      text = result.response.text().trim();
    } finally {
      clearTimeout(timeout);
    }

    if (!text) {
      return Response.json(
        { error: "Empty response from AI" },
        { status: 502 },
      );
    }

    return Response.json({ explanation: text });
  } catch (error) {
    console.error("Gemini API error:", error);
    const message = error instanceof Error && error.name === "AbortError"
      ? "Request timed out"
      : "Failed to generate explanation";
    return Response.json(
      { error: message },
      { status: 502 },
    );
  }
}
