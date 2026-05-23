import type { NextRequest } from "next/server";
import { getAdminAuth, getAdminDb } from "@/services/firebase/admin";
import { getBearerToken } from "@/lib/auth/bearer";
import { checkAiBudget } from "@/lib/ai/budgets";
import { parseGeneratedCardDrafts } from "@/lib/ai/card-generation";
import { cleanGeneratedStudyText } from "@/lib/ai/card-autocomplete";
import { generateGeminiText } from "@/lib/ai/gemini";
import { parseGeneratedQuestionDrafts } from "@/lib/ai/question-generation";
import { hasDemoClaim } from "@/lib/demo/token";
import { mapSourceData } from "@/lib/practice/sources";

export const runtime = "nodejs";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim() ?? "";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_FLASHCARD_DRAFTS = 8;
const MAX_PRACTICE_DRAFTS = 5;

type SourceDraftKind = "flashcard" | "practice-question";

function isSourceDraftKind(value: unknown): value is SourceDraftKind {
  return value === "flashcard" || value === "practice-question";
}

function getPrompt(kind: SourceDraftKind, count: number) {
  if (kind === "flashcard") {
    return `Create ${count} concise flashcard drafts from the source.
Return JSON only as an array of objects with "front" and "back".
Each card should test one concept or distinction.
Do not invent facts that are not grounded in the source.`;
  }

  return `Create ${count} practice question drafts from the source.
Return JSON only as an array of objects with "questionText", "answerText", and "solutionText".
Questions should be short, useful for revision, and answerable from the source.
Do not invent facts that are not grounded in the source.`;
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
  let kind: SourceDraftKind;
  let count: number;
  try {
    const body = await request.json();
    sourceId = typeof body.sourceId === "string" ? body.sourceId.trim().slice(0, 160) : "";
    kind = isSourceDraftKind(body.kind) ? body.kind : "flashcard";
    const requestedCount = typeof body.count === "number" ? Math.round(body.count) : kind === "flashcard" ? 5 : 3;
    count =
      kind === "flashcard"
        ? Math.max(1, Math.min(MAX_FLASHCARD_DRAFTS, requestedCount))
        : Math.max(1, Math.min(MAX_PRACTICE_DRAFTS, requestedCount));
    if (!sourceId) {
      return Response.json({ error: "sourceId is required" }, { status: 400 });
    }
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const allowed = await checkAiBudget({
    uid,
    action: kind === "flashcard" ? "sourceFlashcardDrafts" : "sourcePracticeDrafts",
  });
  if (!allowed) {
    return Response.json({ error: "AI budget reached for source drafts today." }, { status: 429 });
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
    const generated = await generateGeminiText({
      apiKey: GEMINI_API_KEY,
      timeoutMs: REQUEST_TIMEOUT_MS,
      request: {
        systemInstruction: `You create reviewed-by-human draft learning content for Jami.
Everything you produce remains a draft until the student approves it.
Use only the supplied source. Return valid JSON only.`,
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `${getPrompt(kind, count)}

Source title: ${source.title}
Subject: ${source.subject ?? "Unspecified"}
Source text:
${source.contentText.slice(0, 12_000)}`,
              },
            ],
          },
        ],
      },
      onRetry: ({ error, modelName, nextModelName }) => {
        console.warn(`Source draft generation failed on ${modelName}; retrying with ${nextModelName}.`, error);
      },
    });

    const now = Date.now();
    const draftsCollection = adminDb.collection("users").doc(uid).collection("generatedContentDrafts");
    const drafts =
      kind === "flashcard"
        ? parseGeneratedCardDrafts(generated).slice(0, MAX_FLASHCARD_DRAFTS).map((draft) => ({
            kind: "flashcard" as const,
            title: draft.front.slice(0, 120) || "Source flashcard draft",
            front: draft.front,
            back: draft.back,
            topicIds: source.topicIds,
            origin: "source-derived" as const,
            contentStatus: "draft" as const,
            sourceType: "source" as const,
            sourceId: source.id,
            createdAt: now,
            updatedAt: now,
          }))
        : parseGeneratedQuestionDrafts(generated).slice(0, MAX_PRACTICE_DRAFTS).map((draft) => ({
            kind: "practice-question" as const,
            title: draft.questionText.slice(0, 120) || "Source practice question draft",
            questionText: draft.questionText,
            answerText: draft.answerText ?? null,
            solutionText: draft.solutionText ?? null,
            topicIds: source.topicIds,
            origin: "source-derived" as const,
            contentStatus: "draft" as const,
            sourceType: "source" as const,
            sourceId: source.id,
            createdAt: now,
            updatedAt: now,
          }));

    const safeDrafts = drafts.length > 0 ? drafts : [];
    const refs = await Promise.all(safeDrafts.map((draft) => draftsCollection.add(draft)));

    return Response.json({
      drafts: safeDrafts.map((draft, index) => ({
        id: refs[index].id,
        ...draft,
      })),
    });
  } catch (error) {
    console.error("Source draft generation error:", error);
    const fallbackText = cleanGeneratedStudyText(String(error));
    return Response.json(
      { error: fallbackText || "Could not generate source drafts just now." },
      { status: 500 }
    );
  }
}
