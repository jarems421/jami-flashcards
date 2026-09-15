import { planFirstNightSetup, type FirstNightAnswers } from "@/lib/onboarding/first-night";
import { createStudyFolder, getActiveStudyFolders } from "@/services/study/folders";
import { createNotebook } from "@/services/study/notebooks";

/**
 * Makes what the First night welcome promised: a folder for each subject the
 * student picked, with a first notebook inside.
 *
 * Subjects that already have a folder are left alone, so replaying the
 * walkthrough never makes duplicates. One subject failing does not stop the
 * others; the count of failures is returned for the walkthrough to mention.
 */
export async function setUpFirstNightSubjects(userId: string, answers: FirstNightAnswers) {
  const existing = await getActiveStudyFolders(userId);
  const plan = planFirstNightSetup(
    answers,
    existing.map((folder) => folder.name)
  );
  let created = 0;
  let failed = 0;
  for (const folder of plan.folders) {
    try {
      const made = await createStudyFolder(userId, {
        name: folder.name,
        subject: folder.name,
        studyLevel: plan.studyLevel,
      });
      await createNotebook(userId, { folderId: made.id, title: folder.notebookTitle });
      created += 1;
    } catch (error) {
      console.warn(`Could not set up the ${folder.name} folder.`, error);
      failed += 1;
    }
  }
  return { created, failed };
}
