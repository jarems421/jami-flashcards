import { readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const RUN_ID = "3163ebb4-aba8-4f34-a4fd-2abfb7e9a4d9";
const REVIEWER_UID = "PPm4x6PcMMQiZlmEKJ8rHCeVMm63";
const BASE_URL = "https://jami-jarems421s-projects.vercel.app";
const raw = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
for (const line of raw.split(/\r?\n/)) {
  const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (!match || process.env[match[1]]) continue;
  process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
}
const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID?.trim();
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim();
const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.trim()?.replace(/\\n/g, "\n");
const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim();
if (!projectId || !clientEmail || !privateKey || !apiKey) throw new Error("Missing credentials.");
if (getApps().length === 0) initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const customToken = await getAuth().createCustomToken(REVIEWER_UID);
const signIn = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(apiKey)}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ token: customToken, returnSecureToken: true }),
});
const signedIn = await signIn.json();
if (!signIn.ok || typeof signedIn.idToken !== "string") throw new Error("Reviewer sign-in failed.");
if (process.argv.includes("--cancel")) {
  const cancelled = await fetch(`${BASE_URL}/api/internal/paper-quality/runs/${RUN_ID}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${signedIn.idToken}` },
  });
  const result = await cancelled.json().catch(() => null);
  if (!cancelled.ok) throw new Error(`Cancellation failed: ${JSON.stringify(result)}`);
  console.log(JSON.stringify({ runId: RUN_ID, cancelled: true }));
  process.exit(0);
}
const response = await fetch(`${BASE_URL}/api/internal/paper-quality/runs/${RUN_ID}`, {
  headers: { Authorization: `Bearer ${signedIn.idToken}` },
  cache: "no-store",
});
const detail = await response.json().catch(() => null);
if (!response.ok) throw new Error(`Run lookup failed: ${JSON.stringify(detail)}`);
const statuses = Object.fromEntries(
  [...new Set(detail.cases.map((item) => item.status))].map((status) => [
    status,
    detail.cases.filter((item) => item.status === status).length,
  ])
);
const creditResponse = await fetch("https://openrouter.ai/api/v1/credits", {
  headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
});
const creditPayload = await creditResponse.json().catch(() => null);
const remainingCredit = creditResponse.ok
  ? Number(creditPayload?.data?.total_credits) - Number(creditPayload?.data?.total_usage)
  : null;
console.log(JSON.stringify({
  runId: RUN_ID,
  status: detail.run.status,
  completedCases: detail.run.completedCases,
  expectedCases: detail.run.expectedCases,
  estimatedCostUsd: detail.run.estimatedCostUsd,
  remainingCredit: Number.isFinite(remainingCredit) ? Math.round(remainingCredit * 10_000) / 10_000 : null,
  activeCases: detail.cases.filter((item) => item.status === "running").map((item) => item.id),
  statuses,
  failures: detail.cases.filter((item) => item.status === "failed").map((item) => ({
    id: item.id,
    code: item.failureCode,
  })),
}, null, 2));
