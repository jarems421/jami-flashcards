import { describe, expect, it, vi } from "vitest";
import { createNotebookPdfDocumentCache } from "@/lib/workspace/notebook-pdf-cache";

describe("notebook PDF document cache", () => {
  it("reuses a loaded document for the same storage path", async () => {
    const load = vi.fn(async (storagePath: string) => ({ storagePath }));
    const cache = createNotebookPdfDocumentCache(load);

    await expect(cache.get("users/alice/paper.pdf")).resolves.toEqual({
      storagePath: "users/alice/paper.pdf",
    });
    await cache.get("users/alice/paper.pdf");

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("drops failed loads so a retry can fetch the file again", async () => {
    const load = vi
      .fn<(storagePath: string) => Promise<{ storagePath: string }>>()
      .mockRejectedValueOnce(new Error("permission denied"))
      .mockImplementationOnce(async (storagePath) => ({ storagePath }));
    const cache = createNotebookPdfDocumentCache(load);

    await expect(cache.get("users/alice/paper.pdf")).rejects.toThrow(
      "permission denied"
    );
    await expect(cache.get("users/alice/paper.pdf")).resolves.toEqual({
      storagePath: "users/alice/paper.pdf",
    });

    expect(load).toHaveBeenCalledTimes(2);
  });

  it("evicts the least recently used path when the cache is full", async () => {
    const load = vi.fn(async (storagePath: string) => ({ storagePath }));
    const cache = createNotebookPdfDocumentCache(load, 2);

    await cache.get("one.pdf");
    await cache.get("two.pdf");
    await cache.get("one.pdf");
    await cache.get("three.pdf");
    await cache.get("two.pdf");

    expect(load).toHaveBeenCalledTimes(4);
  });
});
