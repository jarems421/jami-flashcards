import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSource: vi.fn(),
  updateSource: vi.fn(),
  deleteSource: vi.fn(),
  uploadStorageFile: vi.fn(),
  deleteStorageFile: vi.fn(),
}));

vi.mock("@/services/study/sources", () => ({
  createSource: mocks.createSource,
  updateSource: mocks.updateSource,
  deleteSource: mocks.deleteSource,
}));

vi.mock("@/services/firebase/storage-files", () => ({
  createStorageFileId: () => "file-1",
  deleteStorageFile: mocks.deleteStorageFile,
  getStorageFileDownloadUrl: vi.fn(),
  getStorageUploadErrorMessage: (error: unknown) => (error instanceof Error ? error.message : "upload failed"),
  sanitizeStorageFileName: (name: string) => name,
  uploadStorageFile: mocks.uploadStorageFile,
}));

const { createFileSource } = await import("@/services/study/source-files");

const pdf = () => new File(["%PDF"], "Paper 1.pdf", { type: "application/pdf" });

describe("adding a file as a source", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSource.mockResolvedValue("source-1");
    mocks.updateSource.mockResolvedValue(undefined);
    mocks.deleteSource.mockResolvedValue(undefined);
    mocks.uploadStorageFile.mockResolvedValue(undefined);
    mocks.deleteStorageFile.mockResolvedValue(undefined);
  });

  it("makes the source in the folder, uploads the file, and attaches it", async () => {
    const created = await createFileSource({ userId: "u", file: pdf(), title: " ", folderIds: ["folder-1"] });

    expect(mocks.createSource).toHaveBeenCalledWith("u", expect.objectContaining({
      title: "Paper 1.pdf",
      type: "file",
      folderIds: ["folder-1"],
      fileType: "application/pdf",
    }));
    expect(created).toMatchObject({
      sourceId: "source-1",
      fileType: "application/pdf",
      storagePath: "users/u/sourceFiles/source-1/file-1-Paper 1.pdf",
    });
    expect(mocks.updateSource).toHaveBeenCalledWith("u", "source-1", expect.objectContaining({ storagePath: created.storagePath }));
  });

  it("undoes the upload and the source when attaching the file fails", async () => {
    mocks.updateSource.mockRejectedValue(new Error("offline"));

    await expect(createFileSource({ userId: "u", file: pdf(), title: "Paper 1", folderIds: [] })).rejects.toThrow("offline");
    expect(mocks.deleteStorageFile).toHaveBeenCalledWith("users/u/sourceFiles/source-1/file-1-Paper 1.pdf");
    expect(mocks.deleteSource).toHaveBeenCalledWith("u", "source-1");
  });

  it("refuses a file it cannot keep before making anything", async () => {
    const script = new File(["x"], "notes.js", { type: "application/javascript" });

    await expect(createFileSource({ userId: "u", file: script, title: "", folderIds: [] })).rejects.toThrow();
    expect(mocks.createSource).not.toHaveBeenCalled();
  });
});
