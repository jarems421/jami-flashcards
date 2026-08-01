// @vitest-environment jsdom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Source } from "@/lib/material/sources";
import {
  useSourceManagement,
  type SourceManagementController,
} from "@/hooks/useSourceManagement";

const updateSource = vi.fn();
const deleteSource = vi.fn();
const deleteSourceFile = vi.fn();

vi.mock("@/services/study/sources", () => ({
  updateSource: (...args: unknown[]) => updateSource(...args),
  deleteSource: (...args: unknown[]) => deleteSource(...args),
}));

vi.mock("@/services/study/source-files", () => ({
  deleteSourceFile: (...args: unknown[]) => deleteSourceFile(...args),
}));

const source = {
  id: "source-1",
  title: "Wave notes",
  type: "file",
  status: "active",
  folderIds: [],
  topicIds: [],
  createdBy: "user-1",
  storagePath: "users/user-1/sources/source-1/notes.pdf",
  createdAt: 1,
  updatedAt: 1,
} satisfies Source;

const onChanged = vi.fn();
const onError = vi.fn();
let workflow: SourceManagementController;
let container: HTMLDivElement;
let root: Root;

function Harness() {
  const value = useSourceManagement({
    userId: "user-1",
    source,
    onChanged,
    onError,
  });
  useEffect(() => {
    workflow = value;
  });
  return null;
}

beforeEach(() => {
  updateSource.mockReset().mockResolvedValue(undefined);
  deleteSource.mockReset().mockResolvedValue(undefined);
  deleteSourceFile.mockReset().mockResolvedValue(undefined);
  onChanged.mockReset().mockResolvedValue(undefined);
  onError.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<Harness />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("useSourceManagement", () => {
  it("opens rename with the current title and persists the edited value", async () => {
    act(() => workflow.openRename());
    expect(workflow.renameOpen).toBe(true);
    expect(workflow.renameTitle).toBe("Wave notes");

    act(() => workflow.setRenameTitle("Wave summary"));
    await act(async () => workflow.saveRename());

    expect(updateSource).toHaveBeenCalledWith("user-1", "source-1", {
      title: "Wave summary",
    });
    expect(onChanged).toHaveBeenCalledWith("Source renamed.");
    expect(workflow.renameOpen).toBe(false);
  });

  it("archives only after the confirmation action runs", async () => {
    act(() => workflow.requestArchive());
    expect(workflow.confirmation).toBe("archive");
    expect(updateSource).not.toHaveBeenCalled();

    await act(async () => workflow.archive());
    expect(updateSource).toHaveBeenCalledWith("user-1", "source-1", {
      status: "archived",
    });
    expect(workflow.confirmation).toBeNull();
  });

  it("restores directly and tells the browser to return to active sources", async () => {
    await act(async () => workflow.restore());
    expect(updateSource).toHaveBeenCalledWith("user-1", "source-1", {
      status: "active",
    });
    expect(onChanged).toHaveBeenCalledWith("Source restored.", true);
  });

  it("deletes both the source record and its uploaded file", async () => {
    await act(async () => workflow.deleteEverywhere());
    expect(deleteSource).toHaveBeenCalledWith("user-1", "source-1");
    expect(deleteSourceFile).toHaveBeenCalledWith(source.storagePath);
    expect(onChanged).toHaveBeenCalledWith(
      "Source deleted from Sources and its folders."
    );
  });

  it("surfaces mutation failures without reporting success", async () => {
    updateSource.mockRejectedValue(new Error("offline"));
    await act(async () => workflow.archive());

    expect(onChanged).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(
      expect.any(Error),
      "Could not archive source."
    );
  });
});
