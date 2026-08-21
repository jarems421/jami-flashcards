import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  documents: new Map<string, Record<string, unknown>>(),
  storageObjects: new Set<string>(),
  deletedPrefixes: [] as string[],
  failStorageDeletion: false,
  verifyIdToken: vi.fn(async () => ({ uid: "user-1" })),
  cleanupTemporarySources: vi.fn(async () => undefined),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/services/ai/practice-paper-workflow.server", () => ({
  cleanTemporaryPracticePaperSources: mocks.cleanupTemporarySources,
}));

function path(parts: string[]) {
  return parts.join("/");
}

function directDocuments(parts: string[]) {
  const prefix = `${path(parts)}/`;
  return [...mocks.documents.entries()].filter(([key]) => {
    if (!key.startsWith(prefix)) return false;
    return key.slice(prefix.length).split("/").length === 1;
  });
}

function reference(parts: string[]): {
  parts: string[];
  path: string;
  id: string;
  collection: (name: string) => ReturnType<typeof collection>;
  get: () => Promise<ReturnType<typeof snapshot>>;
} {
  return {
    parts,
    path: path(parts),
    id: parts.at(-1) ?? "",
    collection: (name) => collection([...parts, name]),
    get: async function () { return snapshot(this); },
  };
}

function snapshot(ref: ReturnType<typeof reference>) {
  const data = mocks.documents.get(ref.path);
  return {
    id: ref.id,
    exists: Boolean(data),
    data: () => data,
    ref,
  };
}

function collection(parts: string[]) {
  return {
    doc: (id: string) => reference([...parts, id]),
    where: (field: string, operator: string, value: unknown) => {
      expect(operator).toBe("==");
      return {
        get: async () => ({
          docs: directDocuments(parts)
            .filter(([, data]) => data[field] === value)
            .map(([key]) => snapshot(reference(key.split("/")))),
        }),
      };
    },
  };
}

vi.mock("@/services/firebase/admin", () => ({
  getAdminAuth: () => ({ verifyIdToken: mocks.verifyIdToken }),
  getAdminDb: () => ({
    collection: (name: string) => collection([name]),
    batch: () => {
      const deleted: string[] = [];
      return {
        delete: (ref: ReturnType<typeof reference>) => deleted.push(ref.path),
        commit: async () => deleted.forEach((key) => mocks.documents.delete(key)),
      };
    },
  }),
  getAdminStorageBucket: () => ({
    deleteFiles: async ({ prefix }: { prefix: string }) => {
      mocks.deletedPrefixes.push(prefix);
      if (mocks.failStorageDeletion) throw new Error("storage unavailable");
      [...mocks.storageObjects]
        .filter((storagePath) => storagePath.startsWith(prefix))
        .forEach((storagePath) => mocks.storageObjects.delete(storagePath));
    },
  }),
}));

const { deletePracticePaperWithAdmin } = await import(
  "@/services/ai/practice-paper-deletion.server"
);
const paperRoute = await import("@/app/api/practice/papers/[paperId]/route");

const root = "users/user-1";
const paperId = "paper-1";

function seedPaper() {
  const records: Record<string, Record<string, unknown>> = {
    [`${root}/pastPapers/${paperId}`]: { notebookId: paperId, title: "Biology" },
    [`${root}/practicePaperSecrets/${paperId}`]: { paperId, markScheme: { items: [] } },
    [`${root}/notebooks/${paperId}`]: {
      type: "practice_paper",
      pastPaperId: paperId,
    },
    [`${root}/notebookPages/page-1`]: { notebookId: paperId },
    [`${root}/notebookPages/page-2`]: { notebookId: paperId },
    [`${root}/notebookPageInk/page-1`]: { notebookId: paperId },
    [`${root}/notebookPageInk/orphan-ink`]: { notebookId: paperId },
    [`${root}/notebookFiles/file-1`]: {
      notebookId: paperId,
      storagePath: `${root}/notebookFiles/${paperId}/paper.pdf`,
    },
    [`${root}/practicePaperAttempts/attempt-1`]: { paperId },
    [`${root}/practicePaperDeadlineSnapshots/snapshot-1`]: { paperId },
    [`${root}/practicePaperJobs/job-1`]: { paperId, temporarySourceIds: [] },
    [`${root}/practicePaperJobArtifacts/job-1`]: { generation: { complete: true } },
    [`${root}/practicePaperMarkingJobs/mark-job-1`]: { paperId, attemptId: "attempt-1" },
    [`${root}/practicePaperMarkingJobArtifacts/mark-job-1`]: { markingReady: true },
    [`${root}/practicePaperEvidence/attempt-1`]: { paperId, attemptId: "attempt-1" },
    [`${root}/notebooks/ordinary-notebook`]: { type: "blank" },
    [`${root}/practicePaperAttempts/unrelated-attempt`]: { paperId: "other-paper" },
  };
  Object.entries(records).forEach(([key, data]) => mocks.documents.set(key, data));
  mocks.storageObjects.add(`${root}/generatedPaperAssets/${paperId}/q1-chart.png`);
  mocks.storageObjects.add(`${root}/notebookFiles/${paperId}/paper.pdf`);
  mocks.storageObjects.add(`${root}/notebookFiles/${paperId}/jami-visual.webp`);
  mocks.storageObjects.add(`${root}/notebookImages/${paperId}/legacy-visual.webp`);
  mocks.storageObjects.add(`${root}/practicePaperMarkingEvidence/attempt-1/manifest.json`);
  mocks.storageObjects.add(`${root}/notebookFiles/ordinary-notebook/notes.pdf`);
}

