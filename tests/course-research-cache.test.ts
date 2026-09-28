import { beforeEach, describe, expect, it, vi } from "vitest";
import { Timestamp } from "firebase-admin/firestore";

/**
 * Sharing a course's research brief between students.
 *
 * The query is built only from a course's public terms, so every student
 * generating a paper for the same course asked the web the same question and
 * paid for their own answer. The cache must save that without ever serving a
 * weaker brief, a stale one, or one shaped by a student's own links.
 */

const generateGroundedResearch = vi.fn();
const store = new Map<string, Record<string, unknown>>();
const failReads = { value: false };

vi.mock("@/lib/ai/gemini", () => ({ generateGroundedResearch }));
vi.mock("@/services/firebase/admin", () => ({
  getAdminDb: () => ({
    collection: () => ({
      doc: (id: string) => ({
        get: async () => {
          if (failReads.value) throw new Error("firestore down");
          return { data: () => store.get(id) };
        },
        set: async (value: Record<string, unknown>) => {
          store.set(id, value);
        },
      }),
    }),
  }),
}));

const { researchCourseWithCache, readCachedResearch, COURSE_RESEARCH_TTL_MS } = await import(
  "@/services/ai/course-research-cache.server"
);

const brief = {
  ok: true as const,
  brief: "AQA GCSE Biology Paper 1: 1h 45m, 100 marks.",
  citations: [{ title: "aqa.org.uk", url: "https://www.aqa.org.uk/subjects/biology" }],
};
const query = "biology GCSE AQA official assessment specification exam format";
const NOW = 1_800_000_000_000;

describe("course research cache", () => {
  beforeEach(() => {
    generateGroundedResearch.mockReset();
    store.clear();
    failReads.value = false;
  });

  it("asks once per course and serves the next student the same brief", async () => {
    generateGroundedResearch.mockResolvedValueOnce(brief);

    const first = await researchCourseWithCache({ sanitizedQuery: query, urls: [], now: NOW });
    const second = await researchCourseWithCache({ sanitizedQuery: query, urls: [], now: NOW + 60_000 });

    expect(first).toEqual(brief);
    expect(second).toEqual(brief);
    expect(generateGroundedResearch).toHaveBeenCalledTimes(1);
  });

  it("asks again once the brief is a week old", async () => {
    generateGroundedResearch.mockResolvedValue(brief);

    await researchCourseWithCache({ sanitizedQuery: query, urls: [], now: NOW });
    await researchCourseWithCache({ sanitizedQuery: query, urls: [], now: NOW + COURSE_RESEARCH_TTL_MS + 1 });

    expect(generateGroundedResearch).toHaveBeenCalledTimes(2);
  });

  it("never shares research shaped by a student's own links", async () => {
    generateGroundedResearch.mockResolvedValue(brief);
    const urls = ["https://example.edu/my-module"];

    await researchCourseWithCache({ sanitizedQuery: query, urls, now: NOW });
    await researchCourseWithCache({ sanitizedQuery: query, urls, now: NOW });

    expect(generateGroundedResearch).toHaveBeenCalledTimes(2);
    expect(generateGroundedResearch).toHaveBeenCalledWith({ sanitizedQuery: query, urls });
    expect(store.size).toBe(0);
  });

  it("does not keep a brief that cites nothing, so a thin answer is not served for a week", async () => {
    generateGroundedResearch.mockResolvedValue({ ...brief, citations: [] });

    await researchCourseWithCache({ sanitizedQuery: query, urls: [], now: NOW });
    await researchCourseWithCache({ sanitizedQuery: query, urls: [], now: NOW });

    expect(generateGroundedResearch).toHaveBeenCalledTimes(2);
    expect(store.size).toBe(0);
  });

  it("does not keep a failure", async () => {
    generateGroundedResearch.mockResolvedValue({ ok: false, reason: "unavailable" });

    await expect(researchCourseWithCache({ sanitizedQuery: query, urls: [], now: NOW })).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(store.size).toBe(0);
  });

  it("falls through to asking when the cache cannot be read", async () => {
    failReads.value = true;
    generateGroundedResearch.mockResolvedValueOnce(brief);

    await expect(researchCourseWithCache({ sanitizedQuery: query, urls: [], now: NOW })).resolves.toEqual(brief);
  });

  it("does not store the query itself", async () => {
    generateGroundedResearch.mockResolvedValueOnce(brief);
    await researchCourseWithCache({ sanitizedQuery: query, urls: [], now: NOW });

    const [[key, value]] = [...store.entries()];
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(value)).not.toContain("official assessment specification");
  });

  it("refuses a stored entry that is expired or malformed", () => {
    const expiresAt = Timestamp.fromMillis(NOW + 1_000);
    expect(readCachedResearch(undefined, NOW)).toBeNull();
    expect(readCachedResearch({ brief: "x", citations: brief.citations, expiresAt }, NOW + 2_000)).toBeNull();
    expect(readCachedResearch({ brief: " ", citations: brief.citations, expiresAt }, NOW)).toBeNull();
    expect(readCachedResearch({ brief: "x", citations: [{ title: 1 }], expiresAt }, NOW)).toBeNull();
    expect(readCachedResearch({ brief: "x", citations: brief.citations, expiresAt }, NOW)).toEqual({
      ok: true,
      brief: "x",
      citations: brief.citations,
    });
  });
});
