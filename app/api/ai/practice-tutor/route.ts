import type { NextRequest } from "next/server";
import { getAdminAuth, getAdminDb } from "@/services/firebase/admin";
import { getBearerToken } from "@/lib/auth/bearer";
import { checkAiBudget, type AiBudgetAction } from "@/lib/ai/budgets";
import { cleanGeneratedStudyText } from "@/lib/ai/card-autocomplete";
import { generateGeminiText } from "@/lib/ai/gemini";
import { hasDemoClaim } from "@/lib/demo/token";

export const runtime = "nodejs";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim() ?? "";
const REQUEST_TIMEOUT_MS = 15_000;

type PracticeTutorIntent =
  | "hint"
  | "check-working"
  | "explain-concept"
  | "show-method"
  | "full-solution"
  | "make-flashcard"
  | "similar-question";

function isPracticeTutorIntent(value: unknown): value is PracticeTutorIntent {
  return (
    value === "hint" ||
    value === "check-working" ||
    value === "explain-concept" ||
    value === "show-method" ||
    value === "full-solution" ||
    value === "make-flashcard" ||
    value === "similar-question"
  );
}

function getBudgetAction(intent: PracticeTutorIntent): AiBudgetAction {
  if (intent === "full-solution") return "practiceFullSolution";
  if (intent === "make-flashcard") return "flashcardDraft";
  if (intent === "similar-question") return "similarQuestion";
  return "practiceHint";
}

function getIntentInstruction(intent: PracticeTutorIntent) {
  if (intent === "hint") {
    return "Give one hint only. Do not reveal the answer. End by asking the student to try the next step.";
  }
  if (intent === "check-working") {
    return "Check the student's working. Identify the first incorrect or missing step, then ask them to repair that step. Do not complete the whole solution unless the working is already essentially complete.";
  }
  if (intent === "explain-concept") {
    return "Explain the underlying concept in plain language, then connect it back to this exact question. Avoid dumping the final answer.";
  }
  if (intent === "show-method") {
    return "Show the method or setup, but leave a meaningful step for the student to complete.";
  }
  if (intent === "make-flashcard") {
    return "Suggest one compact flashcard that targets the likely misconception. Include the card front and back after the explanation.";
  }
  if (intent === "similar-question") {
    return "Give one similar practice question, with no solution unless the user asks later.";
  }
  return "The student explicitly requested the full solution. Give a concise worked solution, then end with one follow-up check question.";
}

function getFallbackReply(intent: PracticeTutorIntent) {
  if (intent === "full-solution") {
    return "Tutor is taking longer than usual. For now, write the givens, name the method, and solve one line at a time. Then compare your final step against the mark scheme or stored answer.";
  }

  return "Tutor is taking longer than usual. Try this: name the topic, write the first rule or theorem that applies, then attempt only the next line before asking for another hint.";
}

function extractSuggestedFlashcard(text: string) {
  const frontMatch = text.match(/(?:front|question)\s*:\s*(.+)/i);
  const backMatch = text.match(/(?:back|answer)\s*:\s*(.+)/i);

  if (!frontMatch?.[1] || !backMatch?.[1]) {
    return null;
  }

  return {
    front: frontMatch[1].trim().slice(0, 400),
    back: backMatch[1].trim().slice(0, 2_000),
  };
}

