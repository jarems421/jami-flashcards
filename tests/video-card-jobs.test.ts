import { afterEach, describe, expect, it } from "vitest";
import { chooseVideoRoute, formatVideoTimestamp, getVideoCoverageCounts } from "@/lib/ai/video-card-jobs";

const original = { ...process.env };
afterEach(() => { process.env = { ...original }; });

describe("video card routing", () => {
  it("uses Qwen only for verified public short YouTube links", () => {
    expect(chooseVideoRoute({ sourceKind: "youtube", isPublic: true, durationSeconds: 300, qwenEnabled: true }).provider).toBe("openrouter");
    expect(chooseVideoRoute({ sourceKind: "youtube", isPublic: false, durationSeconds: 300, qwenEnabled: true }).provider).toBe("gemini");
    expect(chooseVideoRoute({ sourceKind: "upload", isPublic: true, durationSeconds: 60, qwenEnabled: true }).provider).toBe("gemini");
  });

  it("honours the five and twenty minute boundaries", () => {
    expect(chooseVideoRoute({ sourceKind: "youtube", isPublic: true, durationSeconds: 301, qwenEnabled: true })).toMatchObject({ model: "gemini-2.5-flash-lite", agentic: false });
    expect(chooseVideoRoute({ sourceKind: "upload", isPublic: false, durationSeconds: 1200, qwenEnabled: true })).toMatchObject({ model: "gemini-2.5-flash-lite", agentic: false });
    expect(chooseVideoRoute({ sourceKind: "youtube", isPublic: true, durationSeconds: 1201, qwenEnabled: false })).toMatchObject({ model: "gemini-3.5-flash-lite", agentic: true });
  });

  it("keeps the requested coverage and timestamp labels stable", () => {
    expect(getVideoCoverageCounts("thorough")).toEqual({ min: 20, max: 35, target: 28 });
    expect(formatVideoTimestamp(125)).toBe("2:05");
  });
});
