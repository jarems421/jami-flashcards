import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  documents: new Map<string, Record<string, unknown>>(),
  verifyIdToken: vi.fn(async () => ({ uid: "user-1" })),
  checkBudget: vi.fn(),
  refundBudget: vi.fn(),
  startWorkflow: vi.fn(),
  cleanupRemnants: vi.fn(),
  cleanupTemporary: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("workflow/api", () => ({ start: mocks.startWorkflow }));
vi.mock("@/workflows/practice-paper-generation", () => ({
  generatePracticePaperWorkflow: vi.fn(),
}));
vi.mock("@/lib/ai/provider-router", () => ({
  isAnyAiProviderConfigured: () => true,
}));
vi.mock("@/services/ai/budgets", () => ({
  checkAiBudget: mocks.checkBudget,
  refundAiBudget: mocks.refundBudget,
  createAiBudgetLimitResponse: () => Response.json({ error: "limit" }, { status: 429 }),
}));
vi.mock("@/services/ai/practice-paper-workflow.server", () => ({
  cleanPracticePaperWorkflowRemnants: mocks.cleanupRemnants,
  cleanTemporaryPracticePaperSources: mocks.cleanupTemporary,
}));

function path(parts: string[]) {
  return parts.join("/");
}

function snapshot(ref: ReturnType<typeof reference>) {
  const data = mocks.documents.get(path(ref.parts));
  return {
    id: ref.parts.at(-1) ?? "",
    exists: Boolean(data),
    data: () => data,
    ref,
  };
}

function reference(parts: string[]): {
  parts: string[];
  collection: (name: string) => ReturnType<typeof collection>;
  get: () => Promise<ReturnType<typeof snapshot>>;
  update: (value: Record<string, unknown>) => Promise<void>;
  delete: () => Promise<void>;
} {
  return {
    parts,
    collection: (name) => collection([...parts, name]),
    get: async function () { return snapshot(this); },
    update: async function (value) {
      const key = path(parts);
      mocks.documents.set(key, { ...(mocks.documents.get(key) ?? {}), ...value });
    },
    delete: async function () { mocks.documents.delete(path(parts)); },
  };
}

function collection(parts: string[]) {
  return {
    doc: (id: string) => reference([...parts, id]),
    orderBy: () => ({
      limit: () => ({
        get: async () => ({
          docs: [...mocks.documents.entries()]
            .filter(([key]) => key.startsWith(`${path(parts)}/`))
            .map(([key, data]) => ({ id: key.split("/").at(-1), data: () => data })),
        }),
      }),
    }),
  };
}

vi.mock("@/services/firebase/admin", () => ({
  getAdminAuth: () => ({ verifyIdToken: mocks.verifyIdToken }),
  getAdminDb: () => ({
    collection: (name: string) => collection([name]),
    runTransaction: async (
      callback: (transaction: {
        get: (ref: ReturnType<typeof reference>) => Promise<ReturnType<typeof snapshot>>;
        create: (ref: ReturnType<typeof reference>, value: Record<string, unknown>) => void;
        update: (ref: ReturnType<typeof reference>, value: Record<string, unknown>) => void;
        delete: (ref: ReturnType<typeof reference>) => void;
      }) => Promise<unknown>
    ) => callback({
      get: async (ref) => snapshot(ref),
      create: (ref, value) => {
        const key = path(ref.parts);
        if (mocks.documents.has(key)) throw new Error("already exists");
        mocks.documents.set(key, value);
      },
      update: (ref, value) => {
        const key = path(ref.parts);
        mocks.documents.set(key, { ...(mocks.documents.get(key) ?? {}), ...value });
      },
      delete: (ref) => mocks.documents.delete(path(ref.parts)),
    }),
  }),
}));

const jobsRoute = await import("@/app/api/practice/paper-jobs/route");
const jobRoute = await import("@/app/api/practice/paper-jobs/[jobId]/route");
const clarifyRoute = await import("@/app/api/practice/paper-jobs/[jobId]/clarify/route");

const jobId = "job_key_12345678";
const folderPath = "users/user-1/studyFolders/folder-1";
const jobPath = `users/user-1/practicePaperJobs/${jobId}`;
const artifactPath = `users/user-1/practicePaperJobArtifacts/${jobId}`;

