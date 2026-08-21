import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { spawnSync } from "node:child_process";

const deploymentId = "dpl_Fyt54MxHnpHZEEa1HcxtwbHt6ZL2";
const reviewerUid = "PPm4x6PcMMQiZlmEKJ8rHCeVMm63";
const profileIds = [
  "aqa-gcse-mathematics-8300-1h",
  "aqa-a-level-psychology-7182-1",
  "pearson-gcse-english-language-1en2-01",
  "pearson-a-level-mathematics-9ma0-01",
  "ocr-gcse-computer-science-j277-02",
  "ocr-a-level-biology-h420-03",
  "eduqas-gcse-geography-b-c112u10",
  "eduqas-a-level-english-literature-a720u10",
  "wjec-gcse-history-2026-unit-1",
  "wjec-a-level-chemistry-a2-first-written",
  "ccea-gcse-english-language-unit-1",
  "ccea-gce-history-a2-unit-1",
];

const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
const privateKey = (process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? "").replace(/\\n/g, "\n");
const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
if (!projectId || !clientEmail || !privateKey || !apiKey) throw new Error("Local Firebase administration is not configured");

const app = getApps()[0] ?? initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const customToken = await getAuth(app).createCustomToken(reviewerUid);
const exchange = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(apiKey)}`,
  {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  },
);
const exchangePayload = await exchange.json();
if (!exchange.ok || !exchangePayload.idToken) throw new Error("Could not create a short-lived reviewer session");
const verifiedLocalToken = await getAuth(app).verifyIdToken(exchangePayload.idToken);
if (verifiedLocalToken.uid !== reviewerUid) throw new Error("Reviewer session resolved to the wrong Firebase user");
console.log(JSON.stringify({ stage: "token", ok: true, uid: verifiedLocalToken.uid }));
const commandEnvironment = { ...process.env, FIREBASE_REVIEWER_TOKEN: exchangePayload.idToken };

function vercelCurl(path, body) {
  const request = body
    ? ` -- --request POST --header "Authorization: Bearer %FIREBASE_REVIEWER_TOKEN%" --header "Content-Type: application/json" --data "{\\"profileId\\":\\"${body.profileId}\\"}"`
    : ` -- --header "Authorization: Bearer %FIREBASE_REVIEWER_TOKEN%"`;
  const result = spawnSync(
    "cmd.exe",
    ["/d", "/s", "/c", `npx vercel curl ${path} --deployment ${deploymentId}${request}`],
    { env: commandEnvironment, encoding: "utf8", timeout: 330_000 },
  );
  if (result.error) throw result.error;
  const output = result.stdout?.trim() ?? "";
  const payload = JSON.parse(output || "{}");
  return { ok: result.status === 0 && !payload.error, status: result.status ?? 1, payload, stderr: result.stderr };
}

const access = vercelCurl("/api/internal/exam-formats");
if (!access.ok) throw new Error(`Reviewer API access failed: ${String(access.payload?.error ?? access.stderr ?? access.status)}`);
console.log(JSON.stringify({ stage: "access", ok: true }));

for (const profileId of profileIds) {
  const startedAt = Date.now();
  const response = vercelCurl("/api/internal/exam-formats/refresh", { profileId });
  const payload = response.payload;
  console.log(JSON.stringify({
    stage: "profile",
    profileId,
    ok: response.ok,
    status: response.status,
    verificationStatus: payload?.profile?.verificationStatus,
    version: payload?.profile?.version,
    durationSeconds: Math.round((Date.now() - startedAt) / 100) / 10,
    error: response.ok ? undefined : String(payload?.error ?? response.stderr ?? "request_failed"),
  }));
}
