/**
 * Put a finished paper into the reviewer account so it can be looked at in Jami.
 *
 * The pilot already does this when a case reaches "ready", into a "Paper
 * quality pilots" folder with one notebook page per question. No case has
 * reached ready, so this writes the same shape through the same builders --
 * folder, notebook, a page per question, and the pastPapers record that makes
 * it a practice paper rather than loose pages.
 *
 * The paper it writes is the completed one reconstructed from captured
 * responses: 18 questions, 96 marks, four sections of 24. It is also the paper
 * the review rejected, and three of its mark schemes belong to a different
 * paper, so the title says so. Something in an account is read as finished work
 * unless it says otherwise, and this is a look at the format rather than a
 * paper anyone should sit.
 */
import { readFileSync } from "node:fs";
const raw = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
for (const line of raw.split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (!m || process.env[m[1]]) continue;
  process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { getAdminDb } = await import("../../services/firebase/admin.ts");
const { buildStudyFolderPayload } = await import("../../lib/workspace/study-folders.ts");
const { buildNotebookPagePayload, buildNotebookPayload } = await import("../../lib/workspace/notebooks.ts");
const { buildPracticePaperPayload } = await import("../../lib/practice/practice-papers.ts");

const REVIEWER_UID = "PPm4x6PcMMQiZlmEKJ8rHCeVMm63";
const FOLDER_ID = "paper-quality-pilots";
const paper = JSON.parse(readFileSync("final-paper.json", "utf8"));
const paperId = "review_aqa_psychology_7182_1_reconstructed";
const now = Date.now();

const title = `${paper.title} (rejected draft, for format review)`;
const db = getAdminDb();
const userRef = db.collection("users").doc(REVIEWER_UID);
const batch = db.batch();

batch.set(userRef.collection("studyFolders").doc(FOLDER_ID), buildStudyFolderPayload({
  name: "Paper quality pilots",
  subject: "GCSE and A-level validation papers",
  color: "violet",
  icon: "folder",
  now,
}), { merge: true });

batch.set(userRef.collection("notebooks").doc(paperId), buildNotebookPayload({
  folderId: FOLDER_ID,
  title,
  type: "practice_paper",
  sourceIds: [],
  pastPaperId: paperId,
  color: "violet",
  icon: "notebook",
  pageColor: "white",
  pageStyle: "plain",
  now,
}));

paper.questions.forEach((question, index) => {
  const safe = String(question.id).replace(/[^A-Za-z0-9_-]/g, "-");
  batch.set(
    userRef.collection("notebookPages").doc(`${paperId}_${safe}`.slice(0, 1_400)),
    buildNotebookPagePayload({
      notebookId: paperId,
      folderId: FOLDER_ID,
      pageNumber: index + 1,
      title: question.label ?? `Question ${index + 1}`,
      pageType: "question",
      pageColor: "white",
      pageStyle: "plain",
      status: "blank",
      questionPrompt: `${question.prompt}\n\n[${question.marks} ${question.marks === 1 ? "mark" : "marks"}]`,
      questionAssets: question.assets ?? [],
      linkedQuestionId: question.id,
      linkedPastPaperId: paperId,
      now,
    })
  );
});

if (typeof buildPracticePaperPayload === "function") {
  batch.set(userRef.collection("pastPapers").doc(paperId), buildPracticePaperPayload({
    notebookId: paperId,
    folderId: FOLDER_ID,
    title,
    origin: "generated",
    status: "ready",
    sourceIds: [],
    sourceLabels: [],
    request: "Reconstructed from a pilot run, for looking at the format in Jami",
    coverage: "Complete official component",
    length: "full",
    focus: "balanced",
    focusDetail: "",
    durationMinutes: paper.durationMinutes,
    timingMode: "timed",
    timingState: "not_started",
    totalPausedMs: 0,
    deadlineVersion: 0,
    tutorEnabled: false,
    tutorUsed: false,
    timerEnabled: true,
    instructions: paper.instructions ?? [],
    companionDocuments: paper.companionDocuments ?? [],
    assessmentProfile: paper.assessmentProfile,
    questions: paper.questions,
    markScheme: paper.markScheme,
    now,
  }));
} else {
  console.log("note: buildPracticePaperPayload not found; writing notebook and pages only");
}

await batch.commit();
console.log("written to", REVIEWER_UID);
console.log("  folder:   Paper quality pilots");
console.log("  notebook:", title);
console.log("  pages:   ", paper.questions.length);
console.log("  marks:   ", paper.questions.reduce((sum, q) => sum + q.marks, 0));
process.exit(0);
