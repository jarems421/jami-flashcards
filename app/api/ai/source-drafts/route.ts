import type { NextRequest } from "next/server";
import { getAdminAuth, getAdminDb } from "@/services/firebase/admin";
import { getBearerToken } from "@/lib/auth/bearer";
import { checkAiBudget } from "@/lib/ai/budgets";
import { parseGeneratedCardDrafts } from "@/lib/ai/card-generation";
import { cleanGeneratedStudyText } from "@/lib/ai/card-autocomplete";
import { generateGeminiText } from "@/lib/ai/gemini";
import { parseGeneratedQuestionDrafts } from "@/lib/ai/question-generation";
import {
  clampSourceDraftCount,
  filterSourceFlashcardDrafts,
  filterSourceQuestionDrafts,
  type SourceDraftKind,
} from "@/lib/ai/source-draft-quality";
import { hasDemoClaim } from "@/lib/demo/token";
import { mapSourceData } from "@/lib/practice/sources";

export const runtime = "nodejs";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim() ?? "";
const REQUEST_TIMEOUT_MS = 20_000;

function isSourceDraftKind(value: unknown): value is SourceDraftKind {
  return value === "flashcard" || value === "practice-question";
}

function getPrompt(kind: SourceDraftKind, count: number) {
  if (kind === "flashcard") {
    return `Create up to ${count} concise flashcard drafts from the source.
Return JSON only as an array of objects with "front" and "back".
Each card should test one concept or distinction.
Every card must be directly answerable from the source text.
Do not make vague cards such as "summarise this source".
If the source does not support ${count} useful cards, return fewer.
Do not invent facts that are not grounded in the source.`;
  }

  return `Create up to ${count} practice question drafts from the source.
Return JSON only as an array of objects with "questionText", "answerText", and "solutionText".
Questions should be short, useful for revision, and answerable from the source.
Every question must include an expected answer.
If the source does not support ${count} useful questions, return fewer.
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
    count = clampSourceDraftCount(kind, body.count);
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
      {
        error:
          "This source is saved as a reference only. Paste the relevant text before using Tutor or generating drafts.",
      },
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
Use only the supplied source. Discard uncertain or weak items instead of padding the list.
Return valid JSON only.`,
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
    const parsedCardDrafts = kind === "flashcard" ? parseGeneratedCardDrafts(generated) : [];
    const parsedQuestionDrafts = kind === "practice-question" ? parseGeneratedQuestionDrafts(generated) : [];
    const filteredCardDrafts =
      kind === "flashcard" ? filterSourceFlashcardDrafts(parsedCardDrafts, count) : [];
    const filteredQuestionDrafts =
      kind === "practice-question" ? filterSourceQuestionDrafts(parsedQuestionDrafts, count) : [];
    const removedDraftCount =
      kind === "flashcard"
        ? Math.max(0, parsedCardDrafts.length - filteredCardDrafts.length)
        : Math.max(0, parsedQuestionDrafts.length - filteredQuestionDrafts.length);
    const drafts =
      kind === "flashcard"
        ? filteredCardDrafts.map((draft) => ({
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
        : filteredQuestionDrafts.map((draft) => ({
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

    if (drafts.length === 0) {
      return Response.json(
        {
          error:
            "Jami could not find enough source-grounded draft material. Try a longer pasted source or generate fewer drafts.",
        },
        { status: 422 }
      );
    }

    const safeDrafts = drafts;
    const refs = await Promise.all(safeDrafts.map((draft) => draftsCollection.add(draft)));

    return Response.json({
      drafts: safeDrafts.map((draft, index) => ({
        id: refs[index].id,
        ...draft,
      })),
      removedDraftCount,
      requestedCount: count,
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
