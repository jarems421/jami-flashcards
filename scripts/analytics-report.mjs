/**
 * Which of the app's features anybody actually opens.
 *
 * Read-only. This is the question the product has never been able to answer:
 * eleven destinations, a constellation, a tutor, video imports and practice
 * papers, and no way to tell which of them earn their keep. Nothing here is
 * clever -- it is counting -- but counting is what was missing.
 *
 *   node --env-file-if-exists=.env.local scripts/analytics-report.mjs [days]
 */
import process from "node:process";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const days = Math.max(1, Math.min(90, Number(process.argv[2] ?? 14)));

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
const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const snapshot = await db.collection("analyticsDaily").where("dayKey", ">=", since).get();

if (snapshot.empty) {
  process.stdout.write(
    `No usage recorded since ${since}.\n\n` +
      "Either nobody has opened the app since analytics shipped, or it has not\n" +
      "been deployed yet. It counts from the moment it is live; it cannot see\n" +
      "the past.\n"
  );
  process.exit(0);
}

const routes = new Map();
const events = new Map();
const activeDays = new Set();

for (const doc of snapshot.docs) {
  const data = doc.data();
  activeDays.add(String(data.dayKey ?? doc.id));

  for (const [key, count] of Object.entries(data.routes ?? {})) {
    const route = `/${String(key).replace(/~/g, "/")}`;
    routes.set(route, (routes.get(route) ?? 0) + Number(count ?? 0));
  }
  for (const [key, count] of Object.entries(data.events ?? {})) {
    const name = String(key).replace(/_/g, ".");
    events.set(name, (events.get(name) ?? 0) + Number(count ?? 0));
  }
}

const number = (value) => value.toLocaleString("en-GB");
const totalRouteViews = [...routes.values()].reduce((sum, value) => sum + value, 0);

process.stdout.write(`Usage since ${since} (${days} days, ${activeDays.size} with activity)\n\n`);
process.stdout.write(`  ${number(totalRouteViews)} page views\n\n`);

process.stdout.write("Where people go, most visited first\n");
const ranked = [...routes.entries()].sort((a, b) => b[1] - a[1]);
for (const [route, count] of ranked) {
  const share = totalRouteViews > 0 ? (count / totalRouteViews) * 100 : 0;
  const bar = "█".repeat(Math.max(1, Math.round(share / 2)));
  process.stdout.write(
    `  ${route.padEnd(34)} ${String(number(count)).padStart(6)}  ${share.toFixed(1).padStart(5)}%  ${bar}\n`
  );
}

process.stdout.write("\nWhat people do\n");
for (const [name, count] of [...events.entries()].sort((a, b) => b[1] - a[1])) {
  if (name === "route.view") continue;
  process.stdout.write(`  ${name.padEnd(34)} ${String(number(count)).padStart(6)}\n`);
}

/*
 * The question worth asking of this report: which routes are near the bottom.
 * A destination nobody opens is either badly placed or not worth keeping, and
 * until now there was no way to tell those apart from the ones that carry the
 * app.
 */
const unused = ranked.filter(([, count]) => count === 0);
const rare = ranked.slice(-3).filter(([, count]) => count > 0);
if (rare.length) {
  process.stdout.write(
    `\nLeast visited: ${rare.map(([route]) => route).join(", ")}\n` +
      "Worth asking whether these are badly placed or not worth keeping.\n"
  );
}
if (unused.length) {
  process.stdout.write(`Never opened at all: ${unused.map(([route]) => route).join(", ")}\n`);
}
