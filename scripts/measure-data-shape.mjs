/**
 * Read-only measurement of how much data a Jami account actually holds.
 *
 * Several reads documented in docs/data-access-audit.md deliberately load a
 * complete owned collection -- Library and Cards search, per-deck and
 * per-topic counts. Whether that is fine or a problem is a question about
 * volume, not about the code, and this script answers it with numbers instead
 * of assumptions.
 *
 * Uses Firestore aggregate counts, which bill one document read per 1000
 * counted. It writes nothing and reads no document contents.
 *
 *   node scripts/measure-data-shape.mjs [email]
 */
import { readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

/** Thresholds agreed before the numbers were seen, so the reading is honest. */
const COMFORTABLE = 1000;
const NOTICEABLE = 5000;

/** Subcollections under users/{uid}. */
const USER_COLLECTIONS = [
  "sources",
  "topics",
  "notebooks",
  "notebookPages",
  "notebookFiles",
  "studyFolders",
  "generatedContentDrafts",
  "masteryEvents",
  "studyActivity",
  "goals",
  "stars",
  "constellations",
  "assistantThreads",
  "assistantMessages",
];

function loadEnvLocal() {
  let raw;
  try {
    raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  } catch {
    // Falling back to the ambient environment is legitimate in CI, where the
    // credentials are injected rather than kept in a file.
    return;
  }

  // Split on CRLF as well as LF: `.` never matches a carriage return, so a
  // trailing \r would make every line fail the pattern below.
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.trim().replace(/^["']|["']$/g, "");
  }
}

function initAdmin() {
  if (getApps().length > 0) return;
  const projectId =
    process.env.FIREBASE_ADMIN_PROJECT_ID?.trim() ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.trim()?.replace(
    /\\n/g,
    "\n"
  );

  if (!projectId || !clientEmail || !privateKey) {
    console.error(
      "Missing Firebase Admin credentials. Set FIREBASE_ADMIN_PROJECT_ID, " +
        "FIREBASE_ADMIN_CLIENT_EMAIL and FIREBASE_ADMIN_PRIVATE_KEY."
    );
    process.exit(1);
  }

  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  return projectId;
}

async function countOrNull(query) {
  try {
    return (await query.count().get()).data().count;
  } catch (error) {
    // A collection that has never been written simply does not exist. That is
    // a real answer (zero), not a failure worth aborting the whole report for.
    return error?.code === 5 ? 0 : null;
  }
}

function verdict(cards, sources) {
  const peak = Math.max(cards, sources);
  if (peak < COMFORTABLE) {
    return `Under ${COMFORTABLE}. The complete-collection reads are fine. No action; re-measure in a year.`;
  }
  if (peak < NOTICEABLE) {
    return `Between ${COMFORTABLE} and ${NOTICEABLE}. Noticeable on phones, not broken. Paginate the Library and Cards list views; leave search alone.`;
  }
  return `Over ${NOTICEABLE}. Search and per-row counts need real structure -- a search index or stored summaries, planned separately.`;
}

async function main() {
  loadEnvLocal();
  const projectId = initAdmin();
  const db = getFirestore();
  const email = process.argv[2] ?? "jarems421@gmail.com";

  let user;
  try {
    user = await getAuth().getUserByEmail(email);
  } catch {
    console.error(`No account found for ${email}.`);
    process.exit(1);
  }

  console.log(`\nProject : ${projectId}`);
  console.log(`Account : ${email} (${user.uid})`);
  console.log(`Measured: ${new Date().toISOString()}\n`);

  const cards = await countOrNull(
    db.collection("cards").where("userId", "==", user.uid)
  );
  const decks = await countOrNull(
    db.collection("decks").where("userId", "==", user.uid)
  );

  const rows = [
    ["cards", cards],
    ["decks", decks],
  ];
  for (const name of USER_COLLECTIONS) {
    rows.push([
      name,
      await countOrNull(db.collection("users").doc(user.uid).collection(name)),
    ]);
  }

  const width = Math.max(...rows.map(([name]) => name.length));
  for (const [name, count] of rows) {
    const shown = count === null ? "unavailable" : count.toLocaleString();
    console.log(`  ${name.padEnd(width)}  ${shown.padStart(9)}`);
  }

  // Per-deck card counts drive the row counts that currently scan the whole
  // owned card set, so the largest deck is the one that matters.
  if (decks) {
    const deckDocs = await db
      .collection("decks")
      .where("userId", "==", user.uid)
      .select("name")
      .get();
    const counts = [];
    for (const deck of deckDocs.docs) {
      counts.push({
        name: deck.data().name ?? deck.id,
        count:
          (await countOrNull(
            db
              .collection("cards")
              .where("userId", "==", user.uid)
              .where("deckId", "==", deck.id)
          )) ?? 0,
      });
    }
    counts.sort((a, b) => b.count - a.count);
    console.log("\n  Largest decks by card count:");
    for (const { name, count } of counts.slice(0, 5)) {
      console.log(`    ${String(count).padStart(6)}  ${name}`);
    }
  }

  const sources = rows.find(([name]) => name === "sources")?.[1] ?? 0;
  console.log(`\nVerdict: ${verdict(cards ?? 0, sources ?? 0)}\n`);
}

main().catch((error) => {
  console.error("Measurement failed:", error?.message ?? error);
  process.exit(1);
});
