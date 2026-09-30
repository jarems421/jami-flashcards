import PDFDocument from "pdfkit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { findSourceReferences } from "@/lib/ai/source-outline";

/**
 * An in-memory stand-in for the parts of the Admin SDK the indexer uses:
 * documents by path, batches, getAll, equality queries and a nearest-vector
 * search that ranks by cosine distance like Firestore's.
 */
const store = vi.hoisted(() => {
  const docs = new Map<string, Record<string, unknown>>();
  const files = new Map<string, Buffer>();

  type Snapshot = {
    id: string;
    ref: { path: string };
    exists: boolean;
    data: () => Record<string, unknown> | undefined;
  };
  const snapshot = (path: string, extra: Record<string, unknown> = {}): Snapshot => {
    const data = docs.get(path);
    return {
      id: path.split("/").at(-1) ?? "",
      ref: { path },
      exists: data !== undefined,
      data: () => (data ? { ...data, ...extra } : undefined),
    };
  };
  const vectorOf = (value: unknown) =>
    (value as { toArray?: () => number[] })?.toArray?.() ?? (value as number[]);
  const cosine = (left: number[], right: number[]) => {
    let dot = 0;
    let l = 0;
    let r = 0;
    left.forEach((value, index) => {
      dot += value * right[index];
      l += value * value;
      r += right[index] * right[index];
    });
    return 1 - dot / Math.sqrt(l * r);
  };

  const docRef = (path: string): Record<string, unknown> => ({
    path,
    id: path.split("/").at(-1),
    get: async () => snapshot(path),
    set: async (data: Record<string, unknown>) => void docs.set(path, data),
    update: async (data: Record<string, unknown>) =>
      void docs.set(path, { ...(docs.get(path) ?? {}), ...data }),
    delete: async () => void docs.delete(path),
    collection: (name: string) => collectionRef(`${path}/${name}`),
  });
  const children = (path: string) =>
    [...docs.keys()].filter(
      (key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes("/")
    );
  type Filter = { field: string; op: "==" | "in"; value: unknown };
  const matches = (path: string, filters: Filter[]) => {
    const data = docs.get(path) ?? {};
    return filters.every((filter) =>
      filter.op === "=="
        ? data[filter.field] === filter.value
        : (filter.value as unknown[]).includes(data[filter.field])
    );
  };
  const query = (path: string, filters: Filter[], max = Infinity): Record<string, unknown> => ({
    where: (field: string, op: "==" | "in", value: unknown) =>
      query(path, [...filters, { field, op, value }], max),
    limit: (next: number) => query(path, filters, next),
    get: async () => {
      const found = children(path).filter((key) => matches(key, filters)).slice(0, max);
      return { empty: found.length === 0, size: found.length, docs: found.map((key) => snapshot(key)) };
    },
    findNearest: (options: { queryVector: number[]; limit: number }) => ({
      get: async () => {
        const ranked = children(path)
          .filter((key) => matches(key, filters) && docs.get(key)?.embedding)
          .map((key) => ({ key, distance: cosine(options.queryVector, vectorOf(docs.get(key)?.embedding)) }))
          .sort((left, right) => left.distance - right.distance)
          .slice(0, options.limit);
        return { docs: ranked.map(({ key, distance }) => snapshot(key, { vectorDistance: distance })) };
      },
    }),
  });
  const collectionRef = (path: string) => ({
    ...query(path, []),
    doc: (id: string) => docRef(`${path}/${id}`),
  });
  const db = {
    collection: (name: string) => collectionRef(name),
    batch: () => {
      const operations: Array<() => void> = [];
      return {
        set: (ref: { path: string }, data: Record<string, unknown>) =>
          operations.push(() => docs.set(ref.path, data)),
        delete: (ref: { path: string }) => operations.push(() => docs.delete(ref.path)),
        commit: async () => operations.forEach((operation) => operation()),
      };
    },
    getAll: async (...refs: Array<{ path: string }>) => refs.map((ref) => snapshot(ref.path)),
  };
  return { docs, files, db };
});

vi.mock("@/services/firebase/admin", () => ({
  getAdminDb: () => store.db,
  getAdminStorageBucket: () => ({
    file: (path: string) => ({ download: async () => [store.files.get(path)] }),
  }),
}));

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { vector: (values: number[]) => ({ toArray: () => values }) },
}));

vi.mock("@/lib/ai/provider-policy", () => ({
  resolveAiProviderPolicy: () => ({ geminiReady: true }),
}));

/**
 * Embeddings that make the lecture a passage is from matter: each lecture's
 * passages point one way, and a question points the way of whatever lecture
 * it mentions by topic -- here, always lecture 12's, so a search by meaning
 * alone would answer every question from lecture 12.
 */
