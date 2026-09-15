import { planFirstNightSetup, type FirstNightAnswers } from "@/lib/onboarding/first-night";
import { createStudyFolder, getActiveStudyFolders, updateStudyFolder } from "@/services/study/folders";

/**
 * Makes what the First night welcome promised: a folder for each subject the
 * student picked, carrying their level and, where they settled one, the exam
 * course -- so Practice can draw real questions from the first visit.
 *
 * No notebooks: the student makes their own as part of the walkthrough.
 * Subjects that already have a folder are not duplicated. One subject failing
 * does not stop the others; the count of failures is returned for the
 * walkthrough to mention, and `examReady` only counts courses actually saved.
 */
export async function setUpFirstNightSubjects(userId: string, answers: FirstNightAnswers) {
  const existing = await getActiveStudyFolders(userId);
  const plan = planFirstNightSetup(answers, existing);
  let created = 0;
  let failed = 0;
  let examReady = false;

  for (const folder of plan.create) {
    try {
      await createStudyFolder(userId, {
        name: folder.name,
        subject: folder.name,
        studyLevel: folder.studyLevel,
        ...(folder.examCourse ? { examCourse: folder.examCourse } : {}),
      });
      created += 1;
      if (folder.examCourse) examReady = true;
    } catch (error) {
      console.warn(`Could not set up the ${folder.name} folder.`, error);
      failed += 1;
    }
  }

  for (const folder of plan.update) {
    try {
      await updateStudyFolder(userId, folder.id, {
        examCourse: folder.examCourse,
        ...(folder.studyLevel ? { studyLevel: folder.studyLevel } : {}),
      });
      examReady = true;
    } catch (error) {
      console.warn("Could not add a course to an existing folder.", error);
      failed += 1;
    }
  }

  // A folder that already had a course is ready too, even though nothing was written.
  if (!examReady) {
    const names = new Set(answers.subjects.map((subject) => subject.name.trim().toLowerCase()));
    examReady = existing.some((folder) => folder.examCourse && names.has(folder.name.trim().toLowerCase()));
  }

  return { created, failed, examReady };
}
