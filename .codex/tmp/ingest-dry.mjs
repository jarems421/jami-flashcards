import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
const BASE = "https://jami-jarems421s-projects.vercel.app";
initializeApp({ credential: cert({
  projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
  clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
  privateKey: (process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? "").replace(/\n/g, "\n"),
}) });
const custom = await getAuth().createCustomToken("Q86gYH4MuDPcfaAkRTPYhO5LRVr1");
const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}`,
  { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: custom, returnSecureToken: true }) });
const idToken = (await r.json()).idToken;

const manifest = {
  board: "pearson_edexcel", boardLabel: "Pearson Edexcel", qualification: "gcse",
  specificationId: "1MA1",
  specificationTitle: "Pearson Edexcel Level 1/Level 2 GCSE in Mathematics (1MA1)",
  specificationVersion: "1", subject: "Mathematics", studyLevel: "gcse-equivalent",
  componentCode: "1MA1/1H", componentTitle: "Paper 1 (Non-Calculator) Higher",
  year: 2023, series: "June", paperReference: "1MA1/1H", activeFrom: Date.now() - 1000,
  questionPaperUrl: "https://qualifications.pearson.com/content/dam/pdf/GCSE/Mathematics/2015/Exam-materials/1ma1-1h-que-20230520.pdf",
  markSchemeUrl: "https://qualifications.pearson.com/content/dam/pdf/GCSE/Mathematics/2015/Exam-materials/1ma1-1h-rms-20230824.pdf",
  rightsKey: "pearson_edexcel-2026", rightsVersion: 1,
};

console.log("DRY RUN: Edexcel GCSE Maths 1MA1/1H, June 2023 — writes nothing\n");
const started = Date.now();
const res = await fetch(`${BASE}/api/internal/exam-questions/ingest`, {
  method: "POST", headers: { "content-type": "application/json", "x-jami-firebase-id-token": idToken },
  body: JSON.stringify({ manifest, dryRun: true }),
});
const data = await res.json().catch(() => null);
console.log("http", res.status, `(${((Date.now() - started) / 1000).toFixed(0)}s)\n`);
console.log(JSON.stringify(data, null, 2).slice(0, 4000));
process.exit(0);
