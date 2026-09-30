import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CardImage } from "@/lib/study/card-images";
import type { OcclusionDiagram, OcclusionLabel } from "@/lib/study/image-occlusion";

const firestoreMock = vi.hoisted(() => ({
  addDoc: vi.fn(),
  collection: vi.fn(),
  deleteDoc: vi.fn(),
  deleteField: vi.fn(() => "DELETE_FIELD"),
  doc: vi.fn(),
  getDocs: vi.fn(),
  increment: vi.fn(),
  limit: vi.fn(),
  query: vi.fn(),
  updateDoc: vi.fn(),
  where: vi.fn(),
  writeBatch: vi.fn(),
}));

vi.mock("firebase/firestore", () => firestoreMock);
vi.mock("@/services/firebase/client", () => ({ db: {} }));
vi.mock("@/services/firebase/firestore", () => ({
  withTimeout: vi.fn(async (promise: Promise<unknown>) => await promise),
}));
vi.mock("@/services/dashboard/cache", () => ({
  invalidateAllDashboardData: vi.fn(),
  invalidateDashboardData: vi.fn(),
}));

const storage = vi.hoisted(() => ({
  deleteStorageFile: vi.fn(async () => undefined),
  uploadStorageFile: vi.fn(async () => undefined),
}));

vi.mock("@/services/firebase/storage-files", () => ({
  createStorageFileId: vi.fn(() => "new-id"),
  deleteStorageFile: storage.deleteStorageFile,
  getStorageFileDownloadUrl: vi.fn(async () => "https://files.test/image.png"),
  getStorageUploadErrorMessage: vi.fn(() => "upload failed"),
  sanitizeStorageFileName: vi.fn((name: string) => name),
  uploadStorageFile: storage.uploadStorageFile,
}));

const { releaseDiagramLabels, saveDiagram } = await import("@/services/study/image-occlusion");

const USER = "user-1";
const OLD_IMAGE: CardImage = { storagePath: `users/${USER}/cardImages/old/heart.png`, width: 1000, height: 800 };

function label(id: string, answer: string): OcclusionLabel {
  return { id, answer, shapes: [{ kind: "rect", x: 0.1, y: 0.1, width: 0.1, height: 0.05 }] };
}

const STORED: OcclusionDiagram = {
  id: "diagram-1",
  image: OLD_IMAGE,
  labelMode: "cover",
  hideOthers: true,
  labels: [label("a", "Aorta"), label("b", "Left atrium")],
};

type BatchMock = {
  set: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  commit: ReturnType<typeof vi.fn>;
};

let batches: BatchMock[] = [];
let nextId = 0;

