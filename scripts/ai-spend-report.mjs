/**
 * What the AI actually cost, per student and per feature.
 *
 * Read-only. The daily budgets cap how many requests somebody makes; this is
 * the other half of the question, and until now nothing answered it.
 *
 * Unpriced calls are reported separately rather than folded in as zero. Gemini
 * bills without reporting a cost, so until `AI_MODEL_PRICES_JSON` names its
 * models those calls show as tokens with no money against them -- which is the
 * honest reading, and visible enough to be worth fixing.
 *
 *   node --env-file-if-exists=.env.local scripts/ai-spend-report.mjs [days]
 */
import process from "node:process";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const days = Math.max(1, Math.min(90, Number(process.argv[2] ?? 7)));

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
const auth = getAuth();

const DAY_MS = 24 * 60 * 60 * 1000;
const since = new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10);

const snapshot = await db.collection("aiSpend").where("dayKey", ">=", since).get();

if (snapshot.empty) {
  process.stdout.write(
    `No AI spend recorded since ${since}.\n\n` +
      "Nothing has run through a metered path yet, or the meter has only just\n" +
      "been added. It records from the next request onwards; it cannot see the past.\n"
  );
  process.exit(0);
}

const money = (value) => `$${value.toFixed(4)}`;
const number = (value) => value.toLocaleString("en-GB");

const byUser = new Map();
const byAction = new Map();
const byModel = new Map();
let totalCost = 0;
let totalCalls = 0;
let totalUnpriced = 0;

for (const doc of snapshot.docs) {
  const data = doc.data();
  const uid = String(data.uid ?? "unknown");
  const cost = Number(data.costUsd ?? 0);
  const calls = Number(data.calls ?? 0);
  const unpriced = Number(data.unpricedCalls ?? 0);

  totalCost += cost;
  totalCalls += calls;
  totalUnpriced += unpriced;

  const user = byUser.get(uid) ?? { calls: 0, cost: 0, unpriced: 0 };
  byUser.set(uid, {
    calls: user.calls + calls,
    cost: user.cost + cost,
    unpriced: user.unpriced + unpriced,
  });

  for (const [action, count] of Object.entries(data.byAction ?? {})) {
    byAction.set(action, (byAction.get(action) ?? 0) + Number(count ?? 0));
  }
  for (const [model, entry] of Object.entries(data.byModel ?? {})) {
    const row = byModel.get(model) ?? { calls: 0, cost: 0, tokens: 0 };
    byModel.set(model, {
      calls: row.calls + Number(entry?.calls ?? 0),
      cost: row.cost + Number(entry?.costUsd ?? 0),
      tokens:
        row.tokens +
        Number(entry?.promptTokens ?? 0) +
        Number(entry?.completionTokens ?? 0),
    });
  }
}

process.stdout.write(`AI spend since ${since} (${days} days)\n\n`);
process.stdout.write(
  `  ${number(totalCalls)} calls, ${money(totalCost)} priced, ${number(totalUnpriced)} calls unpriced\n\n`
);

const emails = new Map();
await Promise.all(
  [...byUser.keys()].map(async (uid) => {
    try {
      emails.set(uid, (await auth.getUser(uid)).email ?? uid);
    } catch {
      emails.set(uid, uid);
    }
  })
);

process.stdout.write("Per student, most expensive first\n");
for (const [uid, row] of [...byUser.entries()].sort((a, b) => b[1].cost - a[1].cost)) {
  const perDay = row.cost / days;
  process.stdout.write(
    `  ${String(emails.get(uid)).padEnd(34)} ${money(row.cost).padStart(11)}  ` +
      `${money(perDay).padStart(11)}/day  ${String(number(row.calls)).padStart(6)} calls` +
      `${row.unpriced ? `  (${number(row.unpriced)} unpriced)` : ""}\n`
  );
}

process.stdout.write("\nPer feature\n");
for (const [action, calls] of [...byAction.entries()].sort((a, b) => b[1] - a[1])) {
  process.stdout.write(`  ${action.padEnd(28)} ${String(number(calls)).padStart(7)} calls\n`);
}

process.stdout.write("\nPer model\n");
for (const [model, row] of [...byModel.entries()].sort((a, b) => b[1].cost - a[1].cost)) {
  process.stdout.write(
    `  ${model.padEnd(44)} ${money(row.cost).padStart(11)}  ` +
      `${String(number(row.tokens)).padStart(12)} tokens  ${String(number(row.calls)).padStart(6)} calls\n`
  );
}

if (totalUnpriced > 0) {
  process.stdout.write(
    `\n${number(totalUnpriced)} calls have no price attached. Set AI_MODEL_PRICES_JSON, for example:\n` +
      `  {"gemini-2.5-flash-lite":{"in":0.10,"out":0.40}}\n` +
      "Values are US dollars per million tokens; the longest matching prefix wins.\n"
  );
}
