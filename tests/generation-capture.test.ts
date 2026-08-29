import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureGenerationPass } from "@/lib/ai/generation-capture";

/**
 * Paper generation was debugged by burning live runs: five structural faults,
 * each a parser or validator defect reproducible from the response alone, each
 * found against a provider that was rate-limiting and dropping connections.
 *
 * The responses were paid for and discarded. These tests exist because the
 * mechanism for keeping them was written, called, and then passed by nobody --
 * declared, invoked, inert. A capture that silently records nothing looks
 * exactly like one that works.
 */
describe("keeping what a model returned", () => {
  let directory = "";
  const previous = process.env.JAMI_CAPTURE_GENERATION_DIR;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "jami-capture-"));
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.JAMI_CAPTURE_GENERATION_DIR;
    else process.env.JAMI_CAPTURE_GENERATION_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  });

  const pass = (overrides: Partial<Parameters<typeof captureGenerationPass>[0]> = {}) => ({
    pass: "mark_scheme_batch",
    role: "worker",
    modelName: "xiaomi/mimo-v2.5",
    text: '{"markScheme":{"items":[]}}',
    ...overrides,
  });

  it("writes the response verbatim, before anything parses it", () => {
    process.env.JAMI_CAPTURE_GENERATION_DIR = directory;
    // The nested marking object that the pre-check refused twice: unparseable
    // to the validator, and exactly what a fixture needs to hold.
    const raw = '{"markScheme":{"items":[{"questionId":"q1","marking":{"type":"additive"}}]}}';
    captureGenerationPass(pass({ text: raw }));

    const written = readFileSync(join(directory, "generation-passes.jsonl"), "utf8");
    const entry = JSON.parse(written.trim());
    expect(entry.text).toBe(raw);
    expect(entry.pass).toBe("mark_scheme_batch");
    expect(entry.modelName).toBe("xiaomi/mimo-v2.5");
    expect(entry.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  /** A run has many passes, and the one that failed is rarely the last. */
  it("appends, so every pass of a run survives", () => {
    process.env.JAMI_CAPTURE_GENERATION_DIR = directory;
    captureGenerationPass(pass({ pass: "paper_design" }));
    captureGenerationPass(pass({ pass: "mark_scheme_batch" }));
    captureGenerationPass(pass({ pass: "audit_repair" }));

    const lines = readFileSync(join(directory, "generation-passes.jsonl"), "utf8")
      .trim()
      .split("\n");
    expect(lines).toHaveLength(3);
    expect(lines.map((line) => JSON.parse(line).pass)).toEqual([
      "paper_design",
      "mark_scheme_batch",
      "audit_repair",
    ]);
  });

  /** Production and ordinary local runs must write nothing at all. */
  it("writes nothing when no directory is named", () => {
    delete process.env.JAMI_CAPTURE_GENERATION_DIR;
    captureGenerationPass(pass());
    expect(existsSync(join(directory, "generation-passes.jsonl"))).toBe(false);
  });

  /**
   * Capture observes a generation; it must never be able to end one. An
   * unwritable path is a bad debugging session, not a failed paper.
   */
  it("does not throw when the path cannot be written", () => {
    // A real file where a directory is needed, so mkdir genuinely fails. Naming
    // a path that merely does not exist proves nothing: mkdir would create it
    // and the write would succeed.
    const blocker = join(directory, "blocker");
    writeFileSync(blocker, "not a directory", "utf8");
    process.env.JAMI_CAPTURE_GENERATION_DIR = join(blocker, "nested");
    expect(() => captureGenerationPass(pass())).not.toThrow();
  });
});
