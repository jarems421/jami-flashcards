import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
initializeApp({ credential: cert({
  projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
  clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
  privateKey: (process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? "").replace(/\n/g, "\n"),
}) });
const snap = await getFirestore().collection("examFormatCatalogue").get();
for (const d of snap.docs) {
  const r = d.data();
  console.log(`  ${String(r.board).padEnd(17)} ${String(r.qualification).padEnd(8)} ${String(r.subject).padEnd(28)} spec=${String(r.specificationCode).padEnd(7)} comp=${String(r.componentCode).padEnd(6)} ${r.status}`);
}
process.exit(0);
