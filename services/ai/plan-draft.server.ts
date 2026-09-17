import "server-only";

import { generateAiText } from "@/lib/ai/provider-router";
import { repairModelJsonBackslashes, unwrapModelJsonObject } from "@/lib/ai/model-json";
import {
  parseAssistantPlanSpec,
  type ParsedAssistantPlan,
  type PlanNotice,
  type PlanSubjectOption,
} from "@/lib/ai/assistant-plan";
import { PLAN_WEEKDAY_LABELS, PLAN_WEEKDAYS } from "@/lib/planning/types";
import { getStudyDayKey } from "@/lib/study/day";
import { createLogger } from "@/lib/observability/logger";

const log = createLogger({ service: "ai.plan-draft" });

/** A planning turn is short. Past this the model is not thinking, it is stuck. */
const PLAN_DRAFT_TIMEOUT_MS = 20_000;
export const MAX_PLAN_MESSAGE_LENGTH = 600;
export const MAX_PLAN_TURNS = 8;

export type PlanDraftTurn = { role: "student" | "jami"; text: string };

export type PlanDraftInput = {
  message: string;
  history: readonly PlanDraftTurn[];
  subjects: readonly PlanSubjectOption[];
  notices: readonly PlanNotice[];
  today?: string;
};

export type PlanDraftResult = {
  reply: string;
  plan: ParsedAssistantPlan | null;
};

/**
 * Jami suggesting a shape for the student's week.
 *
 * The prompt is written around one idea: the student is the one who knows their
 * life. Jami has counted their answers and can say what looks shaky; it has no
 * idea that Thursdays are useless, that the Chemistry paper is first, or that
 * they are already behind on coursework. So it proposes and explains, asks at
 * most one thing at a time, and never insists.
 *
 * It is also structurally prevented from choosing content, and that guarantee
 * does not live in this prompt. `parseAssistantPlanSpec` reads only subjects,
 * weights, weekdays, minutes and dates; there is no field for a topic, a task
 * or a paper, so a model that ignored every word written here still could not
 * produce a plan that said what to revise. That comes from the Learning Engine,
 * freshly, every time the plan is read.
 */
function buildPlanSystemInstruction(input: {
  subjects: readonly PlanSubjectOption[];
  notices: readonly PlanNotice[];
  today: string;
}) {
  const subjectList = input.subjects.map(describeSubject).join("\n");
  const noticeList =
    input.notices.length > 0
      ? input.notices
          .map((notice) => `- ${JSON.stringify(notice.subject)}: ${JSON.stringify(notice.detail)}`)
          .join("\n")
      : "- Nothing recorded yet. Do not imply you know how they are doing.";
  const weekdayList = PLAN_WEEKDAYS.map(
    (weekday) => `${weekday}=${PLAN_WEEKDAY_LABELS[weekday]}`
  ).join(", ");

  return `You are Jami, a calm study tutor helping a student shape a revision timetable.

Today is ${input.today}. Weekday numbers: ${weekdayList}.

THEIR SUBJECTS (refer to these only by their reference):
${subjectList || "- none"}
This is what Jami already knows about each one, from the folders the student set up. Use it: if they mention a subject by name, you already know which folder it is, which specification it follows and what they are studying on it, so do not ask them again. Mentioning something specific they study is good when it is on this list; never invent one.

WHAT JAMI HAS NOTICED, counted from their own recorded answers:
${noticeList}
These lines are measurements, not guesses. You may refer to them in your reply and lean on them when weighting subjects. Never invent one, never soften or exaggerate one, and never claim to know something about the student that is not on this list.

WHAT YOU DECIDE, AND WHAT YOU DO NOT
You set the shape of their week: which of their subjects, how heavily, which days, how long a session, and the dates it runs between. That is all.
You never decide what they study inside a session. Jami works that out from their recorded answers each day, and it changes as they go. Do not name topics to revise, do not write a syllabus, and do not promise what a particular day will contain. If they ask what will be in a session, say honestly that it is chosen from their recent work on the day, so it stays current.

HOW TO TALK
The student knows things you do not: their timetable, which exam is first, what else is due, how much they can really face. Ask rather than assume, and ask about one thing at a time — never a list of questions.
Suggest, do not instruct. "Three evenings might be enough, given how the mocks are spread — does that fit?" rather than "You will study on Monday, Wednesday and Friday."
If they have told you enough to be useful, draft something and say what you assumed, so they can correct it. A draft they can change beats a question they have to answer.
If they tell you something that contradicts what you noticed — that a subject feels fine, that they have no time on a day — take their word for it. They are there and you are not.
Never suggest more studying than they said they can do. If what they want is not possible in the time, say so plainly once and offer the honest version; do not quietly overfill the week.
Keep replies short: two or three sentences, no headings, no bullet lists, no emoji.

THE PLAN FIELD
Fill "plan" only when you have enough to propose a real shape and the student has not asked you to wait. Leave it null while you are still asking.
A plan is: {"title":"Chemistry mock","subjects":[{"ref":"S1","weight":2,"start":"diagnose"}],"days":[1,3,5],"minutes":45,"start":"${input.today}","end":"2026-11-14"}
weight is 1, 2 or 3 and is relative. start is "diagnose" when it is worth finding out where they stand first, or "practice" when there is already evidence and they should keep working. minutes is one session length for the whole week. Use their own words for the title where you can.
When you send a plan, your reply should say in one line what you have assumed and invite them to change it. They will see the plan and can edit every part of it before anything is saved.

Return exactly this JSON and nothing else:
{"reply":"two or three sentences to the student","plan":"the plan object as a JSON string, or an empty string"}`;
}

