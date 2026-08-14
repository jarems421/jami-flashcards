import { sleep } from "workflow";
import type { AiBudgetGrant } from "@/lib/ai/budgets";

type GenerationStepStatus =
  | "cancelled"
  | "needs_clarification"
  | "ready";

const SLOT_RETRY_DELAY = "5s";

async function ensurePracticePaperSlot(uid: string, jobId: string) {
  while (!(await claimPracticePaperSlot(uid, jobId))) {
    if (await jobIsCancelled(uid, jobId)) return false;
    await sleep(SLOT_RETRY_DELAY);
  }
  return true;
}

export async function generatePracticePaperWorkflow(
  uid: string,
  jobId: string
) {
  "use workflow";

  if (!(await ensurePracticePaperSlot(uid, jobId))) {
    await refundStoredJobBudget(uid, jobId, true);
    await cleanupPracticePaperRemnants(uid, jobId);
    await cleanupTemporarySources(uid, jobId);
    return { status: "cancelled" as const };
  }

  try {
    if (await jobIsCancelled(uid, jobId)) {
      await refundStoredJobBudget(uid, jobId, true);
      await cleanupPracticePaperRemnants(uid, jobId);
      await cleanupTemporarySources(uid, jobId);
      return { status: "cancelled" as const };
    }

    let status = await prepareResearch(uid, jobId);
    if (status !== "ready") {
      if (status === "cancelled") {
        await cleanupPracticePaperRemnants(uid, jobId);
        await cleanupTemporarySources(uid, jobId);
      }
      return { status };
    }
    if (!(await ensurePracticePaperSlot(uid, jobId))) {
      await cleanupPracticePaperRemnants(uid, jobId);
      await cleanupTemporarySources(uid, jobId);
      return { status: "cancelled" as const };
    }
    status = await generatePaperDraft(uid, jobId);
    if (status !== "ready") {
      if (status === "cancelled") {
        await cleanupPracticePaperRemnants(uid, jobId);
        await cleanupTemporarySources(uid, jobId);
      }
      return { status };
    }
    if (!(await ensurePracticePaperSlot(uid, jobId))) {
      await cleanupPracticePaperRemnants(uid, jobId);
      await cleanupTemporarySources(uid, jobId);
      return { status: "cancelled" as const };
    }
    status = await createPaperFigures(uid, jobId);
    if (status !== "ready") {
      if (status === "cancelled") {
        await cleanupPracticePaperRemnants(uid, jobId);
        await cleanupTemporarySources(uid, jobId);
      }
      return { status };
    }
    if (!(await ensurePracticePaperSlot(uid, jobId))) {
      await cleanupPracticePaperRemnants(uid, jobId);
      await cleanupTemporarySources(uid, jobId);
      return { status: "cancelled" as const };
    }
    status = await finalizePracticePaper(uid, jobId);
    if (status === "cancelled") await cleanupPracticePaperRemnants(uid, jobId);
    await cleanupTemporarySources(uid, jobId);
    return { status };
  } catch {
    await cleanupPracticePaperRemnants(uid, jobId);
    await cleanupTemporarySources(uid, jobId);
    await refundStoredJobBudget(uid, jobId, false);
    await markJobFailed(uid, jobId);
    return { status: "failed" as const };
  } finally {
    await releasePracticePaperSlot(jobId);
  }
}

async function claimPracticePaperSlot(uid: string, jobId: string) {
  "use step";
  const { getAdminDb } = await import("@/services/firebase/admin");
  const db = getAdminDb();
  const controlRef = db.collection("aiWorkflowControl").doc("practicePaperGeneration");
  const jobRef = db
    .collection("users")
    .doc(uid)
    .collection("practicePaperJobs")
    .doc(jobId);
  const now = Date.now();
  const maximum = Math.max(
    1,
    Math.min(
      20,
      Number.parseInt(process.env.PRACTICE_PAPER_JOB_CONCURRENCY ?? "4", 10) || 4
    )
  );
  return db.runTransaction(async (transaction) => {
    const [control, job] = await Promise.all([
      transaction.get(controlRef),
      transaction.get(jobRef),
    ]);
    if (!job.exists || job.data()?.cancellationRequested === true) return false;
    const rawLeases = control.data()?.leases;
    const leases = rawLeases && typeof rawLeases === "object"
      ? Object.fromEntries(
          Object.entries(rawLeases as Record<string, unknown>).filter(
            (entry): entry is [string, number] =>
              typeof entry[1] === "number" && entry[1] > now
          )
        )
      : {};
    if (!leases[jobId] && Object.keys(leases).length >= maximum) return false;
    // Each provider step is bounded below this lease. Reclaiming the slot at
    // every checkpoint renews it without allowing a stale run to block the
    // service indefinitely after a crash.
    leases[jobId] = now + 30 * 60_000;
    transaction.set(controlRef, { leases, updatedAt: now }, { merge: true });
    transaction.update(jobRef, {
      status: "running",
      stage: job.data()?.stage ?? "reading_sources",
      progress: job.data()?.progress ?? 12,
      startedAt: job.data()?.startedAt ?? now,
      updatedAt: now,
    });
    return true;
  });
}

