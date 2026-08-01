import { beforeEach, describe, expect, it, vi } from "vitest";

const firestore = vi.hoisted(() => {
  type StoredDocument = { id: string; data: Record<string, unknown> };
  type CollectionRequest = { kind: "collection"; path: string };
  type Constraint =
    | { kind: "where"; field: string; operator: string; value: unknown }
    | { kind: "orderBy"; field: string; direction: "asc" | "desc" }
    | { kind: "limit"; count: number }
    | { kind: "startAfter"; values: unknown[] };
  type QueryRequest = {
    kind: "query";
    collection: CollectionRequest;
    constraints: Constraint[];
  };

  const collections = new Map<string, StoredDocument[]>();

  function makeSnapshot(document: StoredDocument) {
    return {
      id: document.id,
      data: () => document.data,
      exists: () => true,
      ref: { id: document.id },
    };
  }

  function compareValues(left: unknown, right: unknown) {
    if (left === right) return 0;
    if (typeof left === "number" && typeof right === "number") {
      return left < right ? -1 : 1;
    }
    return String(left) < String(right) ? -1 : 1;
  }

  function getField(document: StoredDocument, field: string) {
    return field === "__name__" ? document.id : document.data[field];
  }

  const getDocs = vi.fn(
    async (request: CollectionRequest | QueryRequest) => {
      const target =
        request.kind === "query" ? request.collection : request;
      const constraints =
        request.kind === "query" ? request.constraints : [];
      let documents = [...(collections.get(target.path) ?? [])];

      const filters = constraints.filter(
        (constraint): constraint is Extract<Constraint, { kind: "where" }> =>
          constraint.kind === "where"
      );
      documents = documents.filter((document) =>
        filters.every((filter) => {
          const value = getField(document, filter.field);
          if (filter.operator === "array-contains") {
            return Array.isArray(value) && value.includes(filter.value);
          }
          return value === filter.value;
        })
      );

      const ordering = constraints.filter(
        (constraint): constraint is Extract<Constraint, { kind: "orderBy" }> =>
          constraint.kind === "orderBy"
      );
      documents.sort((left, right) => {
        for (const order of ordering) {
          const difference = compareValues(
            getField(left, order.field),
            getField(right, order.field)
          );
          if (difference !== 0) {
            return order.direction === "desc" ? -difference : difference;
          }
        }
        return 0;
      });

      const cursor = constraints.find(
        (constraint): constraint is Extract<Constraint, { kind: "startAfter" }> =>
          constraint.kind === "startAfter"
      );
      if (cursor) {
        documents = documents.filter((document) => {
          for (let index = 0; index < ordering.length; index += 1) {
            const order = ordering[index];
            const difference = compareValues(
              getField(document, order.field),
              cursor.values[index]
            );
            if (difference !== 0) {
              const orderedDifference =
                order.direction === "desc" ? -difference : difference;
              return orderedDifference > 0;
            }
          }
          return false;
        });
      }

      const maximum = constraints.find(
        (constraint): constraint is Extract<Constraint, { kind: "limit" }> =>
          constraint.kind === "limit"
      )?.count;
      if (maximum !== undefined) documents = documents.slice(0, maximum);
      return { docs: documents.map(makeSnapshot) };
    }
  );

  const getDoc = vi.fn(async (request: { path: string }) => {
    const pathParts = request.path.split("/");
    const id = pathParts.pop() ?? "";
    const document = (collections.get(pathParts.join("/")) ?? []).find(
      (candidate) => candidate.id === id
    );
    return document
      ? makeSnapshot(document)
      : { id, data: () => ({}), exists: () => false, ref: { id } };
  });

  return {
    getDocs,
    getDoc,
    updateDoc: vi.fn(async () => undefined),
    deleteDoc: vi.fn(async () => undefined),
    reset() {
      collections.clear();
      getDocs.mockClear();
      getDoc.mockClear();
      this.updateDoc.mockClear();
      this.deleteDoc.mockClear();
    },
    setCollection(
      userId: string,
      collectionName: string,
      documents: StoredDocument[]
    ) {
      collections.set(`users/${userId}/${collectionName}`, documents);
    },
    countUnfilteredReads(userId: string, collectionName: string) {
      const path = `users/${userId}/${collectionName}`;
      return getDocs.mock.calls.filter(
        ([request]) => request.kind === "collection" && request.path === path
      ).length;
    },
  };
});

