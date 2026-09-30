/**
 * What turning on concept relations would do to a real student's profile.
 *
 * The question this answers is not "do the tests pass" — they do — but "do the
 * new numbers represent what the underlying evidence actually says". Joining
 * previously separate evidence streams is the first change in the Learning
 * Engine capable of moving a number a student has already been shown, so it
 * gets looked at on real data before anyone sees it.
 *
 * Builds one folder's profile twice from one load of the evidence — once with
 * relations off, once on — and prints what moved. Reads only; writes nothing.
 *
 *   node --env-file-if-exists=.env.local scripts/run-ts.mjs \
 *     scripts/eval/concept-relation-diff.ts --uid <uid> --folder <folderId>
 *
 * Add --all to list every concept rather than only what changed.
 *
 * Three conveniences, because the alternative is copying ids out of a console:
 *
 *   --email <address>   resolve the uid from a sign-in address
 *   (no --folder)       list the account's folders and stop
 *   --propose           no Topic has declared a relation yet, so derive the
 *                       obvious ones by matching Topic names and aliases
 *                       against the folder's specification catalogue, and show
 *                       what declaring them WOULD do. Nothing is written --
 *                       this is a preview of a decision, not the decision.
 */
import { buildLearnerProfile } from "@/lib/learning/profile/build-learner-profile";
import { loadLearnerEvidence } from "@/services/learning/learner-profile.server";
import { getAdminAuth, getAdminDb } from "@/services/firebase/admin";
import { servableExamSpecificationConcepts } from "@/lib/practice/exam-specification-concepts";
import { mapStudyFolderData } from "@/lib/workspace/study-folders";
import { getTopicNameKey } from "@/lib/material/topics";
import type { TopicRelationInput } from "@/lib/learning/concepts/topic-relations";
import type { LearnerProfile, LearningTopicState } from "@/lib/learning/types";

/**
 * Candidate relations, from names alone.
 *
 * Deliberately dumb: an exact name match, or an alias match, between a Topic
 * the student wrote and a concept the board published. Nothing fuzzy, nothing
 * inferred by a model. It exists to answer "what would this look like on my
 * own data" without anyone having to hand-declare twenty relations first.
 */
async function proposeRelations(uid: string, folderId: string): Promise<TopicRelationInput[]> {
  const db = getAdminDb();
  const folderSnap = await db.collection("users").doc(uid).collection("studyFolders").doc(folderId).get();
  if (!folderSnap.exists) return [];
  const folder = mapStudyFolderData(folderSnap.id, folderSnap.data() as Record<string, unknown>);
  const course = folder.examCourse;
  if (!course) return [];

  const concepts = servableExamSpecificationConcepts(course.specificationId);
  if (concepts.length === 0) return [];
  const byName = new Map<string, string>();
  for (const concept of concepts) {
    byName.set(getTopicNameKey(concept.label), concept.id);
    for (const alias of concept.aliases ?? []) byName.set(getTopicNameKey(alias), concept.id);
  }

  const topicsSnap = await db.collection("users").doc(uid).collection("topics").limit(300).get();
  const proposed: TopicRelationInput[] = [];
  for (const topicDoc of topicsSnap.docs) {
    const data = topicDoc.data() as Record<string, unknown>;
    if (data.status !== "active") continue;
    const names = [
      typeof data.name === "string" ? data.name : "",
      ...(Array.isArray(data.aliases) ? (data.aliases as unknown[]).filter((a): a is string => typeof a === "string") : []),
    ].filter(Boolean);
    for (const name of names) {
      const conceptId = byName.get(getTopicNameKey(name));
      if (conceptId) {
        proposed.push({
          topicId: topicDoc.id,
          relation: { type: "exact", conceptId, confirmedByOwner: true },
        });
        break;
      }
    }
  }
  return proposed;
}

function arg(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
}

function pct(value: number | undefined) {
  return value === undefined ? "  —  " : `${(value * 100).toFixed(1).padStart(5)}%`;
}

function delta(before: number | undefined, after: number | undefined) {
  if (before === undefined || after === undefined) return "     ";
  const change = (after - before) * 100;
  if (Math.abs(change) < 0.05) return "   · ";
  return `${change > 0 ? "+" : ""}${change.toFixed(1)}`.padStart(5);
}

function decisionOf(state: LearningTopicState | undefined) {
  if (!state) return "—";
  return state.decision ? `${state.decision.action}/${state.decision.reason}` : "none";
}

function index(profile: LearnerProfile) {
  return new Map(profile.topics.map((topic) => [topic.topicKey, topic]));
}

