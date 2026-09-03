import { afterEach, describe, expect, it } from "vitest";
import { chooseVideoRoute, formatVideoTimestamp, getVideoCoverageCounts, getVideoSamplingFps } from "@/lib/ai/video-card-jobs";

const original = { ...process.env };
afterEach(() => { process.env = { ...original }; });

describe("video card routing", () => {
  /*
   * Every video goes to Gemini, and every video gets looked at.
   *
   * Two things were wrong before. Six video-capable models on OpenRouter --
   * Qwen, GLM, two Gemmas, a Qwen MoE, a ByteDance Seed -- all failed on real
   * video with 400, 405 or an empty 200, so the OpenRouter leg was removed.
   * And videos over twenty minutes were handed to Gemini's seeking mode, which
   * does not watch: on the app's own prompt it inventoried none of a lesson's
   * eleven visuals and called it "a host talking without diagrams".
   */
  it("samples every video rather than seeking through it", () => {
    for (const durationSeconds of [30, 300, 1_200, 5_400]) {
      const route = chooseVideoRoute({ durationSeconds });
      expect(route.provider, String(durationSeconds)).toBe("gemini");
      expect(route.fps, String(durationSeconds)).toBeGreaterThan(0);
    }
  });

  it("looks less often the longer the video, so a lecture still fits", () => {
    // Frames are billed linearly, so the rate is what keeps a long recording
    // inside its budget without giving up on watching it.
    const short = chooseVideoRoute({ durationSeconds: 300 }).fps;
    const medium = chooseVideoRoute({ durationSeconds: 1_800 }).fps;
    const long = chooseVideoRoute({ durationSeconds: 5_400 }).fps;

    expect(short).toBeGreaterThan(medium);
    expect(medium).toBeGreaterThan(long);
  });

  it("never samples faster than once a second or slower than the floor", () => {
    // Above 1 fps buys nothing; below 0.1 a diagram on screen for eight seconds
    // can fall between two frames.
    expect(getVideoSamplingFps(1)).toBe(1);
    expect(getVideoSamplingFps(10)).toBe(1);
    expect(getVideoSamplingFps(100_000)).toBe(0.1);
  });

  it("keeps a long video's frame cost near the budget rather than unbounded", () => {
    // 270 tokens a frame, measured. An hour at one frame a second would be
    // nearly a million tokens on its own.
    for (const durationSeconds of [600, 1_800, 3_600]) {
      const frames = getVideoSamplingFps(durationSeconds) * durationSeconds;
      expect(frames * 270, String(durationSeconds)).toBeLessThanOrEqual(130_000);
    }
  });

  it("takes the model from the environment", () => {
    process.env.VIDEO_GEMINI_MODEL = "gemini-custom";
    expect(chooseVideoRoute({ durationSeconds: 300 }).model).toBe("gemini-custom");
  });

  it("keeps the requested coverage and timestamp labels stable", () => {
    expect(getVideoCoverageCounts("thorough")).toEqual({ min: 20, max: 35, target: 28 });
    expect(formatVideoTimestamp(125)).toBe("2:05");
  });
});
