import { beforeEach, describe, expect, it, vi } from "vitest";

const service = vi.hoisted(() => ({
  prepareQueuedPracticePaperMarkingEvidence: vi.fn(),
  runQueuedPracticePaperMarking: vi.fn(),
  finalizeQueuedPracticePaperMarking: vi.fn(),
  markPracticePaperMarkingJobFailed: vi.fn(),
  cleanPracticePaperMarkingJobArtifacts: vi.fn(),
}));
const calls = vi.hoisted(() => ({ order: [] as string[] }));

vi.mock("workflow", () => ({ sleep: async () => undefined }));
vi.mock("@/services/ai/practice-paper-marking-workflow.server", () => service);
vi.mock("@/services/firebase/admin", () => {
  const snapshot = (data: Record<string, unknown> | undefined) => ({ exists: data !== undefined, data: () => data });
  const job = { path: "job", snapshot: snapshot({}) };
  const control = { path: "control", snapshot: snapshot({ leases: {} }) };
  const db = {
    collection: (name: string) =>
      name === "aiWorkflowControl"
        ? { doc: () => ({ ...control, get: async () => control.snapshot }) }
        : {
            doc: () => ({
              collection: () => ({ doc: () => ({ ...job, get: async () => job.snapshot }) }),
            }),
          },
    runTransaction: async (apply: (transaction: unknown) => Promise<unknown>) =>
      apply({
        get: async (ref: { snapshot: unknown }) => ref.snapshot,
        set: () => undefined,
        update: () => undefined,
      }),
  };
  return { getAdminDb: () => db };
});

const { markPracticePaperWorkflow } = await import("@/workflows/practice-paper-marking");

beforeEach(() => {
  calls.order = [];
  for (const [name, mock] of Object.entries(service)) {
    mock.mockReset();
    mock.mockImplementation(async () => {
      calls.order.push(name);
      return name === "runQueuedPracticePaperMarking" ? "marked" : undefined;
    });
  }
});

describe("markPracticePaperWorkflow", () => {
  it("clears the checkpoint once a mark is finished, and only after finalizing", async () => {
    await expect(markPracticePaperWorkflow("student", "job-1")).resolves.toEqual({ status: "ready" });
    expect(calls.order.slice(-2)).toEqual(["finalizeQueuedPracticePaperMarking", "cleanPracticePaperMarkingJobArtifacts"]);
  });

  it("keeps the checkpoint for a job that pauses, so its paid stages are kept for the retry", async () => {
    service.runQueuedPracticePaperMarking.mockResolvedValue("paused");
    await expect(markPracticePaperWorkflow("student", "job-1")).resolves.toEqual({ status: "paused" });
    expect(service.cleanPracticePaperMarkingJobArtifacts).not.toHaveBeenCalled();
  });

  it("keeps the checkpoint for a job that fails, so a retry resumes from it", async () => {
    service.runQueuedPracticePaperMarking.mockRejectedValue(new Error("provider down"));
    await expect(markPracticePaperWorkflow("student", "job-1")).resolves.toEqual({ status: "failed" });
    expect(service.markPracticePaperMarkingJobFailed).toHaveBeenCalled();
    expect(service.cleanPracticePaperMarkingJobArtifacts).not.toHaveBeenCalled();
  });

  it("never turns a finished mark into a failure when the cleanup cannot run", async () => {
    service.cleanPracticePaperMarkingJobArtifacts.mockRejectedValue(new Error("unavailable"));
    await expect(markPracticePaperWorkflow("student", "job-1")).resolves.toEqual({ status: "ready" });
    expect(service.markPracticePaperMarkingJobFailed).not.toHaveBeenCalled();
  });
});
