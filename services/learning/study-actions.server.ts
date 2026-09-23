import "server-only";

import { featureFlags } from "@/lib/app/feature-flags";
import { isAnyAiProviderConfigured } from "@/lib/ai/provider-router";
import { revisionSessionsEnabled } from "@/services/learning/revision-session-context.server";
import {
  buildStudyActions,
  mergeStudyActions,
  type StudyAction,
} from "@/lib/learning/actions/study-actions";
import { mapStudyFolderData, type StudyFolder } from "@/lib/workspace/study-folders";
import { getAdminDb } from "@/services/firebase/admin";
import { loadLearnerProfile } from "@/services/learning/learner-profile.server";
import { loadStudyActionHistory } from "@/services/learning/study-action-history.server";

/**
 * How many folders one Today request considers: the most recently used.
 *
 * Each folder costs a profile's worth of bounded reads, so this caps the cost
 * of the home page rather than scanning every folder a student has ever made.
 */
export const STUDY_ACTION_FOLDER_LIMIT = 3;
/** Today shows a short list on purpose; a surface with endless suggestions stops being read. */
export const STUDY_ACTION_LIMIT = 4;

export type StudyActionsResult = {
  actions: StudyAction[];
  /**
   * The folders the actions were decided from, in full.
   *
   * Whole folder documents rather than `{id, name}`, because they are already
   * read and mapped here through the admin SDK. Narrowing them meant the plan
   * route had to read the same folders a second time to learn a course or a
   * study level -- and it did so through the *browser* Firestore SDK, which on
   * a server has no signed-in user and so waits out its timeout. Nothing was
   * cheaper about the narrow shape; it just cost a request.
   */
  folders: StudyFolder[];
  evaluatedFolders: number;
  failedFolders: number;
  /**
   * Whether the student's own history of taking or refusing this advice could
   * be read. False means the list is the engine's raw opinion, with nothing
   * resting -- which is the right fallback, and worth being able to see in a
   * log when Today starts repeating itself.
   */
  historyAvailable: boolean;
  generatedAt: number;
};

/**
 * The next study actions across a student's recent folders.
 *
 * Every folder's actions are decided from that folder's evidence alone, then
 * ranked together; only actions with a real destination are returned. One
 * folder failing to load costs that folder's actions, not the whole list.
 */
export async function loadStudyActions(input: {
  uid: string;
  now?: number;
  limit?: number;
}): Promise<StudyActionsResult> {
  const uid = input.uid.trim();
  const now = input.now ?? Date.now();
  if (!uid) {
    return {
      actions: [],
      folders: [],
      evaluatedFolders: 0,
      failedFolders: 0,
      historyAvailable: false,
      generatedAt: now,
    };
  }

  const snapshot = await getAdminDb()
    .collection("users")
    .doc(uid)
    .collection("studyFolders")
    .where("archived", "==", false)
    .orderBy("updatedAt", "desc")
    .limit(STUDY_ACTION_FOLDER_LIMIT)
    .get();
  const folders = snapshot.docs
    .map((folderDoc) => mapStudyFolderData(folderDoc.id, folderDoc.data() as Record<string, unknown>))
    .filter((folder) => !folder.archived);

  /*
   * Read alongside the profiles, not before them: it is one small query and
   * every folder needs the same answer, so serialising it would add its
   * latency to a page that already has a budget to keep.
   */
  const [historyResult, results] = await Promise.all([
    loadStudyActionHistory({ uid, now }),
    Promise.all(
      folders.map(async (folder) => {
        try {
          const profile = await loadLearnerProfile({ uid, folderId: folder.id, folder, now });
          return profile
            ? { profile, folder }
            : { profile: null, folder };
        } catch {
          return null;
        }
      })
    ),
  ]);

  const built = results.map((result) => {
    if (!result) return null;
    if (!result.profile) return [];
    return buildStudyActions(
      result.profile,
      {
        questionPracticeAvailable:
          featureFlags.enablePastPaperPractice && Boolean(result.folder.examCourse),
        /*
         * Whether this deployment may have Jami write study material.
         *
         * Cards and questions are one capability wearing two hats -- AI
         * writing material the student then reads and confirms -- and
         * `enableFlashcardAi` is the flag that already governs it. Practice is
         * deliberately *not* gated on `enablePastPaperPractice`: that governs
         * the licensed exam corpus, which is material Jami serves rather than
         * writes, and conflating the two would switch generation off wherever
         * a folder simply has no exam course.
         */
        canGenerate: {
          flashcards: featureFlags.enableFlashcardAi,
          practice: featureFlags.enableFlashcardAi,
        },
        // Teaching a concept directly, in a Revision Session.
        canRunRevisionSession: revisionSessionsEnabled() && isAnyAiProviderConfigured(),
      },
      historyResult.history,
      now
    );
  });

  return {
    actions: mergeStudyActions(
      built.map((actions) => actions ?? []),
      { limit: input.limit ?? STUDY_ACTION_LIMIT, executableOnly: true }
    ),
    folders,
    evaluatedFolders: folders.length,
    failedFolders: built.filter((actions) => actions === null).length,
    historyAvailable: historyResult.available,
    generatedAt: now,
  };
}
