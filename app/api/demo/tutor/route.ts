import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import type { AiBudgetAction } from "@/lib/ai/budgets";
import {
  getWalkthroughQuestion,
  getWalkthroughTopicNames,
  type WalkthroughTutorIntent,
} from "@/lib/demo/public-walkthrough";
import {
  formatTutorContextPacketForPrompt,
  normalizeTutorContextPacket,
  type TutorContextPacket,
} from "@/lib/practice/tutor-context";

export const runtime = "nodejs";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim() ?? "";
const REQUEST_TIMEOUT_MS = 12_000;

function isWalkthroughTutorIntent(value: unknown): value is WalkthroughTutorIntent {
  return (
    value === "hint" ||
    value === "check-working" ||
    value === "explain-concept" ||
    value === "show-method" ||
    value === "full-solution" ||
    value === "make-flashcard" ||
    value === "similar-question" ||
    value === "stuck-here"
  );
}

function getBudgetAction(intent: WalkthroughTutorIntent): AiBudgetAction {
  if (intent === "full-solution") return "practiceFullSolution";
  if (intent === "make-flashcard") return "flashcardDraft";
  if (intent === "similar-question") return "similarQuestion";
  return "practiceHint";
}

function getVisitorBudgetKey(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const realIp = request.headers.get("x-real-ip")?.trim() ?? "";
  const userAgent = request.headers.get("user-agent")?.trim() ?? "";
  const raw = `${forwardedFor || realIp || "unknown"}:${userAgent || "unknown"}`;
  return `public-demo:${createHash("sha256").update(raw).digest("hex").slice(0, 32)}`;
}

function getIntentInstruction(intent: WalkthroughTutorIntent) {
  if (intent === "hint") {
    return "Give one hint only. Do not reveal the answer. End by asking the student to try the next step.";
  }
  if (intent === "stuck-here") {
    return "The student is stuck at the current step. Use the current working and selected text if supplied. Give the next useful step only.";
  }
  if (intent === "check-working") {
    return "Check the student's working. Identify the first incorrect or missing step, then ask them to repair that step. Do not complete the whole solution.";
  }
  if (intent === "explain-concept") {
    return "Explain the underlying concept in plain language, then connect it back to this exact question. Avoid dumping the final answer.";
  }
  if (intent === "show-method") {
    return "Show the setup or method, but leave a meaningful step for the student to complete.";
  }
  if (intent === "make-flashcard") {
    return "Suggest one compact flashcard that targets the likely misconception. Include exactly one 'Front:' line and one 'Back:' line.";
  }
  if (intent === "similar-question") {
    return "Give one similar practice question, with no solution.";
  }
  return "The student explicitly requested the full solution. Give a concise worked solution, then end with one follow-up check question.";
}

