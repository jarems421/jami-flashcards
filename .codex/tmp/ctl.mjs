import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
initializeApp({ credential: cert({
  projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
  clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
  privateKey: (process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? "").replace(/\n/g, "\n"),
}) });
const snap = await getFirestore().collection("examFormatCatalogueControl").get();
for (const d of snap.docs) {
  const x = d.data();
  const age = x.updatedAt ? ((Date.now() - x.updatedAt) / 86400000).toFixed(1) + "d ago" : "never";
  console.log(`  ${d.id}: updated ${age}${x.lastRunAt ? `, cron last ran ${((Date.now()-x.lastRunAt)/86400000).toFixed(1)}d ago` : ""}${x.runs ? `, runs=${x.runs}` : ""}`);
}
process.exit(0);