export async function POST(request: NextRequest) {
  if (!GEMINI_API_KEY) {
    return Response.json({ error: "AI features are not configured" }, { status: 503 });
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

  let intent: PracticeTutorIntent;
  let message: string;
  let context: {
    questionId: string;
    questionText: string;
    answerText?: string;
    solutionText?: string;
    topicNames: string[];
    userAnswer?: string;
    workingText?: string;
  };
  let threadId: string | undefined;

  try {
    const body = await request.json();
    intent = isPracticeTutorIntent(body.intent) ? body.intent : "hint";
    message = typeof body.message === "string" ? body.message.slice(0, 1_000) : "";
    const rawContext = body.context && typeof body.context === "object" ? body.context : {};
    context = {
      questionId:
        typeof rawContext.questionId === "string" && rawContext.questionId.trim()
          ? rawContext.questionId.slice(0, 160)
          : "",
      questionText:
        typeof rawContext.questionText === "string" ? rawContext.questionText.slice(0, 4_000) : "",
      answerText:
        typeof rawContext.answerText === "string" && rawContext.answerText.trim()
          ? rawContext.answerText.slice(0, 2_000)
          : undefined,
      solutionText:
        typeof rawContext.solutionText === "string" && rawContext.solutionText.trim()
          ? rawContext.solutionText.slice(0, 4_000)
          : undefined,
      topicNames: Array.isArray(rawContext.topicNames)
        ? rawContext.topicNames
            .filter((topic: unknown): topic is string => typeof topic === "string" && topic.trim().length > 0)
            .slice(0, 8)
        : [],
      userAnswer:
        typeof rawContext.userAnswer === "string" && rawContext.userAnswer.trim()
          ? rawContext.userAnswer.slice(0, 3_000)
          : undefined,
      workingText:
        typeof rawContext.workingText === "string" && rawContext.workingText.trim()
          ? rawContext.workingText.slice(0, 3_000)
          : undefined,
    };
    threadId = typeof body.threadId === "string" && body.threadId.trim() ? body.threadId.slice(0, 160) : undefined;

    if (!message || !context.questionText) {
      return Response.json({ error: "message and question context are required" }, { status: 400 });
    }
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const budgetAllowed = await checkAiBudget({
    uid,
    action: getBudgetAction(intent),
  });
  if (!budgetAllowed) {
    return Response.json({ error: "AI budget reached for today." }, { status: 429 });
  }

  try {
    const systemPrompt = `You are Jami's contextual practice tutor.
You are attached to one practice question, not a generic chatbot.
Default to scaffolding and anti-overhelp:
- encourage the student to attempt the next step before revealing more;
- do not claim mastery just because you explained something;
- do not reveal a full worked answer unless the intent is full-solution;
- be concise, kind, and specific.

Intent:
${getIntentInstruction(intent)}

Question:
${context.questionText}

Known answer:
${context.answerText ?? "Not supplied"}

Stored solution:
${context.solutionText ?? "Not supplied"}

Topics:
${context.topicNames.length ? context.topicNames.join(", ") : "Unspecified"}

Student answer:
${context.userAnswer ?? "Not supplied"}

Student working:
${context.workingText ?? "Not supplied"}`;

    const text = await generateGeminiText({
      apiKey: GEMINI_API_KEY,
      timeoutMs: REQUEST_TIMEOUT_MS,
      request: {
        systemInstruction: systemPrompt,
        contents: [{ role: "user", parts: [{ text: message }] }],
      },
      onRetry: ({ error, modelName, nextModelName }) => {
        console.warn(
          `Practice tutor failed on ${modelName}; retrying with ${nextModelName}.`,
          error
        );
      },
    });
    const reply = cleanGeneratedStudyText(text) || getFallbackReply(intent);
    const adminDb = getAdminDb();
    const now = Date.now();

    let nextThreadId = threadId;
    if (!nextThreadId) {
      const threadRef = await adminDb.collection("users").doc(uid).collection("tutorThreads").add({
        contextType: "question",
        contextId: context.questionId,
        title: context.questionText.slice(0, 120),
        createdAt: now,
        updatedAt: now,
      });
      nextThreadId = threadRef.id;
    } else {
      await adminDb.collection("users").doc(uid).collection("tutorThreads").doc(nextThreadId).set(
        {
          contextType: "question",
          contextId: context.questionId,
          updatedAt: now,
        },
        { merge: true }
      );
    }

    const messages = adminDb
      .collection("users")
      .doc(uid)
      .collection("tutorMessages");
    await Promise.all([
      messages.add({
        threadId: nextThreadId,
        role: "user",
        intent,
        text: message,
        createdAt: now,
      }),
      messages.add({
        threadId: nextThreadId,
        role: "model",
        intent,
        text: reply,
        createdAt: now + 1,
      }),
    ]);

    return Response.json({
      reply,
      threadId: nextThreadId,
      suggestedFlashcard: intent === "make-flashcard" ? extractSuggestedFlashcard(reply) : null,
    });
  } catch (error) {
    console.error("Practice tutor error:", error);
    return Response.json({
      reply: getFallbackReply(intent),
      fallback: true,
    });
  }
}
