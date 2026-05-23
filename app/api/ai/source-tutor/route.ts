import type { NextRequest } from "next/server";
import { getAdminAuth, getAdminDb } from "@/services/firebase/admin";
import { getBearerToken } from "@/lib/auth/bearer";
import { checkAiBudget } from "@/lib/ai/budgets";
import { cleanGeneratedStudyText } from "@/lib/ai/card-autocomplete";
import { generateGeminiText } from "@/lib/ai/gemini";
import { hasDemoClaim } from "@/lib/demo/token";
import { mapSourceData } from "@/lib/practice/sources";

export const runtime = "nodejs";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim() ?? "";
const REQUEST_TIMEOUT_MS = 15_000;

function getFallbackReply() {
  return "Tutor is taking longer than usual. For this source, pick one key definition, restate it in your own words, then turn it into one flashcard or one short practice question.";
}

export async function POST(request: NextRequest) {
  if (!GEMINI_API_KEY) {
    return Response.json({ error: "AI features are not configured" }, { status: 503 });
  }

  const token = getBearerToken(request.headers.get("authorization"));
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

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

  let sourceId: string;
  let message: string;
  try {
    const body = await request.json();
    sourceId = typeof body.sourceId === "string" ? body.sourceId.trim().slice(0, 160) : "";
    message =
      typeof body.message === "string" && body.message.trim()
        ? body.message.trim().slice(0, 1_000)
        : "Explain this source and identify the most useful revision ideas.";
    if (!sourceId) {
      return Response.json({ error: "sourceId is required" }, { status: 400 });
    }
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const allowed = await checkAiBudget({ uid, action: "sourceTutorExplain" });
  if (!allowed) {
    return Response.json({ error: "AI budget reached for source tutor today." }, { status: 429 });
  }

  const adminDb = getAdminDb();
  const sourceSnapshot = await adminDb.collection("users").doc(uid).collection("sources").doc(sourceId).get();
  if (!sourceSnapshot.exists) {
    return Response.json({ error: "Source not found" }, { status: 404 });
  }

  const source = mapSourceData(sourceSnapshot.id, sourceSnapshot.data() ?? {});
  if (!source.contentText) {
    return Response.json(
      { error: "This source has no pasted text yet. File and link parsing comes later." },
      { status: 400 }
    );
  }

  try {
    const text = await generateGeminiText({
      apiKey: GEMINI_API_KEY,
      timeoutMs: REQUEST_TIMEOUT_MS,
      request: {
        systemInstruction: `You are Jami's source tutor.
Ground your answer in the supplied source text.
If you use outside knowledge, label it clearly as outside context.
Be concise, student-friendly, and revision-focused.
Do not create final flashcards or questions unless asked by a separate draft action.`,
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `Source title: ${source.title}
Subject: ${source.subject ?? "Unspecified"}
Source text:
${source.contentText.slice(0, 12_000)}

Student request:
${message}`,
              },
            ],
          },
        ],
      },
      onRetry: ({ error, modelName, nextModelName }) => {
        console.warn(`Source tutor failed on ${modelName}; retrying with ${nextModelName}.`, error);
      },
    });

    const reply = cleanGeneratedStudyText(text) || getFallbackReply();
    const now = Date.now();
    const threadRef = await adminDb.collection("users").doc(uid).collection("tutorThreads").add({
      contextType: "source",
      contextId: source.id,
      title: source.title.slice(0, 120),
      createdAt: now,
      updatedAt: now,
    });
    const messages = adminDb.collection("users").doc(uid).collection("tutorMessages");
    await Promise.all([
      messages.add({
        threadId: threadRef.id,
        role: "user",
        intent: "source-tutor",
        text: message,
        createdAt: now,
      }),
      messages.add({
        threadId: threadRef.id,
        role: "model",
        intent: "source-tutor",
        text: reply,
        createdAt: now + 1,
      }),
    ]);

    return Response.json({ reply, threadId: threadRef.id });
  } catch (error) {
    console.error("Source tutor error:", error);
    return Response.json({ reply: getFallbackReply(), fallback: true });
  }
}