vi.mock("firebase/firestore", () => ({
  addDoc: vi.fn(async () => ({ id: "created" })),
  collection: (_database: unknown, ...segments: string[]) => ({
    kind: "collection",
    path: segments.join("/"),
  }),
  deleteDoc: firestore.deleteDoc,
  doc: (
    reference: { kind?: string; path?: string },
    ...segments: string[]
  ) => ({
    path:
      reference.kind === "collection"
        ? `${reference.path}/${segments.join("/")}`
        : segments.join("/"),
  }),
  documentId: () => "__name__",
  getDoc: firestore.getDoc,
  getDocs: firestore.getDocs,
  increment: (value: number) => value,
  limit: (count: number) => ({ kind: "limit", count }),
  orderBy: (field: string, direction: "asc" | "desc" = "asc") => ({
    kind: "orderBy",
    field,
    direction,
  }),
  query: (collection: unknown, ...constraints: unknown[]) => ({
    kind: "query",
    collection,
    constraints,
  }),
  runTransaction: vi.fn(),
  startAfter: (...values: unknown[]) => ({ kind: "startAfter", values }),
  updateDoc: firestore.updateDoc,
  where: (field: string, operator: string, value: unknown) => ({
    kind: "where",
    field,
    operator,
    value,
  }),
  writeBatch: () => ({
    commit: vi.fn(async () => undefined),
    delete: vi.fn(),
    set: vi.fn(),
    update: vi.fn(),
  }),
}));
vi.mock("@/services/firebase/client", () => ({ db: {} }));
vi.mock("@/services/firebase/firestore", () => ({
  withTimeout: <T>(request: Promise<T>) => request,
}));
vi.mock("@/services/dashboard/cache", () => ({
  invalidateDashboardData: vi.fn(),
}));

const folders = await import("@/services/study/folders");
const notebooks = await import("@/services/study/notebooks");
const sources = await import("@/services/study/sources");
const topics = await import("@/services/study/topics");
const { invalidateLegacyActiveRecords } = await import(
  "@/services/study/active-compatibility"
);

function record(
  id: string,
  updatedAt: number,
  data: Record<string, unknown> = {}
) {
  return { id, data: { title: id, name: id, updatedAt, ...data } };
}

beforeEach(() => {
  firestore.reset();
  for (const userId of ["folder-user", "notebook-user", "source-user", "topic-user"]) {
    for (const collectionName of ["studyFolders", "notebooks", "sources", "topics"]) {
      invalidateLegacyActiveRecords(userId, collectionName);
    }
  }
});

