import { sleep } from "workflow";

const SLOT_RETRY_DELAY = "5s";

export async function markPracticePaperWorkflow(uid: string, jobId: string) {
  "use workflow";

  if (!(await ensureMarkingSlot(uid, jobId))) return { status: "cancelled" as const };
  try {
    if (await markingJobIsCancelled(uid, jobId)) return { status: "cancelled" as const };
    await prepareEvidence(uid, jobId);
    if (await markingJobIsCancelled(uid, jobId)) return { status: "cancelled" as const };
    const marked = await runMarking(uid, jobId);
    if (marked === "paused") return { status: "paused" as const };
    if (await markingJobIsCancelled(uid, jobId)) return { status: "cancelled" as const };
    await finalizeMarking(uid, jobId);
    return { status: "ready" as const };
  } catch {
    if (await markingJobIsCancelled(uid, jobId)) {
      return { status: "cancelled" as const };
    }
    await failMarking(uid, jobId);
    return { status: "failed" as const };
  } finally {
    await releaseMarkingSlot(jobId);
  }
}

async function ensureMarkingSlot(uid: string, jobId: string) {
  while (!(await claimMarkingSlot(uid, jobId))) {
    if (await markingJobIsCancelled(uid, jobId)) return false;
    await sleep(SLOT_RETRY_DELAY);
  }
  return true;
}

async function claimMarkingSlot(uid: string, jobId: string) {
  "use step";
  const { getAdminDb } = await import("@/services/firebase/admin");
  const db = getAdminDb();
  const controlRef = db.collection("aiWorkflowControl").doc("practicePaperMarking");
  const jobRef = db.collection("users").doc(uid).collection("practicePaperMarkingJobs").doc(jobId);
  const now = Date.now();
  const maximum = Math.max(1, Math.min(20, Number.parseInt(process.env.PRACTICE_PAPER_MARKING_JOB_CONCURRENCY ?? "4", 10) || 4));
  return db.runTransaction(async (transaction) => {
    const [control, job] = await Promise.all([transaction.get(controlRef), transaction.get(jobRef)]);
    if (!job.exists || job.data()?.cancellationRequested === true) return false;
    const raw = control.data()?.leases;
    const leases = raw && typeof raw === "object"
      ? Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter((entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] > now))
      : {};
    if (!leases[jobId] && Object.keys(leases).length >= maximum) return false;
    leases[jobId] = now + 35 * 60_000;
    transaction.set(controlRef, { leases, updatedAt: now }, { merge: true });
    transaction.update(jobRef, { status: "running", startedAt: job.data()?.startedAt ?? now, updatedAt: now });
    return true;
  });
}

async function releaseMarkingSlot(jobId: string) {
  "use step";
  const { getAdminDb } = await import("@/services/firebase/admin");
  const ref = getAdminDb().collection("aiWorkflowControl").doc("practicePaperMarking");
  await getAdminDb().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const leases = snapshot.data()?.leases && typeof snapshot.data()?.leases === "object"
      ? { ...snapshot.data()?.leases as Record<string, unknown> }
      : {};
    delete leases[jobId];
    transaction.set(ref, { leases, updatedAt: Date.now() }, { merge: true });
  });
}

async function markingJobIsCancelled(uid: string, jobId: string) {
  "use step";
  const { getAdminDb } = await import("@/services/firebase/admin");
  const snapshot = await getAdminDb().collection("users").doc(uid).collection("practicePaperMarkingJobs").doc(jobId).get();
  return !snapshot.exists || snapshot.data()?.cancellationRequested === true;
}

async function prepareEvidence(uid: string, jobId: string) {
  "use step";
  const service = await import("@/services/ai/practice-paper-marking-workflow.server");
  return service.prepareQueuedPracticePaperMarkingEvidence(uid, jobId);
}

async function runMarking(uid: string, jobId: string) {
  "use step";
  const service = await import("@/services/ai/practice-paper-marking-workflow.server");
  return service.runQueuedPracticePaperMarking(uid, jobId);
}

async function finalizeMarking(uid: string, jobId: string) {
  "use step";
  const service = await import("@/services/ai/practice-paper-marking-workflow.server");
  return service.finalizeQueuedPracticePaperMarking(uid, jobId);
}

async function failMarking(uid: string, jobId: string) {
  "use step";
  const service = await import("@/services/ai/practice-paper-marking-workflow.server");
  return service.markPracticePaperMarkingJobFailed(uid, jobId);
}
