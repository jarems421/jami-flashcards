/**
 * Gives every account made before billing launches Lifetime access.
 *
 * docs/plans-and-stardust.md §8: everyone who joined before launch helped
 * build Jami and never pays. The plan lookup already reads a missing plan on
 * such an account as Lifetime, so this is the belt to that braces -- an
 * explicit record that survives any later change to how plans are resolved.
 *
 * Dry run by default: it lists who would be granted and writes nothing.
 *
 *   node --env-file-if-exists=.env.local scripts/grant-lifetime-access.mjs
 *   node --env-file-if-exists=.env.local scripts/grant-lifetime-access.mjs --apply
 *
 * Accounts made at or after BILLING_LAUNCH_AT are left alone, and so is any
 * account that already has a plan written (a paid plan is never overwritten).
 */
import process from "node:process";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const apply = process.argv.includes("--apply");

const rawLaunch = process.env.BILLING_LAUNCH_AT?.trim();
const launchAt = rawLaunch
  ? Number.isFinite(Number(rawLaunch))
    ? Number(rawLaunch)
    : Date.parse(rawLaunch)
  : NaN;
if (!Number.isFinite(launchAt)) {
  process.stdout.write(
    "Set BILLING_LAUNCH_AT (an ISO date or epoch milliseconds) before running this.\n"
  );
  process.exit(1);
}

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
const auth = getAuth();
const db = getFirestore();

let pageToken;
let granted = 0;
let skipped = 0;
do {
  const page = await auth.listUsers(1000, pageToken);
  for (const user of page.users) {
    const createdAt = Date.parse(user.metadata.creationTime);
    if (!Number.isFinite(createdAt) || createdAt >= launchAt) continue;
    const ref = db.doc(`users/${user.uid}/billing/plan`);
    const existing = await ref.get();
    if (existing.exists) {
      skipped += 1;
      process.stdout.write(`  keep    ${user.email ?? user.uid} (already ${existing.data()?.plan})\n`);
      continue;
    }
    granted += 1;
    process.stdout.write(`  ${apply ? "grant" : "would "} ${user.email ?? user.uid}\n`);
    if (apply) {
      await ref.set({
        plan: "lifetime",
        source: "lifetime",
        status: "active",
        periodAnchor: createdAt,
        grantedAt: Date.now(),
        grantedReason: "joined_before_launch",
      });
    }
  }
  pageToken = page.pageToken;
} while (pageToken);

process.stdout.write(
  `\n${apply ? "Granted" : "Would grant"} Lifetime to ${granted} account(s); ${skipped} already had a plan.\n` +
    (apply ? "" : "Nothing was written. Run again with --apply to write.\n")
);