/**
 * One subject, with everything the folder already carries about it.
 *
 * The point of planning inside Jami rather than on paper is that it does not
 * start from nothing. A student who says "I've got an English test" should not
 * then be asked which board, which texts, or what they are studying -- their
 * folder says AQA, and the specification says Macbeth. Asking anyway is the
 * thing that makes an assistant feel like a form.
 */
function describeSubject(subject: PlanSubjectOption) {
  const facts = [
    subject.course ? `course ${JSON.stringify(subject.course)}` : "",
    subject.level ? `level ${JSON.stringify(subject.level)}` : "",
    subject.setTexts && subject.setTexts.length > 0
      ? `studying ${subject.setTexts.map((text) => JSON.stringify(text)).join(", ")}`
      : "",
  ].filter(Boolean);
  return `${subject.ref}: ${JSON.stringify(subject.label)}${
    facts.length > 0 ? ` (${facts.join("; ")})` : ""
  }`;
}

/**
 * The envelope, read tolerantly.
 *
 * Described in the prompt rather than declared as a provider schema: the SDK's
 * schema types belong to `lib/ai/gemini.ts` alone, and a two-field envelope is
 * small enough that the prompt carries it as well as a schema would. What keeps
 * this safe is not the declaration but `parseAssistantPlanSpec`, which trusts
 * none of it either way.
 */
function readModelAnswer(text: string) {
  /*
   * The same salvage the rest of Jami does, and it is not optional.
   *
   * A bare JSON.parse was rejecting every reply that arrived inside a code
   * fence or behind a sentence, and the caller answered with its own fallback
   * line -- so the student typed something useful and got "tell me a bit about
   * what you're working towards", twice, as though nothing had been said.
   */
  for (const candidate of [unwrapModelJsonObject(text), text.trim()]) {
    try {
      const parsed: unknown = JSON.parse(repairModelJsonBackslashes(candidate));
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;
      const record = parsed as Record<string, unknown>;
      const reply = typeof record.reply === "string" ? record.reply.trim() : "";
      if (!reply) continue;
      return {
        reply,
        plan: typeof record.plan === "string" ? record.plan.trim() : "",
      };
    } catch {
      // Try the next reading.
    }
  }
  return null;
}

export async function draftRevisionPlan(input: PlanDraftInput): Promise<PlanDraftResult> {
  const today = input.today ?? getStudyDayKey();
  const startedAt = Date.now();

  const contents = [
    ...input.history.slice(-MAX_PLAN_TURNS).map((turn) => ({
      role: turn.role === "student" ? ("user" as const) : ("model" as const),
      parts: [{ text: turn.text.slice(0, MAX_PLAN_MESSAGE_LENGTH) }],
    })),
    {
      role: "user" as const,
      parts: [{ text: input.message.slice(0, MAX_PLAN_MESSAGE_LENGTH) }],
    },
  ];

  const text = await generateAiText({
    role: "worker",
    routeReason: "routine",
    timeoutMs: PLAN_DRAFT_TIMEOUT_MS,
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 700,
      responseMimeType: "application/json",
    },
    request: {
      systemInstruction: buildPlanSystemInstruction({
        subjects: input.subjects,
        notices: input.notices,
        today,
      }),
      contents,
    },
  });

  const answer = readModelAnswer(text);
  /*
   * Nothing readable is a failure, and is reported as one.
   *
   * Answering with a canned prompt instead hides a broken call behind something
   * that looks like a reply, which is how this went unnoticed in the first
   * place: the student cannot tell "Jami is stuck" from "Jami wants more".
   */
  if (!answer) {
    log.warn("plan_draft.unreadable", { latencyMs: Date.now() - startedAt });
    throw new Error("The planning reply could not be read.");
  }
  const plan = answer.plan ? parseAssistantPlanSpec(answer.plan, input.subjects) : null;

  log.info("plan_draft.completed", {
    latencyMs: Date.now() - startedAt,
    subjects: input.subjects.length,
    notices: input.notices.length,
    proposed: Boolean(plan),
    // Content-free: how many refs the model invented is worth watching without
    // recording which, or anything the student wrote.
    unknownSubjects: plan?.unknownSubjects.length ?? 0,
  });

  return { reply: answer.reply, plan };
}
