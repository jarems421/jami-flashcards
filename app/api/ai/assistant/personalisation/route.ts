import type { NextRequest } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import {
  assistantAssetError,
  authenticateAssistantAssetRequest,
  authenticateAssistantWriter,
} from "@/services/ai/assistant-assets.server";
import { featureFlags } from "@/lib/app/feature-flags";
import { createLogger } from "@/lib/observability/logger";
import {
  buildTutorPreferencesPayload,
  normalizeTutorPreferences,
  parseTutorNotes,
  serializeFolderTutorNotes,
} from "@/lib/ai/tutor-personalisation";
import { readTutorFolderFacts } from "@/lib/ai/tutor-folder-facts";
import { normalizeStudyLevel } from "@/lib/profile/study-level";
import { normalizeStudySubjects } from "@/lib/profile/study-subjects";
import { getAdminDb } from "@/services/firebase/admin";

export const runtime = "nodejs";

/**
 * Enough folders to choose between without turning the picker into a list. A
 * student with more than this has a filing problem the settings drawer is not
 * the place to solve.
 */
const MAX_FOLDER_SUMMARIES = 60;

const log = createLogger({ route: "ai.assistant.personalisation" });

function settingsRef(uid: string) {
  return getAdminDb()
    .collection("users")
    .doc(uid)
    .collection("tutorPersonalisation")
    .doc("settings");
}

/**
 * The folders a student can write notes for, and how many each has.
 *
 * Deliberately without the notes themselves: sixty folders each carrying up to
 * five thousand characters is a quarter of a megabyte to open a settings
 * drawer, and only one of them is ever being edited. The selected folder's
 * notes are fetched by id instead.
 */
async function loadFolderSummaries(uid: string) {
  const snapshot = await getAdminDb()
    .collection("users")
    .doc(uid)
    .collection("studyFolders")
    .where("archived", "==", false)
    .orderBy("updatedAt", "desc")
    .limit(MAX_FOLDER_SUMMARIES)
    .get();

  return snapshot.docs.map((folderDoc) => {
    const data = folderDoc.data() as Record<string, unknown>;
    const facts = readTutorFolderFacts(folderDoc.id, data);
    return {
      id: folderDoc.id,
      name: facts.name,
      subject: facts.subject,
      studyLevel: facts.studyLevel,
      course: facts.course,
      noteCount: parseTutorNotes(facts.tutorInstructions).length,
      instructionsUpdatedAt:
        typeof data.tutorInstructionsUpdatedAt === "number"
          ? data.tutorInstructionsUpdatedAt
          : 0,
    };
  });
}

export async function GET(request: NextRequest) {
  if (!featureFlags.enableTutorPersonalisation) {
    return assistantAssetError("Not found", 404, "not_found");
  }
  const uid = await authenticateAssistantAssetRequest(request);
  if (!uid) return assistantAssetError("Unauthorized", 401, "unauthorized");

  const requestedFolderId = request.nextUrl.searchParams
    .get("folderId")
    ?.trim()
    .slice(0, 160);

  const userRef = getAdminDb().collection("users").doc(uid);
  const [settingsSnapshot, userSnapshot, folders, folderSnapshot] =
    await Promise.all([
      settingsRef(uid).get(),
      userRef.get(),
      loadFolderSummaries(uid),
      requestedFolderId
        ? userRef.collection("studyFolders").doc(requestedFolderId).get()
        : Promise.resolve(null),
    ]);

  const folderData = folderSnapshot?.exists
    ? (folderSnapshot.data() as Record<string, unknown>)
    : undefined;

  return Response.json({
    preferences: normalizeTutorPreferences(
      settingsSnapshot.exists
        ? (settingsSnapshot.data() as Record<string, unknown>)
        : undefined
    ),
    /*
     * The account default only. The drawer shows the level that will actually
     * apply, which for a single folder is that folder's override -- and it
     * reads that from the folder summary beside this rather than from here, so
     * the two cannot disagree about which one won.
     */
    accountStudyLevel: normalizeStudyLevel(
      userSnapshot.exists ? userSnapshot.data()?.defaultStudyLevel : undefined
    ) ?? null,
    /*
     * The courses behind that level, which only the levels from A level upwards
     * ask for. Sent whatever the level is: a student who drops from University
     * back to GCSE should find their subjects still there if they go back up,
     * rather than having quietly lost them to a screen that stopped rendering
     * the field.
     */
    accountStudySubjects: normalizeStudySubjects(
      userSnapshot.exists ? userSnapshot.data()?.studySubjects : undefined
    ),
    folders,
    folder:
      folderData && requestedFolderId
        ? folderNotesResponse(requestedFolderId, folderData)
        : null,
  });
}

