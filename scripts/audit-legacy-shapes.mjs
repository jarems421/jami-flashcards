/**
 * Count the documents still carrying a legacy shape.
 *
 * Read-only. Two separate legacies are in the way of deleting the
 * compatibility layer, and they need different backfills:
 *
 *   A. `uid` where the code now writes `userId`, on the two top-level
 *      collections. Every deck and card read fires a second query for these.
 *
 *   B. A missing `archived` boolean on the per-user lists. Firestore equality
 *      filters exclude documents where the field is absent, so the services
 *      fall back to reading the WHOLE collection and filtering in memory --
 *      once per list, per user, per cache window.
 *
 * The point of counting first is that the right fix depends entirely on the
 * answer. A handful of documents is a backfill; a hundred thousand is a
 * different conversation.
 *
 *   node --env-file-if-exists=.env.local scripts/audit-legacy-shapes.mjs
 */
import process from "node:process";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const projectId =
  process.env.FIREBASE_ADMIN_PROJECT_ID?.trim() ||
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim();
const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.trim()?.replace(/\\n/g, "\n");

if (!projectId || !clientEmail || !privateKey) {
  process.stdout.write("Missing FIREBASE_ADMIN_* environment variables.\n");
  process.exit(1);
}

if (!getApps().length) {
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), projectId });
}

const db = getFirestore();

/**
 * The per-user lists, and what each service actually treats as legacy.
 *
 * These are not all the same field, which is the trap: notebooks and folders
 * key off an `archived` boolean, while sources, topics and goals key off a
 * `status` string with a different accepted set each. Each `backfill` value is
 * the one that preserves today's behaviour -- every record matching `isLegacy`
 * is currently shown as active, so that is what it must become.
 */
const USER_LISTS = [
  { name: "notebooks", field: "archived", backfill: { archived: false },
    isLegacy: (value) => typeof value !== "boolean" },
  { name: "studyFolders", field: "archived", backfill: { archived: false },
    isLegacy: (value) => typeof value !== "boolean" },
  { name: "sources", field: "status", backfill: { status: "active" },
    isLegacy: (value) => value !== "active" && value !== "archived" },
  { name: "topics", field: "status", backfill: { status: "active" },
    isLegacy: (value) => value !== "active" && value !== "archived" && value !== "merged" },
  { name: "goals", field: "status", backfill: { status: "active" },
    isLegacy: (value) => !["active", "completed", "failed", "cancelled"].includes(value) },
];

function pad(value, width) {
  return String(value).padStart(width);
}

const users = await db.collection("users").listDocuments();
process.stdout.write(`Users: ${users.length}\n\n`);

process.stdout.write("A. Top-level collections written with the legacy `uid`\n");
for (const name of ["decks", "cards"]) {
  const all = await db.collection(name).count().get();
  const total = all.data().count;

  // `uid` present at all, and of those the ones with no `userId` -- which are
  // the documents the second query exists for.
  const withUid = await db.collection(name).where("uid", "!=", null).count().get();
  let strandedCount = 0;
  if (withUid.data().count > 0) {
    const stranded = await db.collection(name).where("uid", "!=", null).select("userId").get();
    strandedCount = stranded.docs.filter((doc) => typeof doc.get("userId") !== "string").length;
  }

  process.stdout.write(
    `  ${name.padEnd(12)} total ${pad(total, 7)}   carrying uid ${pad(withUid.data().count, 7)}   uid but no userId ${pad(strandedCount, 7)}\n`
  );
}

process.stdout.write("\nB. Per-user lists still carrying a pre-lifecycle shape\n");
process.stdout.write("   (each of these forces a full-collection read per listing)\n");

const totals = new Map(
  USER_LISTS.map((list) => [list.name, { total: 0, missing: 0, worstUser: 0, field: list.field }])
);

for (const user of users) {
  for (const list of USER_LISTS) {
    const snapshot = await user.collection(list.name).select(list.field).get();
    if (snapshot.empty) continue;
    const missing = snapshot.docs.filter((doc) => list.isLegacy(doc.get(list.field))).length;
    const row = totals.get(list.name);
    row.total += snapshot.size;
    row.missing += missing;
    row.worstUser = Math.max(row.worstUser, snapshot.size);
  }
}

for (const [name, row] of totals) {
  process.stdout.write(
    `  ${name.padEnd(12)} total ${pad(row.total, 7)}   legacy ${row.field} ${pad(row.missing, 6)}   largest single user ${pad(row.worstUser, 6)}\n`
  );
}

const scanned = [...totals.values()].reduce((sum, row) => sum + row.total, 0);
const needed = [...totals.values()].reduce((sum, row) => sum + row.missing, 0);

process.stdout.write(
  `\nEvery listing currently scans ${scanned} documents across all users to find ${needed} legacy ones.\n`
);