vi.mock("@/lib/ai/gemini-embeddings", () => {
  const vectorFor = (text: string) => {
    const lecture = Number(text.match(/lecture (\d+)/i)?.[1] ?? 12);
    return Array.from({ length: 768 }, (_, index) => (index === lecture ? 1 : 0.01));
  };
  return {
    getConfiguredGeminiEmbeddingApiKey: () => "key",
    createGeminiEmbedding: async ({ parts }: { parts: Array<{ text?: string }> }) =>
      // The question embeds like lecture 12, whatever it says.
      parts[0]?.text?.startsWith("task:") ? vectorFor("lecture 12") : vectorFor(parts[0]?.text ?? ""),
    createGeminiEmbeddings: async ({ contents }: { contents: Array<Array<{ text: string }>> }) =>
      contents.map((parts) => {
        const body = parts[0].text.split("| text:")[1] ?? "";
        return vectorFor(body);
      }),
  };
});

function lecturePdf(lectures: number, slidesPerLecture: number) {
  return new Promise<Buffer>((resolve) => {
    const doc = new PDFDocument({ size: [960, 540], autoFirstPage: false });
    const parts: Buffer[] = [];
    doc.on("data", (part: Buffer) => parts.push(part));
    doc.on("end", () => resolve(Buffer.concat(parts)));
    for (let lecture = 1; lecture <= lectures; lecture += 1) {
      for (let slide = 0; slide < slidesPerLecture; slide += 1) {
        doc.addPage();
        doc.fontSize(32).text(slide === 0 ? `Lecture ${lecture}: Topic ${lecture}` : `Slide ${lecture}.${slide}`, 40, 30);
        doc.fontSize(12).text(
          `Material for lecture ${lecture}, slide ${slide}. `.repeat(40),
          40,
          100,
          { width: 880 }
        );
      }
    }
    doc.end();
  });
}

const UID = "user-1";
const SOURCE_PATH = `users/${UID}/sources/pack`;

beforeEach(async () => {
  store.docs.clear();
  store.files.clear();
  store.files.set("users/user-1/sourceFiles/pack/pack.pdf", await lecturePdf(14, 4));
  store.docs.set(SOURCE_PATH, {
    title: "Thermal physics pack",
    type: "file",
    fileName: "pack.pdf",
    fileType: "application/pdf",
    storagePath: "users/user-1/sourceFiles/pack/pack.pdf",
    status: "active",
    createdBy: UID,
    createdAt: 1,
    updatedAt: 1,
  });
});

describe("indexing a fourteen-lecture pack", () => {
  it("indexes every lecture, labels every passage, and stores the pack's contents", async () => {
    const { rebuildSourceIndex } = await import("@/services/ai/source-index.server");
    const result = await rebuildSourceIndex(UID, "pack");

    expect(result.sectionCount).toBe(14);
    const chunks = [...store.docs]
      .filter(([path]) => path.startsWith(`users/${UID}/sourceChunks/`))
      .map(([, data]) => data);
    expect(new Set(chunks.map((chunk) => chunk.sectionKey))).toEqual(
      new Set(Array.from({ length: 14 }, (_, index) => `lecture:${index + 1}`))
    );
    expect(chunks.find((chunk) => chunk.sectionKey === "lecture:14")?.sectionLabel).toBe(
      "Lecture 14: Topic 14"
    );
    const outline = store.docs.get(`users/${UID}/sourceOutlines/pack`) as {
      sections: Array<{ label: string; chunkStart: number; chunkEnd: number }>;
    };
    expect(outline.sections.map((section) => section.label)[3]).toBe("Lecture 4: Topic 4");
    expect(store.docs.get(SOURCE_PATH)).toMatchObject({
      indexStatus: "ready",
      indexVersion: 2,
      indexSectionCount: 14,
      indexTruncated: false,
    });
  });

  it("answers a question about lecture 4 from lecture 4, though the search prefers lecture 12", async () => {
    const { rebuildSourceIndex, retrieveTutorEvidence } = await import(
      "@/services/ai/source-index.server"
    );
    await rebuildSourceIndex(UID, "pack");
    const question = "In lecture 4, how does this work?";

    const evidence = await retrieveTutorEvidence({
      uid: UID,
      pinnedSourceIds: ["pack"],
      relatedSourceIds: [],
      query: question,
      references: findSourceReferences(question),
      focusText: question,
      pinnedLimit: 3,
      relatedLimit: 0,
    });

    const targeted = evidence?.passages.filter((passage) => passage.targeted) ?? [];
    expect(targeted.length).toBeGreaterThan(0);
    expect(targeted.every((passage) => passage.sectionLabel === "Lecture 4: Topic 4")).toBe(true);
    expect(targeted.every((passage) => typeof passage.distance === "number")).toBe(true);
    expect(evidence?.targets.get("pack")?.via).toBe("named");
    // The search on its own still runs, and here it found lecture 12.
    expect(
      evidence?.passages.some((passage) => !passage.targeted && passage.sectionKey === "lecture:12")
    ).toBe(true);
  });

  it("removes the contents with the index", async () => {
    const { rebuildSourceIndex, deleteSourceIndex } = await import("@/services/ai/source-index.server");
    await rebuildSourceIndex(UID, "pack");
    await deleteSourceIndex(UID, "pack");
    expect(store.docs.has(`users/${UID}/sourceOutlines/pack`)).toBe(false);
    expect([...store.docs.keys()].some((path) => path.includes("/sourceChunks/"))).toBe(false);
  });
});