function folderNotesResponse(id: string, data: Record<string, unknown>) {
  const facts = readTutorFolderFacts(id, data);
  return {
    id,
    name: facts.name,
    subject: facts.subject,
    studyLevel: facts.studyLevel,
    course: facts.course,
    notes: parseTutorNotes(facts.tutorInstructions),
    instructionsUpdatedAt:
      typeof data.tutorInstructionsUpdatedAt === "number"
        ? data.tutorInstructionsUpdatedAt
        : 0,
  };
}

export async function PATCH(request: NextRequest) {
  if (!featureFlags.enableTutorPersonalisation) {
    return assistantAssetError("Not found", 404, "not_found");
  }
  const writer = await authenticateAssistantWriter(request);
  if (!writer) return assistantAssetError("Unauthorized", 401, "unauthorized");
  if (writer.isDemo) {
    return assistantAssetError(
      "The demo account cannot change Jami settings.",
      403,
      "demo_account"
    );
  }
  const uid = writer.uid;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return assistantAssetError("Invalid request body", 400, "invalid_request");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return assistantAssetError("Invalid request body", 400, "invalid_request");
  }

  const now = Date.now();

  if (body.target === "preferences") {
    const payload = buildTutorPreferencesPayload(body, now);
    await settingsRef(uid).set(payload, { merge: true });
    const saved = await settingsRef(uid).get();
    log.info("preferences.saved", {
      // Names of what changed, never the student's own words.
      fields: Object.keys(payload).filter((key) => key !== "updatedAt"),
    });
    return Response.json({
      preferences: normalizeTutorPreferences(
        saved.exists ? (saved.data() as Record<string, unknown>) : undefined
      ),
    });
  }

  /*
   * Study level and subjects, which used to be a card on the Account page.
   *
   * They live here now because they are the same decision as everything else on
   * this screen -- what Jami should assume about you -- and because a level set
   * two pages away from the tutor that uses it was being left unset. Written
   * through this route rather than straight from the client so the demo-account
   * guard above covers them like every other setting here.
   */
  if (body.target === "study-profile") {
    if (
      (body.studyLevel !== null && !normalizeStudyLevel(body.studyLevel)) ||
      !Array.isArray(body.studySubjects) ||
      !body.studySubjects.every((subject) => typeof subject === "string")
    ) {
      return assistantAssetError("Invalid study profile", 400, "invalid_request");
    }
    const level = normalizeStudyLevel(body.studyLevel) ?? null;
    const subjects = normalizeStudySubjects(body.studySubjects);
    await getAdminDb()
      .collection("users")
      .doc(uid)
      .set(
        {
          defaultStudyLevel: level ?? FieldValue.delete(),
          studySubjects: subjects,
          updatedAt: now,
        },
        { merge: true }
      );
    log.info("study_profile.saved", {
      // The level is a fixed vocabulary; the subject names are the student's.
      level: level ?? "none",
      subjects: subjects.length,
    });
    return Response.json({ studyLevel: level, studySubjects: subjects });
  }

  if (body.target === "folder-notes") {
    const folderId =
      typeof body.folderId === "string" ? body.folderId.trim().slice(0, 160) : "";
    if (!folderId) {
      return assistantAssetError("Choose a folder first.", 400, "invalid_request");
    }
    const folderRef = getAdminDb()
      .collection("users")
      .doc(uid)
      .collection("studyFolders")
      .doc(folderId);
    const snapshot = await folderRef.get();
    if (!snapshot.exists) {
      return assistantAssetError("That folder no longer exists.", 404, "not_found");
    }
    if (!Array.isArray(body.notes)) {
      return assistantAssetError("Invalid notes", 400, "invalid_request");
    }
    const instructions = serializeFolderTutorNotes(body.notes);
    await folderRef.set(
      {
        tutorInstructions: instructions,
        tutorInstructionsUpdatedAt: now,
        // Deliberately not touching `updatedAt`: writing teaching instructions
        // is not working in the folder, and it should not push it to the top of
        // every recently-used list in the app.
      },
      { merge: true }
    );
    const notes = parseTutorNotes(instructions);
    log.info("folder_notes.saved", {
      // A count, never the student's own words.
      notes: notes.length,
    });
    return Response.json({
      folder: {
        id: folderId,
        notes,
        instructionsUpdatedAt: now,
      },
    });
  }

  return assistantAssetError("Unknown settings target", 400, "invalid_request");
}
