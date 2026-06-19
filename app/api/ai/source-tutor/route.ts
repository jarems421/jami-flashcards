import type { NextRequest } from "next/server";
import { getAdminAuth, getAdminDb } from "@/services/firebase/admin";
import { getBearerToken } from "@/lib/auth/bearer";
import { checkAiBudget } from "@/lib/ai/budgets";
import { cleanGeneratedStudyText } from "@/lib/ai/card-autocomplete";
import { generateGeminiText } from "@/lib/ai/gemini";
import {
  normalizeSourceTutorIds,
  prepareSourceForTutor,
} from "@/lib/ai/source-ingestion";
import { hasDemoClaim } from "@/lib/demo/token";
import { mapSourceData } from "@/lib/practice/sources";
import { getAdminStorageBucket } from "@/services/firebase/admin";

export const runtime = "nodejs";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim() ?? "";
const REQUEST_TIMEOUT_MS = 45_000;
const MAX_TUTOR_SOURCES = 5;
const MAX_COMBINED_SOURCE_BYTES = 30 * 1024 * 1024;

function getFallbackReply() {
  return "I could not finish reading the selected sources just now. Try again with fewer or smaller sources.";
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

  let sourceIds: string[];
  let message: string;
  try {
    const body = await request.json();
    const requestedSourceIds: unknown[] = Array.isArray(body.sourceIds)
      ? body.sourceIds
      : [];
    sourceIds = normalizeSourceTutorIds(requestedSourceIds);
    message =
      typeof body.message === "string" && body.message.trim()
        ? body.message.trim().slice(0, 1_000)
        : "Explain the selected sources and identify the most useful revision ideas.";
    if (sourceIds.length === 0) {
      return Response.json({ error: "Select at least one source." }, { status: 400 });
    }
    if (sourceIds.length > MAX_TUTOR_SOURCES) {
      return Response.json(
        { error: "Tutor can use up to five sources at once." },
        { status: 400 }
      );
    }
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const allowed = await checkAiBudget({ uid, action: "sourceTutorExplain" });
  if (!allowed) {
    return Response.json({ error: "AI budget reached for source tutor today." }, { status: 429 });
  }

  const adminDb = getAdminDb();
  const snapshots = await Promise.all(
    sourceIds.map((sourceId) =>
      adminDb.collection("users").doc(uid).collection("sources").doc(sourceId).get()
    )
  );
  if (snapshots.some((snapshot) => !snapshot.exists)) {
    return Response.json({ error: "One or more sources could not be found." }, { status: 404 });
  }

  const sources = snapshots.map((snapshot) =>
    mapSourceData(snapshot.id, snapshot.data() ?? {})
  );
  const bucket = getAdminStorageBucket();
  const preparedResults = await Promise.all(
    sources.map(async (source) => {
      try {
        const prepared = await prepareSourceForTutor(source, async (storagePath) => {
          const [buffer] = await bucket.file(storagePath).download();
          return buffer;
        });
        return { source, prepared } as const;
      } catch (error) {
        return {
          source,
          error: error instanceof Error ? error.message : "This source could not be read.",
        } as const;
      }
    })
  );
  const readable = preparedResults.filter(
    (result): result is Extract<(typeof preparedResults)[number], { prepared: unknown }> =>
      "prepared" in result
  );
  const failures = preparedResults
    .filter(
      (result): result is Extract<(typeof preparedResults)[number], { error: unknown }> =>
        "error" in result
    )
    .map((result) => ({
      id: result.source.id,
      title: result.source.title,
      reason: result.error,
    }));

  if (readable.length === 0) {
    return Response.json(
      {
        error: failures[0]?.reason
          ? `The selected sources could not be read. ${failures[0].reason}`
          : "The selected sources could not be read.",
        sourceFailures: failures,
      },
      { status: 422 }
    );
  }
  const combinedBytes = readable.reduce(
    (total, result) => total + result.prepared.inputBytes,
    0
  );
  if (combinedBytes > MAX_COMBINED_SOURCE_BYTES) {
    return Response.json(
      { error: "Choose fewer or smaller sources. Tutor can read up to 30 MB at once." },
      { status: 413 }
    );
  }

  try {
    const text = await generateGeminiText({
      apiKey: GEMINI_API_KEY,
      timeoutMs: REQUEST_TIMEOUT_MS,
      request: {
        systemInstruction: `You are Jami's source tutor.
Answer only from the selected sources supplied in this request.
Use inline source labels such as [Biology notes] after claims or sections.
Finish with a short "Sources used" list containing only sources that supported the answer.
If sources conflict or do not contain enough information, say that clearly.
Do not silently use outside knowledge and do not create flashcards or notebook question drafts.
Be concise, student-friendly, and focused on helping the student understand.`,
        contents: [
          {
            role: "user",
            parts: [
              ...readable.flatMap((result) => result.prepared.parts),
              {
                text: `Student request:\n${message}`,
              },
            ],
          },
        ],
      },
      onRetry: ({ error, modelName, nextModelName }) => {
        console.warn(`Source tutor failed on ${modelName}; retrying with ${nextModelName}.`, error);
      },
    });

    const generatedReply = cleanGeneratedStudyText(text) || getFallbackReply();
    const failureNote =
      failures.length > 0
        ? `\n\nI could not read ${failures.map((failure) => `[${failure.title}]`).join(", ")}. Paste the relevant text or upload a readable copy if you want Tutor to include ${failures.length === 1 ? "it" : "them"}.`
        : "";
    const reply = `${generatedReply}${failureNote}`;
    const now = Date.now();
    const sourceTitles = readable.map((result) => result.source.title);
    const sourceIdList = readable.map((result) => result.source.id);
    const threadRef = await adminDb.collection("users").doc(uid).collection("tutorThreads").add({
      contextType: "source",
      contextId: sourceIdList[0],
      contextIds: sourceIdList,
      title:
        sourceTitles.length === 1
          ? sourceTitles[0].slice(0, 120)
          : `${sourceTitles[0]} + ${sourceTitles.length - 1} more`.slice(0, 120),
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

    return Response.json({
      reply,
      threadId: threadRef.id,
      sourcesUsed: readable.map((result) => ({
        id: result.source.id,
        title: result.source.title,
      })),
      sourceFailures: failures,
    });
  } catch (error) {
    console.error("Source tutor error:", error);
    return Response.json({ reply: getFallbackReply(), fallback: true });
  }
}