export default async function main() {
  const showAll = process.argv.includes("--all");
  const propose = process.argv.includes("--propose");
  const email = arg("email");

  let uid = arg("uid");
  if (!uid && email) {
    uid = (await getAdminAuth().getUserByEmail(email)).uid;
    console.log(`Resolved ${email} to uid ${uid}`);
  }
  if (!uid) {
    console.error("Usage: --uid <uid> | --email <address>  [--folder <id>] [--propose] [--all]");
    process.exit(1);
  }

  const folderId = arg("folder");
  if (!folderId) {
    const snap = await getAdminDb()
      .collection("users").doc(uid).collection("studyFolders")
      .orderBy("updatedAt", "desc").limit(25).get();
    console.log(`
Folders for ${uid}:`);
    if (snap.empty) console.log("  (none)");
    for (const folderDoc of snap.docs) {
      const folder = mapStudyFolderData(folderDoc.id, folderDoc.data() as Record<string, unknown>);
      console.log(
        `  ${folderDoc.id.padEnd(24)} ${(folder.name ?? "").slice(0, 30).padEnd(32)} ` +
          `${folder.examCourse ? `course ${folder.examCourse.specificationId}` : "no course"}` +
          `${folder.archived ? "  (archived)" : ""}`
      );
    }
    console.log("\nRe-run with --folder <id> to diff one.\n");
    return;
  }

  const loaded = await loadLearnerEvidence({ uid, folderId });
  if (!loaded) {
    console.error("No evidence for that folder.");
    process.exit(1);
  }

  const now = Date.now();
  const { evidence } = loaded;
  const declared = evidence.topicRelations ?? [];
  const relations = propose ? await proposeRelations(uid, folderId) : declared;
  if (propose) {
    console.log(
      `
PROPOSED relations, matched on name only. Nothing has been written.` +
        `
Declared in the database: ${declared.length}`
    );
  }

  /*
   * One load, two builds. The flag decides whether the loader passes relations
   * along, so the difference is reproduced here rather than read from the
   * environment -- a diff that needed the flag flipped between two runs would
   * also be comparing two different reads of a live database.
   */
  const before = buildLearnerProfile({
    scope: { folderId },
    evidence: { ...evidence, topicRelations: [] },
    now,
  });
  const after = buildLearnerProfile({
    scope: { folderId },
    evidence: { ...evidence, topicRelations: relations },
    now,
  });

  console.log(`\nFolder ${folderId}`);
  console.log(`Declared relations: ${relations.length}`);
  if (relations.length === 0) {
    console.log("Nothing to compare: no Topic in this folder declares a relation.\n");
    return;
  }
  for (const { topicId, relation } of relations) {
    const detail =
      relation.type === "exact"
        ? `exact → spec:${relation.conceptId}`
        : `covers ${relation.conceptIds.length} concept(s)`;
    console.log(`  topic:${topicId}  ${detail}  ${relation.confirmedByOwner ? "" : "(UNCONFIRMED — ignored)"}`);
  }

  const beforeByKey = index(before);
  const afterByKey = index(after);
  const keys = Array.from(new Set([...beforeByKey.keys(), ...afterByKey.keys()])).sort();

  console.log(
    `\n${"concept".padEnd(42)} ${"mastery".padEnd(13)} ${"confidence".padEnd(13)} attempts  decision`
  );
  console.log("-".repeat(112));

  let changed = 0;
  for (const key of keys) {
    const left = beforeByKey.get(key);
    const right = afterByKey.get(key);
    const moved =
      left?.signal?.mastery !== right?.signal?.mastery ||
      left?.signal?.confidence !== right?.signal?.confidence ||
      left?.signal?.attempts !== right?.signal?.attempts ||
      decisionOf(left) !== decisionOf(right);
    if (!moved) { if (!showAll) continue; }
    if (moved) changed += 1;

    const label = (right?.label ?? left?.label ?? key).slice(0, 30);
    console.log(
      `${`${label} (${key})`.slice(0, 42).padEnd(42)} ` +
        `${pct(left?.signal?.mastery)}→${pct(right?.signal?.mastery)}${delta(left?.signal?.mastery, right?.signal?.mastery)} ` +
        `${pct(left?.signal?.confidence)}→${pct(right?.signal?.confidence)} ` +
        `${String(left?.signal?.attempts ?? 0).padStart(4)}→${String(right?.signal?.attempts ?? 0).padStart(4)}  ` +
        `${decisionOf(left)} → ${decisionOf(right)}`
    );
  }

  console.log("-".repeat(112));
  console.log(`${changed} concept(s) changed out of ${keys.length}.`);

  const beforeFocus = before.recommendedFocus.map((entry) =>
    entry.target.kind === "topic" ? entry.target.topicKey : `error:${entry.target.category}`
  );
  const afterFocus = after.recommendedFocus.map((entry) =>
    entry.target.kind === "topic" ? entry.target.topicKey : `error:${entry.target.category}`
  );
  console.log(`\nRecommendations before: ${beforeFocus.join(", ") || "(none)"}`);
  console.log(`Recommendations after:  ${afterFocus.join(", ") || "(none)"}`);

  /*
   * The check that matters most. Evidence counts may rise on a broad Topic,
   * because finer evidence now rolls up to it -- that is the point. They must
   * never rise on a covered concept, because nothing flows downward.
   */
  const covered = new Set(
    relations.flatMap((entry) =>
      entry.relation.type === "covers" && entry.relation.confirmedByOwner
        ? entry.relation.conceptIds.map((conceptId) => `spec:${conceptId}`)
        : []
    )
  );
  const inflated = Array.from(covered).filter((key) => {
    const left = beforeByKey.get(key)?.signal?.attempts ?? 0;
    const right = afterByKey.get(key)?.signal?.attempts ?? 0;
    return right > left;
  });
  console.log(
    inflated.length === 0
      ? "\nOK: no covered concept gained evidence. Nothing flowed downward."
      : `\nPROBLEM: evidence flowed down to ${inflated.join(", ")}`
  );
  console.log();
}