function request(
  method: string,
  body?: Record<string, unknown>,
  headers: Record<string, string> = {}
) {
  return new Request(`http://localhost/api/practice/paper-jobs/${jobId}`, {
    method,
    headers: {
      Authorization: "Bearer token",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }) as unknown as NextRequest;
}

function generationRequest() {
  return {
    folderId: "folder-1",
    request: "Create a full GCSE Biology paper",
    coverage: "Whole course",
    length: "full",
    focus: "balanced",
    focusDetail: "",
    timingMode: "timed",
    tutorEnabled: false,
    sourceIds: [],
  };
}

function queuedJob(overrides: Record<string, unknown> = {}) {
  return {
    paperId: "paper-1",
    folderId: "folder-1",
    status: "queued",
    stage: "queued",
    progress: 0,
    title: "Biology paper",
    request: generationRequest(),
    budgetGrant: {
      uid: "user-1",
      action: "practicePaperGeneration",
      dayKey: "2026-08-14",
      burstWindowStartedAt: 1,
      burstCharged: false,
    },
    budgetRefunded: false,
    cancellationRequested: false,
    retryCount: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("durable practice-paper job routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.documents.clear();
    mocks.documents.set(folderPath, { title: "Biology" });
    mocks.checkBudget.mockResolvedValue({
      allowed: true,
      grant: queuedJob().budgetGrant,
      reason: null,
      retryAfterSeconds: 0,
    });
    mocks.startWorkflow.mockResolvedValue({ runId: "workflow-run-1" });
  });

  it("reuses an idempotent queued job without double-charging or double-starting", async () => {
    mocks.documents.set(jobPath, queuedJob({
      providerModel: "must-not-leak",
      estimatedCostUsd: 12.34,
      budgetGrant: { secret: "must-not-leak" },
    }));

    const response = await jobsRoute.POST(request("POST", generationRequest(), {
      "x-idempotency-key": jobId,
    }));
    const payload = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ id: jobId, paperId: "paper-1", status: "queued" });
    expect(payload).not.toHaveProperty("request");
    expect(payload).not.toHaveProperty("budgetGrant");
    expect(payload).not.toHaveProperty("providerModel");
    expect(payload).not.toHaveProperty("estimatedCostUsd");
    expect(mocks.checkBudget).not.toHaveBeenCalled();
    expect(mocks.startWorkflow).not.toHaveBeenCalled();
  });

  it("queues one new workflow and persists only opaque identifiers in its invocation", async () => {
    const response = await jobsRoute.POST(request("POST", generationRequest(), {
      "x-idempotency-key": jobId,
    }));
    const payload = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(202);
    expect(payload).toMatchObject({ id: jobId, status: "queued", workflowRunId: "workflow-run-1" });
    expect(mocks.checkBudget).toHaveBeenCalledWith({
      uid: "user-1",
      action: "practicePaperGeneration",
      skipBurstLimit: true,
    });
    expect(mocks.startWorkflow).toHaveBeenCalledWith(expect.any(Function), ["user-1", jobId]);
    expect(mocks.documents.get(jobPath)).toMatchObject({
      status: "queued",
      workflowRunId: "workflow-run-1",
      request: generationRequest(),
    });
  });

  it("resumes a clarification on the same job and allowance without a second quota charge", async () => {
    mocks.documents.set(jobPath, queuedJob({
      status: "needs_clarification",
      clarificationQuestion: "Which specification?",
      completedAt: 2,
      retryCount: 0,
    }));
    mocks.documents.set(artifactPath, { generation: { stale: true } });

    const response = await clarifyRoute.POST(
      request("POST", { answer: "AQA GCSE Biology" }),
      { params: Promise.resolve({ jobId }) }
    );

    expect(response.status).toBe(202);
    expect(mocks.checkBudget).not.toHaveBeenCalled();
    expect(mocks.startWorkflow).toHaveBeenCalledWith(expect.any(Function), ["user-1", jobId]);
    expect(mocks.documents.has(artifactPath)).toBe(false);
    expect(mocks.documents.get(jobPath)).toMatchObject({
      status: "queued",
      retryCount: 1,
      workflowRunId: "workflow-run-1",
    });
    expect(JSON.stringify(mocks.documents.get(jobPath)?.request)).toContain("AQA GCSE Biology");
  });

  it("cancels between stages and refunds exactly once before provider work begins", async () => {
    mocks.documents.set(jobPath, queuedJob());

    const response = await jobRoute.DELETE(request("DELETE"), {
      params: Promise.resolve({ jobId }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "cancelled",
      cancellationRequested: true,
    });
    expect(mocks.refundBudget).toHaveBeenCalledOnce();
    expect(mocks.cleanupRemnants).toHaveBeenCalledWith("user-1", jobId);
    expect(mocks.cleanupTemporary).toHaveBeenCalledWith("user-1", jobId);

    const repeated = await jobRoute.DELETE(request("DELETE"), {
      params: Promise.resolve({ jobId }),
    });
    expect(repeated.status).toBe(200);
    expect(mocks.refundBudget).toHaveBeenCalledOnce();
  });

  it("does not refund an allowance after provider work has started", async () => {
    mocks.documents.set(jobPath, queuedJob({
      status: "running",
      stage: "designing",
      providerStartedAt: 10,
    }));

    const response = await jobRoute.DELETE(request("DELETE"), {
      params: Promise.resolve({ jobId }),
    });

    expect(response.status).toBe(200);
    expect(mocks.refundBudget).not.toHaveBeenCalled();
    expect(mocks.documents.get(jobPath)).toMatchObject({
      status: "cancelled",
      budgetRefunded: false,
    });
  });
});
