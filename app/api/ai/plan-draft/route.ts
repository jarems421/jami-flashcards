import type { NextRequest } from "next/server";
import { featureFlags } from "@/lib/app/feature-flags";
import { createLogger } from "@/lib/observability/logger";
import { apiFailure, authenticateRequest } from "@/services/auth/authenticate-request.server";
import { buildPlanNotices, type PlanSubjectOption } from "@/lib/ai/assistant-plan";
import {
  draftRevisionPlan,
  MAX_PLAN_MESSAGE_LENGTH,
  MAX_PLAN_TURNS,
  type PlanDraftTurn,
} from "@/services/ai/plan-draft.server";
import { loadStudyActions } from "@/services/learning/study-actions.server";
import { planScopeKey } from "@/lib/planning/types";
import { getActiveStudyFolders } from "@/services/study/folders";
import { servableExamSetTexts } from "@/lib/practice/exam-set-texts";
import type { StudyFolder } from "@/lib/workspace/study-folders";

export const runtime = "nodejs";

const log = createLogger({ route: "ai.plan-draft" });

/** The most subjects offered to the model; more than this is not a revision plan. */
const MAX_SUBJECTS = 8;
/** Enough texts for the model to recognise one the student names, not the whole list. */
const MAX_SET_TEXTS_PER_SUBJECT = 8;

/**
 * What Jami already knows about a subject, from the student's own folder.
 *
 * This is the difference between planning inside Jami and planning on paper. A
 * student who says "I've got an English test on Tuesday" has already told Jami
 * everything it needs: their folder names the course, the course names the
 * specification, and the specification lists the texts. Asking them which board
 * they sit is asking them to repeat themselves.
 *
 * Only checked specification data is used -- `servableExamSetTexts` returns
 * nothing from a list a person has not verified -- so Jami never names a text
 * the student is not actually studying.
 */
function describeFolder(folder: StudyFolder) {
  const course = folder.examCourse;
  const setTexts = course
    ? servableExamSetTexts(course.specificationId)
        .slice(0, MAX_SET_TEXTS_PER_SUBJECT)
        .map((text) => (text.author ? `${text.label} (${text.author})` : text.label))
    : [];

  return {
    ...(course
      ? { course: [course.board, course.qualification, course.specificationTitle].filter(Boolean).join(" ") }
      : {}),
    ...(folder.studyLevel ? { level: String(folder.studyLevel) } : {}),
    ...(setTexts.length > 0 ? { setTexts } : {}),
  };
}

function readTurns(value: unknown): PlanDraftTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((raw) => {
      if (typeof raw !== "object" || raw === null) return [];
      const turn = raw as Record<string, unknown>;
      const text = typeof turn.text === "string" ? turn.text.trim() : "";
      if (!text) return [];
      return [
        {
          role: turn.role === "jami" ? ("jami" as const) : ("student" as const),
          text: text.slice(0, MAX_PLAN_MESSAGE_LENGTH),
        },
      ];
    })
    .slice(-MAX_PLAN_TURNS);
}

/**
 * Jami's side of a planning conversation.
 *
 * The subjects the model may choose between, and the notices it may reason
 * from, are both assembled here from the student's own recorded work -- never
 * taken from the request. A client that asked for a plan over somebody else's
 * folder, or supplied its own flattering list of "weaknesses", gets the
 * student's real ones regardless.
 */
export async function POST(request: NextRequest) {
  if (!featureFlags.enableRevisionPlans || !featureFlags.enableLearnerProfile) {
    return apiFailure("Not found", 404, "not_found");
  }
  const uid = await authenticateRequest(request);
  if (!uid) return apiFailure("Unauthorized", 401, "unauthorized");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiFailure("That request could not be read.", 400, "bad_request");
  }
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const message = typeof record.message === "string" ? record.message.trim() : "";
  if (!message) return apiFailure("Say what you need and Jami will suggest a shape.", 400, "bad_request");

  const startedAt = Date.now();
  try {
    /*
     * Two reads, and they answer different questions.
     *
     * The engine says what it has noticed and in which folders; the folders
     * themselves say what each subject actually is -- the course, the level,
     * the set texts. A plan needs both, and a folder the engine has nothing to
     * say about is still a subject somebody may want to revise.
     */
    const [{ actions, folders }, studyFolders] = await Promise.all([
      loadStudyActions({ uid }),
      getActiveStudyFolders(uid).catch(() => [] as StudyFolder[]),
    ]);

    const subjectNames = new Map(folders.map((folder) => [`folder:${folder.id}`, folder.name]));
    const detailById = new Map(studyFolders.map((folder) => [folder.id, describeFolder(folder)]));
    for (const folder of studyFolders) subjectNames.set(`folder:${folder.id}`, folder.name);
    const inScope = new Map<string, PlanSubjectOption>();
    for (const action of actions) {
      const scopeKey = planScopeKey(action.scope);
      if (inScope.has(scopeKey) || inScope.size >= MAX_SUBJECTS) continue;
      const label = subjectNames.get(scopeKey);
      if (!label) continue;
      inScope.set(scopeKey, {
        ref: `S${inScope.size + 1}`,
        label,
        ...(action.scope.folderId ? { folderId: action.scope.folderId } : {}),
        ...(action.scope.deckId ? { deckId: action.scope.deckId } : {}),
        ...(action.scope.folderId ? detailById.get(action.scope.folderId) ?? {} : {}),
      });
    }
    // A folder the engine had nothing to say about is still a subject somebody
    // may want to revise -- it is simply one Jami cannot comment on.
    for (const folder of [...studyFolders, ...folders]) {
      const scopeKey = `folder:${folder.id}`;
      if (inScope.has(scopeKey) || inScope.size >= MAX_SUBJECTS) continue;
      inScope.set(scopeKey, {
        ref: `S${inScope.size + 1}`,
        label: folder.name,
        folderId: folder.id,
        ...(detailById.get(folder.id) ?? {}),
      });
    }

    const subjects = [...inScope.values()];
    const notices = buildPlanNotices(actions, subjectNames);

    const result = await draftRevisionPlan({
      message: message.slice(0, MAX_PLAN_MESSAGE_LENGTH),
      history: readTurns(record.history),
      subjects,
      notices,
    });

    log.info("plan_draft.answered", {
      latencyMs: Date.now() - startedAt,
      subjects: subjects.length,
      notices: notices.length,
      proposed: Boolean(result.plan),
    });

    return Response.json({
      reply: result.reply,
      plan: result.plan?.draft ?? null,
      notices,
      subjects: subjects.map((subject) => ({ ref: subject.ref, label: subject.label })),
    });
  } catch (error) {
    log.warn("plan_draft.failed", { latencyMs: Date.now() - startedAt, error });
    return apiFailure(
      "Jami could not suggest a plan just now. You can still build one yourself.",
      503,
      "plan_draft_unavailable"
    );
  }
}
