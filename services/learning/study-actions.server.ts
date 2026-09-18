import "server-only";

import { featureFlags } from "@/lib/app/feature-flags";
import {
  buildStudyActions,
  mergeStudyActions,
  type StudyAction,
} from "@/lib/learning/actions/study-actions";
import { mapStudyFolderData, type StudyFolder } from "@/lib/workspace/study-folders";
import { getAdminDb } from "@/services/firebase/admin";
import { loadLearnerProfile } from "@/services/learning/learner-profile.server";

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
    return { actions: [], folders: [], evaluatedFolders: 0, failedFolders: 0, generatedAt: now };
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

  const results = await Promise.all(
    folders.map(async (folder) => {
      try {
        const profile = await loadLearnerProfile({ uid, folderId: folder.id, folder, now });
        return profile
          ? buildStudyActions(profile, {
              questionPracticeAvailable:
                featureFlags.enablePastPaperPractice && Boolean(folder.examCourse),
            })
          : [];
      } catch {
        return null;
      }
    })
  );

  return {
    actions: mergeStudyActions(
      results.map((result) => result ?? []),
      { limit: input.limit ?? STUDY_ACTION_LIMIT, executableOnly: true }
    ),
    folders,
    evaluatedFolders: folders.length,
    failedFolders: results.filter((result) => result === null).length,
    generatedAt: now,
  };
}
