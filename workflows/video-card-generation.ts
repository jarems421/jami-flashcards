import { Timestamp } from "firebase-admin/firestore";

export async function generateVideoCardWorkflow(uid: string, jobId: string) {
  "use workflow";
  try {
    await runVideoGeneration(uid, jobId);
    return { status: "ready" as const };
  } catch {
    await failVideoGeneration(uid, jobId);
    return { status: "failed" as const };
  }
}

async function runVideoGeneration(uid: string, jobId: string) {
  "use step";
  const { generateVideoCardsForJob } = await import("@/services/ai/video-card-generation.server");
  await generateVideoCardsForJob(uid, jobId);
}

async function failVideoGeneration(uid: string, jobId: string) {
  "use step";
  const [{ getAdminDb, getAdminStorageBucket }] = await Promise.all([import("@/services/firebase/admin")]);
  const ref = getAdminDb().collection("users").doc(uid).collection("videoCardJobs").doc(jobId);
  const snapshot = await ref.get();
  const data = snapshot.data();
  if (!data || data.status === "cancelled") return;
  if (typeof data.storagePath === "string") await getAdminStorageBucket().file(data.storagePath).delete({ ignoreNotFound: true }).catch(() => undefined);
  const now = Date.now();
  await ref.update({ status: "failed", failureMessage: "Jami could not read that video. Check the link or file and try again.", completedAt: now, expiresAt: Timestamp.fromMillis(now + 24 * 60 * 60_000), updatedAt: now });
}
