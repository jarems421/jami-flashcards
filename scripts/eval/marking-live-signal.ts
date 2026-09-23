import { getAdminDb } from "@/services/firebase/admin";

/**
 * How Past Paper Practice marking is doing with real students.
 *
 * Every benchmark in this folder measures Jami against examiners on answers
 * somebody else wrote. This reads what the product itself already records on
 * every marked attempt, and says three things no benchmark can:
 *
 *   - how often the two blind markers disagree on a real answer, which is how
 *     often marking needed an adjudicator at all;
 *   - how often a student asked for their mark to be checked;
 *   - how often that check changed the mark, and which way.
 *
 * A student asks for a check when a mark looks wrong to them, so a check that
 * rarely changes anything is evidence the first mark was sound, and checks that
 * keep moving marks up are evidence of harshness.
 *
 * Read-only, and aggregates only: counts and averages, never an answer, a
 * question or a student.
 *
 *   node --env-file-if-exists=.env.local scripts/run-ts.mjs \
 *     scripts/eval/marking-live-signal.ts [--days=30]
 */

type Attempt = {
  status?: string;
  result?: { awardedMarks?: number; maxMarks?: number };
  audit?: { primaryScore?: number; verifierScore?: number; adjudicated?: boolean; adaptivelyVerified?: boolean };
  reviewUsed?: boolean;
  reviewStatus?: string;
  reviewOriginalScore?: number;
  reviewAudit?: { changed?: boolean };
  updatedAt?: number;
  createdAt?: number;
};

const percent = (part: number, whole: number) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "   -");

export default async function main(args: string[]) {
  const days = Number(args.find((value) => value.startsWith("--days="))?.split("=")[1] ?? 0);
  const since = days > 0 ? Date.now() - days * 86_400_000 : 0;
  const snapshot = await getAdminDb().collectionGroup("examAttempts").get();
  const attempts = snapshot.docs
    .map((document) => document.data() as Attempt)
    .filter((attempt) => (attempt.updatedAt ?? attempt.createdAt ?? 0) >= since);

  const marked = attempts.filter((attempt) => typeof attempt.result?.awardedMarks === "number");
  const verified = marked.filter((attempt) => typeof attempt.audit?.verifierScore === "number");
  const disagreed = verified.filter((attempt) => attempt.audit?.primaryScore !== attempt.audit?.verifierScore);
  const gaps = disagreed.map((attempt) => Math.abs((attempt.audit?.primaryScore ?? 0) - (attempt.audit?.verifierScore ?? 0)));
  const reviewed = marked.filter((attempt) => attempt.reviewUsed && attempt.reviewStatus === "complete");
  const deltas = reviewed.map((attempt) => (attempt.result?.awardedMarks ?? 0) - (attempt.reviewOriginalScore ?? attempt.result?.awardedMarks ?? 0));
  const up = deltas.filter((delta) => delta > 0);
  const down = deltas.filter((delta) => delta < 0);

  process.stdout.write(
    `\nPast Paper Practice marking${days > 0 ? `, last ${days} days` : ", all time"}\n` +
      `  attempts marked                       ${marked.length}\n` +
      `  blind markers disagreed               ${disagreed.length} of ${verified.length} (${percent(disagreed.length, verified.length)})` +
      `${gaps.length ? `, by ${(gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length).toFixed(2)} marks on average` : ""}\n` +
      `  students asked for a check            ${reviewed.length} (${percent(reviewed.length, marked.length)} of marked attempts)\n` +
      `  the check changed the mark            ${up.length + down.length} (${percent(up.length + down.length, reviewed.length)})\n` +
      `    raised                              ${up.length}${up.length ? `, by ${(up.reduce((sum, delta) => sum + delta, 0) / up.length).toFixed(2)} on average` : ""}\n` +
      `    lowered                             ${down.length}${down.length ? `, by ${(-down.reduce((sum, delta) => sum + delta, 0) / down.length).toFixed(2)} on average` : ""}\n\n`
  );
  if (reviewed.length < 20) {
    process.stdout.write("Fewer than 20 checks: read the direction, not the rate.\n");
  }
}
