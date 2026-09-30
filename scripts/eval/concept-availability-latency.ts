import { loadConceptAvailability } from "@/services/learning/concept-availability.server";
import { loadStudyActions } from "@/services/learning/study-actions.server";
import { getAdminAuth, getAdminDb } from "@/services/firebase/admin";
import { mapStudyFolderData } from "@/lib/workspace/study-folders";

/**
 * Can concept availability afford to be in the recommendation path?
 *
 * `getExamQuestionCountsByConcept` scans every eligible question in a course
 * across three difficulties. That is the same work the practice setup page
 * already does, and the setup page is a screen a student waits on
 * deliberately -- Today is not. The Learning Engine's own budget for a whole
 * profile is 2,500 ms, and this would be added to it.
 *
 * So the number is an acceptance criterion rather than something to optimise
 * afterwards: if the scan does not fit beside the profile it is already
 * competing with, it belongs behind a cache or out of the path.
 *
 *   node --env-file-if-exists=.env.local scripts/run-ts.mjs \
 *     scripts/eval/concept-availability-latency.ts --email <address> [--runs 3]
 *
 * Reads only.
 */

/** What the profile is allowed, and what this must fit inside. */
const PROFILE_BUDGET_MS = 2_500;

function arg(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
}

async function time<T>(run: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const startedAt = Date.now();
  const value = await run();
  return { ms: Date.now() - startedAt, value };
}

export default async function main() {
  const email = arg("email");
  const runs = Math.max(1, Number.parseInt(arg("runs") ?? "3", 10) || 3);
  let uid = arg("uid");
  if (!uid && email) uid = (await getAdminAuth().getUserByEmail(email)).uid;
  if (!uid) {
    console.error("Usage: --uid <uid> | --email <address> [--runs 3]");
    process.exit(1);
  }

  const folders = await getAdminDb()
    .collection("users")
    .doc(uid)
    .collection("studyFolders")
    .limit(25)
    .get();
  const withCourse = folders.docs
    .map((document) => mapStudyFolderData(document.id, document.data() as Record<string, unknown>))
    .filter((folder) => folder.examCourse && !folder.archived);

  if (withCourse.length === 0) {
    console.log("\nNo folder on this account carries an exam course, so the scan");
    console.log("cannot be measured here. It is the corpus read that costs, and a");
    console.log("folder without a course never performs it.\n");
    return;
  }

  console.log(`\nProfile budget: ${PROFILE_BUDGET_MS} ms. Availability must fit beside it.\n`);

  for (const folder of withCourse) {
    console.log(`${folder.name} (${folder.id}) — ${folder.examCourse?.specificationId}`);
    const samples: number[] = [];
    let concepts = 0;
    let pastPaperReadable = false;
    for (let run = 0; run < runs; run += 1) {
      const { ms, value } = await time(() =>
        loadConceptAvailability({ uid: uid as string, folderId: folder.id, folder })
      );
      samples.push(ms);
      concepts = Object.keys(value.pastPaper.byConcept ?? {}).length;
      pastPaperReadable = value.pastPaper.available;
    }

    /*
     * Compared against the whole recommendation path, not against itself.
     *
     * A scan that takes 400 ms is cheap in isolation and expensive if Today
     * already spends 2,200 ms building three profiles, so the useful number is
     * what it adds to what is already there.
     */
    const actions = await time(() => loadStudyActions({ uid: uid as string }));

    const worst = Math.max(...samples);
    const median = [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)];
    console.log(`  availability   median ${median} ms   worst ${worst} ms   (${runs} runs)`);
    console.log(`  study actions  ${actions.ms} ms for ${actions.value.evaluatedFolders} folder(s)`);
    console.log(`  concepts with corpus questions: ${concepts}${pastPaperReadable ? "" : "  (corpus unreadable)"}`);

    const combined = actions.ms + worst;
    console.log(
      combined <= PROFILE_BUDGET_MS
        ? `  VERDICT: fits. ${combined} ms together, inside ${PROFILE_BUDGET_MS} ms.\n`
        : `  VERDICT: does NOT fit. ${combined} ms together, over ${PROFILE_BUDGET_MS} ms.\n` +
            `  Cache it per folder read, or keep it out of the recommendation path.\n`
    );
  }
}