function request(headers: Record<string, string> = {}) {
  return new Request(`http://localhost/api/practice/papers/${paperId}`, {
    method: "DELETE",
    headers,
  }) as unknown as NextRequest;
}

describe("formal practice-paper deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.documents.clear();
    mocks.storageObjects.clear();
    mocks.deletedPrefixes.length = 0;
    mocks.failStorageDeletion = false;
  });

  it("removes all paper-owned records and private assets, then becomes idempotent", async () => {
    seedPaper();

    const result = await deletePracticePaperWithAdmin("user-1", paperId);

    expect(result).toMatchObject({
      deleted: true,
      alreadyDeleted: false,
      paperId,
      notebookId: paperId,
    });
    expect(mocks.cleanupTemporarySources).toHaveBeenCalledWith("user-1", "job-1");
    expect([...mocks.documents.keys()].filter((key) => key.includes(paperId))).toEqual([]);
    expect(mocks.documents.has(`${root}/notebooks/ordinary-notebook`)).toBe(true);
    expect(mocks.documents.has(`${root}/practicePaperAttempts/unrelated-attempt`)).toBe(true);
    expect([...mocks.storageObjects]).toEqual([
      `${root}/notebookFiles/ordinary-notebook/notes.pdf`,
    ]);
    expect(mocks.deletedPrefixes).toEqual(expect.arrayContaining([
      `${root}/generatedPaperAssets/${paperId}/`,
      `${root}/notebookFiles/${paperId}/`,
      `${root}/notebookImages/${paperId}/`,
      `${root}/practicePaperMarkingEvidence/attempt-1/`,
    ]));

    const repeated = await deletePracticePaperWithAdmin("user-1", paperId);
    expect(repeated).toMatchObject({ deleted: true, alreadyDeleted: true });
  });

  it("does not remove identity records when storage cleanup fails", async () => {
    seedPaper();
    mocks.failStorageDeletion = true;

    await expect(deletePracticePaperWithAdmin("user-1", paperId)).rejects.toThrow(
      "storage unavailable"
    );
    expect(mocks.documents.has(`${root}/pastPapers/${paperId}`)).toBe(true);
    expect(mocks.documents.has(`${root}/notebooks/${paperId}`)).toBe(true);
  });

  it("refuses to hard-delete an ordinary notebook through the paper endpoint", async () => {
    mocks.documents.set(`${root}/notebooks/ordinary-notebook`, { type: "blank" });

    await expect(
      deletePracticePaperWithAdmin("user-1", "ordinary-notebook")
    ).rejects.toMatchObject({
      code: "invalid_paper_link",
      status: 409,
    });
    expect(mocks.documents.has(`${root}/notebooks/ordinary-notebook`)).toBe(true);
  });

  it("requires authentication before invoking server-owned deletion", async () => {
    seedPaper();

    const unauthorized = await paperRoute.DELETE(request(), {
      params: Promise.resolve({ paperId }),
    });
    expect(unauthorized.status).toBe(401);
    expect(mocks.documents.has(`${root}/pastPapers/${paperId}`)).toBe(true);

    const authorized = await paperRoute.DELETE(
      request({ Authorization: "Bearer token" }),
      { params: Promise.resolve({ paperId }) }
    );
    expect(authorized.status).toBe(200);
    expect(await authorized.json()).toMatchObject({ deleted: true, paperId });
  });
});