function storedDocs(diagram: OcclusionDiagram, labelIds: string[]) {
  return {
    docs: labelIds.map((labelId) => ({
      id: `card-${labelId}`,
      data: () => ({
        userId: USER,
        deckId: "deck-1",
        front: "The heart",
        back: diagram.labels.find((entry) => entry.id === labelId)?.answer ?? "",
        tags: [],
        topicIds: ["topic-1"],
        createdAt: 5,
        stability: 12,
        occlusion: { diagram, labelId },
      }),
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  batches = [];
  nextId = 0;
  firestoreMock.collection.mockReturnValue({ path: "cards" });
  firestoreMock.doc.mockImplementation((...args: unknown[]) =>
    args.length >= 3 ? { id: String(args[2]) } : { id: `new-card-${++nextId}` }
  );
  firestoreMock.writeBatch.mockImplementation(() => {
    const batch: BatchMock = { set: vi.fn(), update: vi.fn(), delete: vi.fn(), commit: vi.fn(async () => undefined) };
    batches.push(batch);
    return batch;
  });
});

describe("saving a diagram", () => {
  it("writes a new diagram's cards in one batch, one per label, label 1 newest", async () => {
    firestoreMock.getDocs.mockResolvedValue({ docs: [] });
    const result = await saveDiagram({
      userId: USER,
      deckId: "deck-1",
      header: "  The heart ",
      topicIds: ["topic-1"],
      picture: { kind: "saved", image: OLD_IMAGE },
      labelMode: "cover",
      hideOthers: true,
      labels: [label("a", " Aorta "), label("b", "")],
    });

    expect(batches).toHaveLength(1);
    expect(batches[0].set).toHaveBeenCalledTimes(2);
    const written = batches[0].set.mock.calls.map((call) => call[1]);
    expect(written[0]).toMatchObject({ front: "The heart", back: "Aorta", topicIds: ["topic-1"] });
    expect(written[0].occlusion).toMatchObject({ labelId: "a", diagram: { id: "new-id", labels: [{ answer: "Aorta" }, { answer: "" }] } });
    expect(written[0].createdAt).toBeGreaterThan(written[1].createdAt);
    expect(result.cards.map((card) => card.occlusion?.labelId)).toEqual(["a", "b"]);
  });

  it("keeps each label's card and its schedule, deletes a removed label's card, and adds new ones", async () => {
    firestoreMock.getDocs.mockResolvedValue(storedDocs(STORED, ["a", "b"]));
    const result = await saveDiagram({
      userId: USER,
      deckId: "deck-1",
      diagramId: "diagram-1",
      header: "The heart",
      picture: { kind: "saved", image: OLD_IMAGE },
      labelMode: "cover",
      hideOthers: false,
      labels: [label("a", "Aorta"), label("c", "Vena cava")],
    });

    const batch = batches[0];
    expect(batch.update).toHaveBeenCalledTimes(1);
    expect(batch.update.mock.calls[0][0]).toEqual({ id: "card-a" });
    // Topics were not touched in the editor, so the kept card's are left alone.
    expect(batch.update.mock.calls[0][1]).not.toHaveProperty("topicIds");
    expect(batch.delete).toHaveBeenCalledWith({ id: "card-b" });
    expect(batch.set).toHaveBeenCalledTimes(1);
    // A new label takes its siblings' topics.
    expect(batch.set.mock.calls[0][1]).toMatchObject({ back: "Vena cava", topicIds: ["topic-1"] });
    expect(result.removedCardIds).toEqual(["card-b"]);
    const kept = result.cards.find((card) => card.id === "card-a");
    expect(kept?.stability).toBe(12);
    expect(kept?.occlusion?.diagram.hideOthers).toBe(false);
    // Same picture: nothing to delete from Storage.
    expect(storage.deleteStorageFile).not.toHaveBeenCalled();
  });

  it("uploads a new picture first and frees the one it replaced", async () => {
    firestoreMock.getDocs.mockResolvedValue(storedDocs(STORED, ["a", "b"]));
    const file = new File(["png"], "heart.png", { type: "image/png" });
    const result = await saveDiagram({
      userId: USER,
      deckId: "deck-1",
      diagramId: "diagram-1",
      header: "",
      picture: { kind: "new", file, width: 640, height: 480 },
      labelMode: "cover",
      hideOthers: true,
      labels: [label("a", "Aorta"), label("b", "Left atrium")],
    });

    expect(storage.uploadStorageFile).toHaveBeenCalledTimes(1);
    expect(result.diagram.image).toMatchObject({ width: 640, height: 480 });
    expect(result.diagram.image.storagePath).toMatch(`users/${USER}/cardImages/`);
    expect(storage.deleteStorageFile).toHaveBeenCalledWith(OLD_IMAGE.storagePath);
  });

  it("removes the upload again when the cards cannot be written", async () => {
    firestoreMock.getDocs.mockResolvedValue({ docs: [] });
    firestoreMock.writeBatch.mockImplementation(() => {
      const batch: BatchMock = {
        set: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        commit: vi.fn(async () => {
          throw new Error("offline");
        }),
      };
      batches.push(batch);
      return batch;
    });
    const file = new File(["png"], "heart.png", { type: "image/png" });
    await expect(
      saveDiagram({
        userId: USER,
        deckId: "deck-1",
        header: "",
        picture: { kind: "new", file, width: 640, height: 480 },
        labelMode: "cover",
        hideOthers: true,
        labels: [label("a", "Aorta")],
      })
    ).rejects.toThrow("offline");
    expect(storage.deleteStorageFile).toHaveBeenCalledTimes(1);
  });

  it("refuses an unnamed part before touching anything", async () => {
    await expect(
      saveDiagram({
        userId: USER,
        deckId: "deck-1",
        header: "",
        picture: { kind: "saved", image: OLD_IMAGE },
        labelMode: "name",
        hideOthers: true,
        labels: [label("a", "")],
      })
    ).rejects.toThrow(/needs a name/);
    expect(firestoreMock.getDocs).not.toHaveBeenCalled();
    expect(batches).toHaveLength(0);
  });
});

describe("tidying after deletes", () => {
  it("removes a deleted card's label from the cards that remain", async () => {
    firestoreMock.getDocs.mockResolvedValue(storedDocs(STORED, ["a"]));
    const deleted = {
      id: "card-b",
      deckId: "deck-1",
      userId: USER,
      front: "",
      back: "Left atrium",
      tags: [],
      createdAt: 1,
      occlusion: { diagram: STORED, labelId: "b" },
    };
    const { updates } = await releaseDiagramLabels(USER, [deleted]);
    expect(updates).toHaveLength(1);
    expect(batches[0].update).toHaveBeenCalledWith(
      { id: "card-a" },
      { occlusion: expect.objectContaining({ labelId: "a", diagram: expect.objectContaining({ labels: [STORED.labels[0]] }) }) }
    );
    expect(storage.deleteStorageFile).not.toHaveBeenCalled();
  });

  it("frees the picture when the last card goes", async () => {
    firestoreMock.getDocs.mockResolvedValue({ docs: [] });
    const deleted = {
      id: "card-a",
      deckId: "deck-1",
      userId: USER,
      front: "",
      back: "Aorta",
      tags: [],
      createdAt: 1,
      occlusion: { diagram: STORED, labelId: "a" },
    };
    await releaseDiagramLabels(USER, [deleted]);
    expect(storage.deleteStorageFile).toHaveBeenCalledWith(OLD_IMAGE.storagePath);
  });

  it("keeps a picture another diagram still shows", async () => {
    firestoreMock.getDocs
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [{ id: "other-card", data: () => ({ occlusion: { diagram: { id: "diagram-2" } } }) }] });
    const deleted = {
      id: "card-a",
      deckId: "deck-1",
      userId: USER,
      front: "",
      back: "Aorta",
      tags: [],
      createdAt: 1,
      occlusion: { diagram: STORED, labelId: "a" },
    };
    await releaseDiagramLabels(USER, [deleted]);
    expect(storage.deleteStorageFile).not.toHaveBeenCalled();
  });

  it("deletes a group card when every label it asked is gone", async () => {
    const grouped: OcclusionDiagram = { ...STORED, groups: [{ id: "g", name: "", labelIds: ["a", "b"] }] };
    firestoreMock.getDocs.mockResolvedValueOnce({
      docs: [
        {
          id: "card-g",
          data: () => ({ userId: USER, deckId: "deck-1", front: "", back: "", tags: [], createdAt: 1, occlusion: { diagram: grouped, groupId: "g" } }),
        },
      ],
    });
    const deleted = ["a", "b"].map((labelId) => ({
      id: `card-${labelId}`,
      deckId: "deck-1",
      userId: USER,
      front: "",
      back: "",
      tags: [],
      createdAt: 1,
      occlusion: { diagram: grouped, labelId },
    }));
    const result = await releaseDiagramLabels(USER, deleted);
    expect(result.deletedCardIds).toEqual(["card-g"]);
    expect(batches[0].delete).toHaveBeenCalledWith({ id: "card-g" });
  });

  it("reads nothing when no deleted card was a diagram", async () => {
    await releaseDiagramLabels(USER, [
      { id: "plain", deckId: "deck-1", userId: USER, front: "Q", back: "A", tags: [], createdAt: 1 },
    ]);
    expect(firestoreMock.getDocs).not.toHaveBeenCalled();
  });

  it("never throws: the cards are already gone", async () => {
    firestoreMock.getDocs.mockRejectedValue(new Error("offline"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const deleted = {
      id: "card-a",
      deckId: "deck-1",
      userId: USER,
      front: "",
      back: "Aorta",
      tags: [],
      createdAt: 1,
      occlusion: { diagram: STORED, labelId: "a" },
    };
    await expect(releaseDiagramLabels(USER, [deleted])).resolves.toEqual({ updates: [], deletedCardIds: [] });
    errors.mockRestore();
  });
});