function getFallbackReply(intent: WalkthroughTutorIntent) {
  if (intent === "check-working") {
    return "I can see your current working. The first issue is that 'gets too hot' needs the biological reason. Say that high temperature denatures the enzyme, changing the active site so the substrate no longer fits well.";
  }
  if (intent === "stuck-here") {
    return "Next useful step: name the process. Above the optimum temperature, the enzyme denatures. Now connect that to the active site changing shape.";
  }
  if (intent === "full-solution") {
    return "Step-by-step walkthrough:\n1. As temperature rises toward 37 C, particles have more kinetic energy, so enzyme-substrate collisions happen more often.\n2. 37 C is around the enzyme's optimum, so activity is highest there.\n3. Above about 45 C, heat breaks bonds that hold the enzyme in shape.\n4. The active site changes shape, so the substrate no longer fits well.\n5. Fewer enzyme-substrate complexes form, so the reaction rate falls sharply.";
  }
  if (intent === "make-flashcard") {
    return "Front: What happens when an enzyme is denatured?\nBack: Its active site changes shape, so the substrate no longer fits properly and the reaction rate falls.";
  }
  if (intent === "similar-question") {
    return "Similar question: A student tests an enzyme at different pH values and finds the rate drops sharply away from pH 7. Explain why the enzyme works best near its optimum pH.";
  }
  if (intent === "show-method") {
    return "Method: describe the rise first, then the fall. Use collision frequency for the rise toward the optimum, and denaturing plus active-site shape for the sharp fall after the optimum.";
  }
  if (intent === "explain-concept") {
    return "Concept: enzymes have active sites with specific shapes. High temperature can denature the enzyme, which changes that shape. If the substrate no longer fits, the reaction slows down.";
  }
  return "Try this hint: first name the concept being tested, then write the one condition that decides the question. After that, attempt only the next line before asking for more help.";
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

function getFallbackFlashcard(reply: string) {
  return (
    extractSuggestedFlashcard(reply) ?? {
      front: "Why does enzyme activity fall at high temperature?",
      back: "High temperature denatures the enzyme, changing the active site so the substrate no longer fits well.",
    }
  );
}

export async function POST(request: NextRequest) {
  let intent: WalkthroughTutorIntent = "hint";
  let message = "";
  let questionId = "";
  let userAnswer: string | undefined;
  let workingText: string | undefined;
  let contextPacket: TutorContextPacket | null = null;
  let forceFallback = request.nextUrl.searchParams.get("forceTutorFallback") === "1";

  try {
    const body = await request.json();
    intent = isWalkthroughTutorIntent(body.intent) ? body.intent : "hint";
    forceFallback = forceFallback || body.forceFallback === true;
    message = typeof body.message === "string" ? body.message.slice(0, 1_000) : "";
    contextPacket = normalizeTutorContextPacket(body.contextPacket, intent);
    const rawContext = body.context && typeof body.context === "object" ? body.context : {};
    questionId =
      contextPacket?.question.id ||
      (typeof rawContext.questionId === "string" ? rawContext.questionId.slice(0, 160) : "");
    userAnswer =
      typeof rawContext.userAnswer === "string" && rawContext.userAnswer.trim()
        ? rawContext.userAnswer.slice(0, 2_000)
        : undefined;
    workingText =
      typeof rawContext.workingText === "string" && rawContext.workingText.trim()
        ? rawContext.workingText.slice(0, 2_000)
        : undefined;
  } catch {
    return Response.json({
      reply: getFallbackReply("hint"),
      fallback: true,
      error: "Invalid request body.",
    });
  }

  const question = getWalkthroughQuestion(questionId);
  if (!message || !question) {
    return Response.json({
      reply: getFallbackReply("hint"),
      fallback: true,
      error: "Walkthrough question context is required.",
    });
  }

  if (forceFallback) {
    const reply = getFallbackReply(intent);
    return Response.json({
      reply,
      fallback: true,
      forcedFallback: true,
      suggestedFlashcard: intent === "make-flashcard" ? getFallbackFlashcard(reply) : null,
    });
  }

  const budgetKey = getVisitorBudgetKey(request);
  try {
    const { checkAiBudget } = await import("@/lib/ai/budgets");
    const budgetAllowed = await checkAiBudget({
      uid: budgetKey,
      action: getBudgetAction(intent),
      demo: true,
    });
    if (!budgetAllowed) {
      const reply = getFallbackReply(intent);
      return Response.json({
        reply,
        fallback: true,
        budgetExhausted: true,
        suggestedFlashcard: intent === "make-flashcard" ? getFallbackFlashcard(reply) : null,
      });
    }
  } catch (error) {
    console.error("Public demo tutor budget check failed:", error);
    const reply =
      "The public tutor budget check is unavailable, so Jami is using a safe walkthrough hint instead: name the key concept, connect it to the evidence in the question, and try the next sentence before asking for more.";
    return Response.json({
      reply,
      fallback: true,
      suggestedFlashcard: intent === "make-flashcard" ? getFallbackFlashcard(reply) : null,
    });
  }

  if (!GEMINI_API_KEY) {
    const reply = getFallbackReply(intent);
    return Response.json({
      reply,
      fallback: true,
      suggestedFlashcard: intent === "make-flashcard" ? getFallbackFlashcard(reply) : null,
    });
  }

  try {
    const [{ cleanGeneratedStudyText }, { generateGeminiText }] = await Promise.all([
      import("@/lib/ai/card-autocomplete"),
      import("@/lib/ai/gemini"),
    ]);
    const contextText =
      contextPacket ?
        formatTutorContextPacketForPrompt(contextPacket) :
        `Question:
${question.questionText}

Known answer:
${question.answerText}

Stored solution:
${question.solutionText}

Topics:
${getWalkthroughTopicNames(question.topicIds).join(", ")}

Student answer:
${userAnswer ?? "Not supplied"}

Student working:
${workingText ?? "Not supplied"}`;
    const systemPrompt = `You are Jami's public walkthrough tutor.
This is a no-login demo attached to a seeded practice question.
Do not ask for account data. Do not claim any persistent progress was saved.
Default to scaffolding and anti-overhelp:
- encourage the student to attempt the next step before revealing more;
- do not claim mastery just because you explained something;
- do not reveal a full worked answer unless the intent is full-solution;
- if scratchpad context is supplied without an attached image, use the student's note and typed working; do not claim you can see handwriting;
- be concise, kind, and specific.

Intent:
${getIntentInstruction(intent)}

Workspace context:
${contextText}`;

    const text = await generateGeminiText({
      apiKey: GEMINI_API_KEY,
      timeoutMs: REQUEST_TIMEOUT_MS,
      request: {
        systemInstruction: systemPrompt,
        contents: [{ role: "user", parts: [{ text: message }] }],
      },
      onRetry: ({ error, modelName, nextModelName }) => {
        console.warn(
          `Public demo tutor failed on ${modelName}; retrying with ${nextModelName}.`,
          error
        );
      },
    });

    const reply = cleanGeneratedStudyText(text) || getFallbackReply(intent);
    return Response.json({
      reply,
      suggestedFlashcard: intent === "make-flashcard" ? getFallbackFlashcard(reply) : null,
    });
  } catch (error) {
    console.error("Public demo tutor error:", error);
    const reply = getFallbackReply(intent);
    return Response.json({
      reply,
      fallback: true,
      suggestedFlashcard: intent === "make-flashcard" ? getFallbackFlashcard(reply) : null,
    });
  }
}
