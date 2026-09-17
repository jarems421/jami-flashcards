import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireCachedImageUrl,
  clearCachedImageUrls,
} from "@/lib/practice/exam-private-image-cache";

let created = 0;
const revoked: string[] = [];

beforeEach(() => {
  created = 0;
  revoked.length = 0;
  vi.stubGlobal("URL", {
    createObjectURL: () => `blob:${(created += 1)}`,
    revokeObjectURL: (url: string) => revoked.push(url),
  });
});

afterEach(() => {
  clearCachedImageUrls();
  vi.unstubAllGlobals();
});

const blob = () => Promise.resolve({} as Blob);

describe("holding pages of the paper between page turns", () => {
  it("fetches a page once however often it is turned back to", async () => {
    const fetchBlob = vi.fn(blob);
    const first = acquireCachedImageUrl("/page-1", fetchBlob);
    expect(await first.url).toBe("blob:1");
    first.release();

    const again = acquireCachedImageUrl("/page-1", fetchBlob);
    expect(await again.url).toBe("blob:1");
    expect(fetchBlob).toHaveBeenCalledTimes(1);
    again.release();
  });

  /*
   * The page a student is writing on must never have its image pulled out from
   * under it, however many other pages they have looked at since.
   */
  it("never revokes a page something is still displaying", async () => {
    const held = acquireCachedImageUrl("/page-1", blob);
    await held.url;
    for (let index = 0; index < 40; index += 1) {
      const other = acquireCachedImageUrl(`/other-${index}`, blob);
      await other.url;
      other.release();
    }
    expect(revoked).not.toContain("blob:1");
  });

  it("lets go of pages nothing is using once there are too many", async () => {
    for (let index = 0; index < 40; index += 1) {
      const entry = acquireCachedImageUrl(`/page-${index}`, blob);
      await entry.url;
      entry.release();
    }
    expect(revoked.length).toBeGreaterThan(20);
    // The most recently released pages are the ones a student is turning
    // between, so those are the ones kept.
    expect(revoked).not.toContain("blob:40");
  });

  it("does not keep a fetch that failed, so a retry can really try again", async () => {
    const fetchBlob = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementation(blob);
    const failed = acquireCachedImageUrl("/page-1", fetchBlob);
    await expect(failed.url).rejects.toThrow("offline");
    failed.release();

    const retried = acquireCachedImageUrl("/page-1", fetchBlob);
    await expect(retried.url).resolves.toBe("blob:1");
    expect(fetchBlob).toHaveBeenCalledTimes(2);
    retried.release();
  });

  it("releases once however many times it is called", async () => {
    const held = acquireCachedImageUrl("/page-1", blob);
    await held.url;
    const other = acquireCachedImageUrl("/page-1", blob);
    await other.url;
    held.release();
    held.release();
    held.release();
    // The second holder is still displaying it, so nothing has been given up.
    for (let index = 0; index < 40; index += 1) {
      const filler = acquireCachedImageUrl(`/filler-${index}`, blob);
      await filler.url;
      filler.release();
    }
    expect(revoked).not.toContain("blob:1");
    other.release();
  });
});
