/**
 * Look up an account by a fragment of its email, and report what matches.
 *
 * Read-only on purpose. Anything that writes into a real person's account
 * should be pointed at a uid someone has actually looked at first, not at
 * whatever the first fuzzy email match happened to be.
 */
import { readFileSync } from "node:fs";

const raw = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
for (const line of raw.split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (!m || process.env[m[1]]) continue;
  process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { getAdminAuth, getAdminDb } = await import("../../services/firebase/admin.ts");

const needle = (process.argv[2] ?? "").toLowerCase();
if (!needle) {
  console.log("usage: node --conditions=react-server .codex/tmp/find-user.mjs <email fragment>");
  process.exit(1);
}

const auth = getAdminAuth();
const db = getAdminDb();
const matches = [];
let pageToken;

do {
  const page = await auth.listUsers(1000, pageToken);
  for (const user of page.users) {
    const email = (user.email ?? "").toLowerCase();
    const name = (user.displayName ?? "").toLowerCase();
    if (email.includes(needle) || name.includes(needle)) {
      matches.push(user);
    }
  }
  pageToken = page.pageToken;
} while (pageToken);

if (!matches.length) {
  console.log(`no account matches "${needle}"`);
  process.exit(0);
}

for (const user of matches) {
  const constellations = await db
    .collection("users")
    .doc(user.uid)
    .collection("constellations")
    .get();
  const stars = await db.collection("users").doc(user.uid).collection("stars").get();

  console.log("---");
  console.log("uid:        ", user.uid);
  console.log("email:      ", user.email);
  console.log("displayName:", user.displayName ?? "(none)");
  console.log("created:    ", user.metadata.creationTime);
  console.log("lastSignIn: ", user.metadata.lastSignInTime ?? "(never)");
  console.log(
    "sky:        ",
    `${constellations.size} constellation(s), ${stars.size} star(s)`
  );
  for (const doc of constellations.docs) {
    const data = doc.data();
    console.log(
      `              - "${data.name}" (${data.status ?? "active"}, ${data.starCount ?? 0} stars)`
    );
  }
}
process.exit(0);
