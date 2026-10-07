// @vitest-environment jsdom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Source } from "@/lib/material/sources";
import { usePracticePaperMaterial } from "@/hooks/usePracticePaperMaterial";

vi.mock("@/services/study/sources", () => ({
  getActiveSources: vi.fn(async () => []),
  getActiveSourcesForFolderPage: vi.fn(),
  updateSource: vi.fn(async () => undefined),
}));
vi.mock("@/services/study/source-upload", () => ({ createUploadedSource: vi.fn() }));

const { getActiveSourcesForFolderPage } = await import("@/services/study/sources");
const { createUploadedSource } = await import("@/services/study/source-upload");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function source(id: string, folderId: string): Source {
  return {
    id,
    title: `Notes ${id}`,
    type: "manual_note",
    folderIds: [folderId],
    topicIds: [],
    status: "active",
    createdBy: "student",
    createdAt: 1,
    updatedAt: 1,
  };
}

const feedback = { clear: () => undefined, showError: () => undefined, showThrownError: () => undefined };

type Material = ReturnType<typeof usePracticePaperMaterial>;

let container: HTMLDivElement;
let root: Root;
let material: Material;

function Harness({ folderId }: { folderId: string }) {
  const value = usePracticePaperMaterial({ userId: "student", folderId, feedback });
  useEffect(() => {
    material = value;
  });
  return null;
}

async function show(folderId: string) {
  await act(async () => {
    root.render(<Harness folderId={folderId} />);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  const folderSources: Record<string, Source[]> = {
    "folder-1": [source("notes-1", "folder-1")],
    "folder-2": [source("notes-2a", "folder-2"), source("notes-2b", "folder-2")],
  };
  vi.mocked(getActiveSourcesForFolderPage).mockImplementation(async (_userId, folderId) => ({
    items: folderSources[folderId] ?? [],
    nextCursor: null,
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("practice paper material", () => {
  it("keeps the folder the student moved to when an add in the last one finishes", async () => {
    type Uploaded = Awaited<ReturnType<typeof createUploadedSource>>;
    let finishUpload: (uploaded: Uploaded) => void = () => undefined;
    vi.mocked(createUploadedSource).mockImplementation(
      () => new Promise<Uploaded>((resolve) => (finishUpload = resolve))
    );
    await show("folder-1");

    let uploading: Promise<void> = Promise.resolve();
    await act(async () => {
      uploading = material.uploadMaterial([new File(["x"], "notes.pdf")], "notes");
    });

    await show("folder-2");
    expect(material.sources.map((item) => item.id)).toEqual(["notes-2a", "notes-2b"]);
    await act(async () => {
      material.setMaterialIds(["notes-2b"]);
    });

    await act(async () => {
      finishUpload({
        id: "uploaded-1",
        title: "notes",
        fileName: "notes.pdf",
        fileType: "application/pdf",
        sizeBytes: 1,
        storagePath: "users/student/sourceFiles/uploaded-1/notes.pdf",
      });
      await uploading;
    });

    expect(material.loadingSources).toBe(false);
    expect(material.sources.map((item) => item.id)).toEqual(["notes-2a", "notes-2b"]);
    expect(material.materialIds).toEqual(["notes-2b"]);
  });
});
