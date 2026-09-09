import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const BASE = "https://jami-jarems421s-projects.vercel.app";
const UID = "Q86gYH4MuDPcfaAkRTPYhO5LRVr1";

initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey: (process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? "").replace(/\n/g, "\n"),
  }),
});

const custom = await getAuth().createCustomToken(UID);
const exchange = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}`,
  { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: custom, returnSecureToken: true }) }
);
const session = await exchange.json();
if (!session.idToken) { console.log("TOKEN EXCHANGE FAILED:", JSON.stringify(session).slice(0, 300)); process.exit(1); }
const idToken = session.idToken;
console.log("signed in as reviewer\n");

const call = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-jami-firebase-id-token": idToken },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
};

const [board, spec] = [process.argv[2] ?? "aqa", process.argv[3] ?? "8300"];
if (process.argv.includes("--refresh")) {
  const qualification = process.argv.includes("--a-level") ? "a_level" : "gcse";
  console.log(`refreshing catalogue slice ${board} ${qualification} …`);
  const refreshed = await call("/api/internal/exam-formats/refresh", { board, qualification });
  console.log("  http", refreshed.status, JSON.stringify(refreshed.data).slice(0, 300));
}
console.log(`discover ${board} ${spec} …`);
const found = await call("/api/internal/exam-questions/discover", { board, specificationId: spec });
console.log("  http", found.status);
if (found.status !== 200) { console.log("  ", JSON.stringify(found.data).slice(0, 400)); process.exit(0); }
console.log("  course:", found.data.course?.subject, "|", found.data.course?.specificationTitle);
console.log("  manifests:", found.data.manifests.length, "| skipped:", found.data.discarded);
for (const m of found.data.manifests.slice(0, 5)) {
  console.log(`    - ${m.series} ${m.year} ${m.paperReference}  ${m.questionPaperUrl.slice(0, 90)}`);
}
