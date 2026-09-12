/**
 * Why the reviewer refused what it refused.
 *
 * A rejection rate on its own says nothing about whether extraction is weak or
 * the reviewer is strict. The notes say which, and they group: a fault running
 * through a whole paper reads differently from a scatter of per-question
 * misreads, and only the first is worth fixing in the extractor.
 *
 *   node --env-file-if-exists=.env.local scripts/run-ts.mjs \
 *     scripts/eval/review-rejections.ts [--paper=<id>] [--examples=3]
 */
import { getAdminDb } from "@/services/firebase/admin";
import type { ExamQuestion } from "@/lib/practice/exam-questions";

function flag(args: string[], name: string) {
  const match = args.find((arg) => arg.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3) : undefined;
}

/** Collapse the numbers out of a note so the same fault groups as one. */
function shape(note: string) {
  return note
    .replace(/\b\d+(\.\d+)?\b/g, "N")
    .replace(/"[^"]*"/g, '"..."')
    .trim();
}

export default async function main(args: string[] = []) {
  const paperFilter = flag(args, "paper");
  const examples = Number(flag(args, "examples") ?? "2");
  const db = getAdminDb();
  const snapshot = await db.collection("examQuestions").get();
  const questions = snapshot.docs
    .map((doc) => ({ ...doc.data(), id: doc.id }) as ExamQuestion & { verification?: { issues?: string[] } })
    .filter((question) => !paperFilter || question.paperId === paperFilter);

  const byPaper = new Map<string, typeof questions>();
  for (const question of questions) {
    const key = question.paperId ?? "(no paper)";
    byPaper.set(key, [...(byPaper.get(key) ?? []), question]);
  }

  for (const [paperId, group] of [...byPaper].sort()) {
    const approved = group.filter((item) => item.review?.status === "approved");
    const rejected = group.filter((item) => item.review?.status === "rejected");
    const label = `${group[0]?.provenance?.specificationId}/${group[0]?.provenance?.componentCode} ${group[0]?.provenance?.series} ${group[0]?.provenance?.year}`;
    console.log(`\n=== ${label}   (${paperId})`);
    console.log(`    ${group.length} questions: ${approved.length} approved, ${rejected.length} rejected`);

    const reasons = new Map<string, string[]>();
    for (const question of rejected) {
      for (const note of question.review?.notes ?? ["(no note recorded)"]) {
        const key = shape(note);
        reasons.set(key, [...(reasons.get(key) ?? []), `${question.label}: ${note}`]);
      }
    }
    for (const [key, hits] of [...reasons].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`\n    [${hits.length}] ${key}`);
      for (const hit of hits.slice(0, examples)) console.log(`         ${hit}`);
    }
  }

  console.log(`\n--- totals: ${questions.length} questions, ${questions.filter((q) => q.review?.status === "approved").length} approved`);
}
