import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
initializeApp({ credential: cert({
  projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
  clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
  privateKey: (process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? "").replace(/\n/g, "\n"),
}) });
const db = getFirestore();
const total = (await db.collection("examFormatCatalogue").count().get()).data().count;
console.log("examFormatCatalogue total:", total);
const snap = await db.collection("examFormatCatalogue").where("board", "==", "aqa").limit(300).get();
console.log("aqa entries:", snap.size);
const rows = snap.docs.map((d) => d.data());
const maths = rows.filter((r) => String(r.subject ?? "").toLowerCase().includes("math"));
console.log("\naqa maths/science sample:");
for (const r of [...maths, ...rows.filter((r) => /biolog|chemist|physic/i.test(String(r.subject ?? "")))].slice(0, 12)) {
  console.log(`  ${r.qualification} | ${r.subject} | spec=${r.specificationCode} | comp=${r.componentCode} | ${r.status}`);
}
console.log("\ndistinct aqa spec codes:", [...new Set(rows.map((r) => r.specificationCode))].slice(0, 30).join(", "));
process.exit(0);
