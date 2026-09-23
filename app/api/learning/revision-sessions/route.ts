import type { NextRequest } from "next/server";
import { missionCopy } from "@/lib/learning/interventions/explain";
import { createLogger } from "@/lib/observability/logger";
import { apiFailure, authenticateWriteRequest } from "@/services/auth/authenticate-request.server";
import { loadStudyActions } from "@/services/learning/study-actions.server";
import {
  loadRevisionOptions,
  resolveRevisionStart,
} from "@/services/learning/revision-options.server";
import {
  revisionSessionResponse,
  revisionSessionsUnavailable,
} from "@/services/learning/revision-session-context.server";
import { startRevisionSession } from "@/services/learning/revision-sessions.server";

export const runtime = "nodejs";
export const maxDuration = 30;

const log = createLogger({ route: "learning.revision-sessions.start" });

/**
 * Start (or resume) a Revision Session: on one of the student's own
 * recommendations, or on a concept they chose in one of their folders.
 *
 * The request names a recommendation, or a folder and a concept key, and
 * nothing else. What to teach, what it is called and why is re-derived here
 * from the student's own folder and recorded work: a concept that is not one
 * of that folder's is refused rather than taught.
 */
export async function POST(request: NextRequest) {
  const unavailable = revisionSessionsUnavailable();
  if (unavailable) return unavailable;

  const uid = await authenticateWriteRequest(request);
  if (!uid) return apiFailure("Unauthorized", 401, "unauthorized");

  let actionId = "";
  let folderId = "";
  let topicKey = "";
  try {
    const body = (await request.json()) as Record<string, unknown>;
    actionId = typeof body.actionId === "string" ? body.actionId.trim().slice(0, 400) : "";
    folderId = typeof body.folderId === "string" ? body.folderId.trim().slice(0, 200) : "";
    topicKey = typeof body.topicKey === "string" ? body.topicKey.trim().slice(0, 400) : "";
  } catch {
    return apiFailure("That request could not be read.", 400, "bad_request");
  }
  if (!actionId && !(folderId && topicKey)) {
    return apiFailure("What should this session be about?", 400, "bad_request");
  }

  if (!actionId) {
    try {
      const loaded = await loadRevisionOptions(uid, folderId);
      const start = loaded ? resolveRevisionStart(loaded, topicKey) : null;
      if (!start) {
        return apiFailure("That isn't one of this folder's topics.", 409, "unknown_concept");
      }
      const record = await startRevisionSession({ uid, ...start });
      log.info("session.started", { sessionId: record.id, status: record.status, chosen: true });
      return revisionSessionResponse(record, {}, 201);
    } catch (error) {
      log.warn("session.start_failed", { error });
      return apiFailure("Jami couldn't start this session just now.", 503, "start_failed");
    }
  }

  try {
    const { actions } = await loadStudyActions({ uid });
    const action = actions.find((candidate) => candidate.id === actionId);
    if (!action || action.target.kind !== "topic" || action.intervention?.type !== "teach") {
      return apiFailure(
        "This isn't something Jami is recommending to teach right now.",
        409,
        "not_a_teach_recommendation"
      );
    }

    const copy = missionCopy({
      conceptLabel: action.target.label,
      choice: action.intervention,
      evidence: action.evidence,
    });
    const record = await startRevisionSession({
      uid,
      actionId: action.id,
      why: copy.explanation.filter(Boolean),
      target: {
        topicKey: action.target.topicKey,
        source: action.target.source,
        conceptLabel: action.target.label,
        ...(action.scope.folderId ? { folderId: action.scope.folderId } : {}),
        ...(action.scope.deckId ? { deckId: action.scope.deckId } : {}),
      },
    });
    log.info("session.started", { sessionId: record.id, status: record.status });
    return revisionSessionResponse(record, {}, 201);
  } catch (error) {
    log.warn("session.start_failed", { error });
    return apiFailure("Jami couldn't start this session just now.", 503, "start_failed");
  }
}