async function releasePracticePaperSlot(jobId: string) {
  "use step";
  const { getAdminDb } = await import("@/services/firebase/admin");
  const db = getAdminDb();
  const controlRef = db.collection("aiWorkflowControl").doc("practicePaperGeneration");
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(controlRef);
    const rawLeases = snapshot.data()?.leases;
    if (!rawLeases || typeof rawLeases !== "object") return;
    const leases = { ...(rawLeases as Record<string, unknown>) };
    delete leases[jobId];
    transaction.set(
      controlRef,
      { leases, updatedAt: Date.now() },
      { merge: true }
    );
  });
}

async function jobIsCancelled(uid: string, jobId: string) {
  "use step";
  const { getAdminDb } = await import("@/services/firebase/admin");
  const snapshot = await getAdminDb()
    .collection("users")
    .doc(uid)
    .collection("practicePaperJobs")
    .doc(jobId)
    .get();
  return !snapshot.exists || snapshot.data()?.cancellationRequested === true;
}

async function prepareResearch(
  uid: string,
  jobId: string
): Promise<GenerationStepStatus> {
  "use step";
  const { prepareQueuedPracticePaperResearch } = await import(
    "@/services/ai/practice-paper-workflow.server"
  );
  return prepareQueuedPracticePaperResearch(uid, jobId);
}

async function generatePaperDraft(
  uid: string,
  jobId: string
): Promise<GenerationStepStatus> {
  "use step";
  const { generateQueuedPracticePaperDraft } = await import(
    "@/services/ai/practice-paper-workflow.server"
  );
  return generateQueuedPracticePaperDraft(uid, jobId);
}

async function createPaperFigures(
  uid: string,
  jobId: string
): Promise<GenerationStepStatus> {
  "use step";
  const { createQueuedPracticePaperFigures } = await import(
    "@/services/ai/practice-paper-workflow.server"
  );
  return createQueuedPracticePaperFigures(uid, jobId);
}

async function finalizePracticePaper(
  uid: string,
  jobId: string
): Promise<GenerationStepStatus> {
  "use step";
  const { finalizeQueuedPracticePaper } = await import(
    "@/services/ai/practice-paper-workflow.server"
  );
  return finalizeQueuedPracticePaper(uid, jobId);
}

async function cleanupPracticePaperRemnants(uid: string, jobId: string) {
  "use step";
  const { cleanPracticePaperWorkflowRemnants } = await import(
    "@/services/ai/practice-paper-workflow.server"
  );
  // Cleanup is best-effort and must not prevent the workflow from reaching a
  // durable terminal status that a later lifecycle sweep can recover from.
  await cleanPracticePaperWorkflowRemnants(uid, jobId).catch(() => undefined);
}

async function cleanupTemporarySources(uid: string, jobId: string) {
  "use step";
  const { cleanTemporaryPracticePaperSources } = await import(
    "@/services/ai/practice-paper-workflow.server"
  );
  await cleanTemporaryPracticePaperSources(uid, jobId).catch(() => undefined);
}

async function markJobFailed(uid: string, jobId: string) {
  "use step";
  const [{ getAdminDb }, { Timestamp }] = await Promise.all([
    import("@/services/firebase/admin"),
    import("firebase-admin/firestore"),
  ]);
  const now = Date.now();
  await getAdminDb()
    .collection("users")
    .doc(uid)
    .collection("practicePaperJobs")
    .doc(jobId)
    .update({
      status: "failed",
      failureCode: "generation_failed",
      failureMessage: "Jami could not finish that paper just now. Try again in a moment.",
      expiresAt: Timestamp.fromMillis(now + 30 * 24 * 60 * 60_000),
      completedAt: now,
      updatedAt: now,
    });
}

async function refundStoredJobBudget(
  uid: string,
  jobId: string,
  requireProviderNotStarted: boolean
) {
  "use step";
  const [{ getAdminDb }, budgets] = await Promise.all([
    import("@/services/firebase/admin"),
    import("@/services/ai/budgets"),
  ]);
  const db = getAdminDb();
  const jobRef = db
    .collection("users")
    .doc(uid)
    .collection("practicePaperJobs")
    .doc(jobId);
  let grant: AiBudgetGrant | undefined;
  const shouldRefund = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(jobRef);
    if (!snapshot.exists || snapshot.data()?.budgetRefunded === true) return false;
    if (requireProviderNotStarted && snapshot.data()?.providerStartedAt) return false;
    const candidate = snapshot.data()?.budgetGrant;
    if (!candidate || typeof candidate !== "object") return false;
    const data = candidate as Record<string, unknown>;
    if (
      typeof data.uid !== "string" ||
      typeof data.action !== "string" ||
      typeof data.dayKey !== "string" ||
      typeof data.burstWindowStartedAt !== "number"
    ) return false;
    grant = candidate as AiBudgetGrant;
    transaction.update(jobRef, { budgetRefunded: true, updatedAt: Date.now() });
    return true;
  });
  if (shouldRefund && grant) await budgets.refundAiBudget(grant);
}
