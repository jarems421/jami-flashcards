import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  forgetGenerationCheckpoint,
  readGenerationCheckpoint,
  writeGenerationCheckpoint,
} from "@/lib/ai/generation-checkpoint";

/**
 * A paper is built from roughly 28 sequential model calls. One run failed at
 * group 16 when the provider dropped the connection, and the fifteen completed
 * groups went with it -- valid work, already paid for, discarded because the
 * next call failed.
 */
describe("remembering a completed pass", () => {
  let directory = "";
  const previous = process.env.JAMI_GENERATION_CHECKPOINT_DIR;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "jami-checkpoint-"));
    process.env.JAMI_GENERATION_CHECKPOINT_DIR = directory;
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.JAMI_GENERATION_CHECKPOINT_DIR;
    else process.env.JAMI_GENERATION_CHECKPOINT_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  });

  const batch = (subject: string[]) => ({ pass: "mark_scheme_batch", subject });

  it("hands back a pass it already has", () => {
    writeGenerationCheckpoint(batch(["q1", "q2"]), {
      text: '{"markScheme":{"items":[]}}',
      modelName: "xiaomi/mimo-v2.5",
    });
    expect(readGenerationCheckpoint(batch(["q1", "q2"]))).toMatchObject({
      text: '{"markScheme":{"items":[]}}',
      modelName: "xiaomi/mimo-v2.5",
    });
  });

  it("has nothing for a pass never run", () => {
    expect(readGenerationCheckpoint(batch(["q9"]))).toBeNull();
  });

  /**
   * The failure this key shape exists to prevent. High-tariff questions are
   * split into batches of their own, so batch three covers different questions
   * between runs; keying on position would return a scheme for the wrong
   * questions while looking like a cache hit.
   */
  it("does not confuse one batch with another covering different questions", () => {
    writeGenerationCheckpoint(batch(["q1", "q2"]), { text: "first", modelName: "m" });
    writeGenerationCheckpoint(batch(["q3", "q4"]), { text: "second", modelName: "m" });
    expect(readGenerationCheckpoint(batch(["q1", "q2"]))?.text).toBe("first");
    expect(readGenerationCheckpoint(batch(["q3", "q4"]))?.text).toBe("second");
    expect(readGenerationCheckpoint(batch(["q5"]))).toBeNull();
  });

  /** The same questions are the same work whatever order they arrive in. */
  it("recognises the same questions listed differently", () => {
    writeGenerationCheckpoint(batch(["q2", "q1"]), { text: "same work", modelName: "m" });
    expect(readGenerationCheckpoint(batch(["q1", "q2"]))?.text).toBe("same work");
  });

  /** Two passes over the same questions are two different pieces of work. */
  it("keeps passes apart even over identical questions", () => {
    writeGenerationCheckpoint({ pass: "paper_design", subject: ["q1"] }, {
      text: "design",
      modelName: "m",
    });
    writeGenerationCheckpoint(batch(["q1"]), { text: "scheme", modelName: "m" });
    expect(readGenerationCheckpoint({ pass: "paper_design", subject: ["q1"] })?.text).toBe("design");
    expect(readGenerationCheckpoint(batch(["q1"]))?.text).toBe("scheme");
  });

  /**
   * A truncated file is not a result. Losing one call is cheap; handing back
   * half a mark scheme as though it were complete is the expensive outcome, and
   * it would surface much later as a validation failure nobody could place.
   */
  it("ignores a half-written checkpoint rather than trusting it", () => {
    writeGenerationCheckpoint(batch(["q1"]), { text: "good", modelName: "m" });
    const file = readdirSync(directory)[0];
    writeFileSync(join(directory, file), '{"text": "trunc', "utf8");
    expect(readGenerationCheckpoint(batch(["q1"]))).toBeNull();
  });

  it("does nothing at all when no directory is named", () => {
    delete process.env.JAMI_GENERATION_CHECKPOINT_DIR;
    writeGenerationCheckpoint(batch(["q1"]), { text: "x", modelName: "m" });
    expect(readGenerationCheckpoint(batch(["q1"]))).toBeNull();
    expect(readdirSync(directory)).toHaveLength(0);
  });

  /** A cache that cannot be reached costs a repeated call, never the paper. */
  it("survives an unusable directory", () => {
    // A real file where a directory is needed, so mkdir genuinely fails.
    const blocker = join(directory, "blocker");
    writeFileSync(blocker, "not a directory", "utf8");
    process.env.JAMI_GENERATION_CHECKPOINT_DIR = join(blocker, "nested");
    expect(() => writeGenerationCheckpoint(batch(["q1"]), { text: "x", modelName: "m" })).not.toThrow();
    expect(readGenerationCheckpoint(batch(["q1"]))).toBeNull();
  });
});

/**
 * A checkpoint is written as soon as a call returns, before the caller judges
 * it, which is what makes a resumed run cheap. It also means a rejected result
 * is remembered: a paper design worth 97 marks against a required 96 was
 * cached under the sources it was built from, so every rerun replayed the same
 * wrong paper. The design varies widely between attempts on the same request --
 * 80, 96, 97, 143, 154, 164 and 177 marks across seven runs -- so resampling
 * works, and caching the failure is what stopped it working.
 */
describe("forgetting a result that turned out unusable", () => {
  let directory = "";
  const previous = process.env.JAMI_GENERATION_CHECKPOINT_DIR;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "jami-forget-"));
    process.env.JAMI_GENERATION_CHECKPOINT_DIR = directory;
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.JAMI_GENERATION_CHECKPOINT_DIR;
    else process.env.JAMI_GENERATION_CHECKPOINT_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  });

  const design = { pass: "paper_design", subject: ["src1"] };

  it("lets the next run draw a new one", () => {
    writeGenerationCheckpoint(design, { text: "a 97-mark paper", modelName: "m" });
    expect(readGenerationCheckpoint(design)).not.toBeNull();
    forgetGenerationCheckpoint(design);
    expect(readGenerationCheckpoint(design)).toBeNull();
  });

  /** Forgetting one pass must not discard the others a run has banked. */
  it("leaves every other pass alone", () => {
    writeGenerationCheckpoint(design, { text: "design", modelName: "m" });
    writeGenerationCheckpoint({ pass: "mark_scheme_batch", subject: ["q1"] }, {
      text: "scheme",
      modelName: "m",
    });
    forgetGenerationCheckpoint(design);
    expect(readGenerationCheckpoint({ pass: "mark_scheme_batch", subject: ["q1"] })?.text).toBe("scheme");
  });

  it("does not complain about forgetting something never stored", () => {
    expect(() => forgetGenerationCheckpoint({ pass: "never_ran", subject: ["x"] })).not.toThrow();
  });
});