describe("active data lifecycle compatibility", () => {
  it("merges legacy folders into stable cursor pages without returning archived folders", async () => {
    firestore.setCollection("folder-user", "studyFolders", [
      record("archived", 400, { archived: true }),
      record("legacy-new", 300),
      record("current-new", 250, { archived: false }),
      record("legacy-old", 200),
      record("current-old", 150, { archived: false }),
    ]);

    const first = await folders.getActiveStudyFoldersPage("folder-user", {
      pageSize: 2,
    });
    const second = await folders.getActiveStudyFoldersPage("folder-user", {
      pageSize: 2,
      cursor: first.nextCursor,
    });

    expect(first.items.map((item) => item.id)).toEqual([
      "legacy-new",
      "current-new",
    ]);
    expect(second.items.map((item) => item.id)).toEqual([
      "legacy-old",
      "current-old",
    ]);
    expect(second.nextCursor).toBeNull();
    expect(firestore.countUnfilteredReads("folder-user", "studyFolders")).toBe(1);
  });

  it("includes recent legacy notebooks and scopes folder compatibility by membership", async () => {
    firestore.setCollection("notebook-user", "notebooks", [
      record("archived", 500, { archived: true, folderId: "folder-a" }),
      record("legacy-other", 400, { folderId: "folder-b" }),
      record("legacy", 300, { folderId: "folder-a" }),
      record("current", 200, { archived: false, folderId: "folder-a" }),
      record("current-old", 100, { archived: false, folderId: "folder-a" }),
    ]);

    const recent = await notebooks.getRecentActiveNotebooks("notebook-user", 2);
    const firstFolderPage = await notebooks.getNotebooksForFolderPage(
      "notebook-user",
      "folder-a",
      { pageSize: 2 }
    );
    const secondFolderPage = await notebooks.getNotebooksForFolderPage(
      "notebook-user",
      "folder-a",
      { pageSize: 2, cursor: firstFolderPage.nextCursor }
    );

    expect(recent.map((item) => item.id)).toEqual(["legacy-other", "legacy"]);
    expect(firstFolderPage.items.map((item) => item.id)).toEqual([
      "legacy",
      "current",
    ]);
    expect(secondFolderPage.items.map((item) => item.id)).toEqual([
      "current-old",
    ]);
  });

  it("keeps legacy sources visible in global, folder and dashboard reads", async () => {
    firestore.setCollection("source-user", "sources", [
      record("archived", 500, { status: "archived", folderIds: ["folder-a"] }),
      record("legacy-other", 400, { folderIds: ["folder-b"] }),
      record("legacy", 300, { folderIds: ["folder-a"] }),
      record("current", 200, { status: "active", folderIds: ["folder-a"] }),
    ]);

    const active = await sources.getActiveSources("source-user");
    const firstFolderPage = await sources.getActiveSourcesForFolderPage(
      "source-user",
      "folder-a",
      { pageSize: 1 }
    );
    const secondFolderPage = await sources.getActiveSourcesForFolderPage(
      "source-user",
      "folder-a",
      { pageSize: 1, cursor: firstFolderPage.nextCursor }
    );
    const dashboard = await sources.getActiveSourcesForDashboard(
      "source-user",
      []
    );

    expect(active.map((item) => item.id)).toEqual([
      "legacy-other",
      "legacy",
      "current",
    ]);
    expect(firstFolderPage.items.map((item) => item.id)).toEqual(["legacy"]);
    expect(secondFolderPage.items.map((item) => item.id)).toEqual(["current"]);
    expect(dashboard.map((item) => item.id)).toEqual(["legacy-other"]);
  });

  it("uses the topic mapper's active default only for unrecognized legacy status", async () => {
    firestore.setCollection("topic-user", "topics", [
      record("merged", 500, { status: "merged" }),
      record("archived", 400, { status: "archived" }),
      record("legacy", 300),
      record("legacy-invalid", 200, { status: null }),
      record("current", 100, { status: "active" }),
    ]);

    const active = await topics.getActiveTopics("topic-user");

    expect(active.map((item) => item.id)).toEqual([
      "legacy",
      "legacy-invalid",
      "current",
    ]);
  });

  it("deduplicates compatibility scans and invalidates them after a write", async () => {
    firestore.setCollection("source-user", "sources", [
      record("legacy", 300),
      record("current", 200, { status: "active" }),
    ]);

    await Promise.all([
      sources.getActiveSources("source-user"),
      sources.getActiveSources("source-user"),
    ]);
    expect(firestore.countUnfilteredReads("source-user", "sources")).toBe(1);

    await sources.updateSource("source-user", "legacy", { title: "Renamed" });
    await sources.getActiveSources("source-user");

    expect(firestore.countUnfilteredReads("source-user", "sources")).toBe(2);
  });
});
