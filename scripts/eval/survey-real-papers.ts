import { getAdminDb } from "@/services/firebase/admin";

/**
 * What real practice-paper data exists, without reading any of its content.
 *
 * The MiMo diagnostic has to run against real papers rather than the synthetic
 * one-question adapter, because "the adapter caused it" is exactly the
 * hypothesis under test. This first establishes whether such papers exist and
 * what tariffs they cover, so the diagnostic can be designed against reality
 * rather than hope.
 *
 * Reads structure only: counts, mark totals, subjects, status. No student
 * answer, no question text, no name, no identifier that leaves this process.
 */
export default async function main() {
  const db = getAdminDb();

  const users = await db.collection("users").listDocuments();
  process.stdout.write(`users: ${users.length}\n`);

  let papersFound = 0;
  const byStatus = new Map<string, number>();
  const tariffs = new Map<number, number>();
  const subjects = new Map<string, number>();
  let withResult = 0;
  let withAudit = 0;
  let submittedQuestions = 0;
  const papers: { uid: string; notebookId: string; questions: number; totalMarks: number }[] = [];

  for (const user of users) {
    const snapshot = await user.collection("pastPapers").get();
    for (const document of snapshot.docs) {
      const data = document.data() as Record<string, unknown>;
      papersFound += 1;
      const status = String(data.status ?? "unknown");
      byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
      const profile = data.assessmentProfile as { specificationOrCourse?: string } | undefined;
      const subject = String(profile?.specificationOrCourse ?? "unknown").slice(0, 40);
      subjects.set(subject, (subjects.get(subject) ?? 0) + 1);
      if (data.result) withResult += 1;
      if (data.markingAudit) withAudit += 1;

      const questions = Array.isArray(data.questions)
        ? (data.questions as { marks?: number }[])
        : [];
      for (const question of questions) {
        const marks = Number(question?.marks);
        if (Number.isFinite(marks)) tariffs.set(marks, (tariffs.get(marks) ?? 0) + 1);
      }
      if (status === "submitted" || status === "marked") submittedQuestions += questions.length;
      papers.push({
        uid: user.id,
        notebookId: document.id,
        questions: questions.length,
        totalMarks: Number(data.totalMarks ?? 0),
      });
    }
  }

  process.stdout.write(`practice papers: ${papersFound}\n`);
  process.stdout.write(`  with a marking result: ${withResult}\n`);
  process.stdout.write(`  with a marking audit:  ${withAudit}\n`);
  process.stdout.write(`  questions on submitted/marked papers: ${submittedQuestions}\n`);

  process.stdout.write(`\nstatus:\n`);
  for (const [status, count] of [...byStatus].sort()) {
    process.stdout.write(`  ${status.padEnd(14)} ${count}\n`);
  }

  process.stdout.write(`\nsubject (assessment profile):\n`);
  for (const [subject, count] of [...subjects].sort()) {
    process.stdout.write(`  ${subject.padEnd(42)} ${count}\n`);
  }

  process.stdout.write(`\nquestion tariffs available:\n`);
  for (const [marks, count] of [...tariffs].sort((a, b) => a[0] - b[0])) {
    process.stdout.write(`  ${String(marks).padStart(3)} marks  ${count} questions\n`);
  }

  process.stdout.write(`\npapers (structure only):\n`);
  for (const paper of papers.slice(0, 30)) {
    // Identifiers are hashed rather than printed: the diagnostic needs to be
    // able to fetch a paper again, not to record whose it was.
    const tag = `${paper.uid.slice(0, 4)}…/${paper.notebookId.slice(0, 6)}…`;
    process.stdout.write(
      `  ${tag.padEnd(18)} ${String(paper.questions).padStart(3)} questions, ${paper.totalMarks} marks\n`
    );
  }
}
