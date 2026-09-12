import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * The release gate for marking quality, which the repository has never had.
 *
 * `OPENROUTER_QUALITY_GATE_PASSED` is a boolean an operator sets by hand and
 * nothing verifies, and `check-ai-benchmark.mjs` asks the marking suite only
 * for `cases >= 1` and a self-declared "passed". So a release could always be
 * waved through on a remembered intention.
 *
 * The two ways a gate like this fails silently are both tested here: passing
 * because nothing was measured, and passing because the report stopped being
 * supplied after something was approved.
 */
function run(baseline: unknown, report?: unknown) {
  const directory = mkdtempSync(join(tmpdir(), "marking-gate-"));
  const baselinePath = join(directory, "baselines.json");
  writeFileSync(baselinePath, JSON.stringify(baseline));
  const args = ["scripts/check-marking-benchmark.mjs"];
  if (report !== undefined) {
    const reportPath = join(directory, "report.json");
    writeFileSync(reportPath, JSON.stringify(report));
    args.push(reportPath);
  }
  const result = spawnSync(process.execPath, args, {
    encoding: "utf8",
    env: { ...process.env, MARKING_QUALITY_BASELINES: baselinePath },
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

const THRESHOLDS = {
  minWithinHumanVariationShare: 0.9,
  maxAbsoluteMeanBias: 0.25,
  maxDistanceOverHuman: 1.25,
  minRecords: 25,
};

function baseline(approved: boolean) {
  return {
    schemaVersion: 1,
    thresholds: THRESHOLDS,
    components: {
      "gcse-maths": {
        approved,
        status: approved ? "measured" : "unmeasured",
        pipeline: "pastPaperPractice",
        models: ["qwen/qwen3.6-35b-a3b", "z-ai/glm-5.3-flash"],
      },
    },
  };
}

/** A run comfortably inside every threshold. */
function passing(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    components: {
      "gcse-maths": {
        pipeline: "pastPaperPractice",
        records: 30,
        unaccountedMarkings: 0,
        withinHumanVariationShare: 0.95,
        meanBias: 0.05,
        // Examiners sit 0.25 from their own consensus; Jami sits 0.26.
        humanDisagreement: 0.5,
        candidateDisagreement: 0.26,
        models: ["qwen/qwen3.6-35b-a3b", "z-ai/glm-5.3-flash"],
        ...overrides,
      },
    },
  };
}

describe("before anything has been measured", () => {
  /*
   * Fails safe by design: the registry ships unmeasured, so this is the state
   * on every checkout. It must not claim the marker is good -- only that
   * nothing has claimed it is.
   */
  it("passes without claiming the marker is any good", () => {
    const result = run(baseline(false));
    expect(result.status).toBe(0);
    expect(result.out).toContain("no release gate is active yet");
  });

  /*
   * The failure that would make the whole gate decorative: once a component is
   * approved, a release that simply stops supplying a report must not sail
   * through on the absence of evidence.
   */
  it("refuses once something is approved and no report is supplied", () => {
    const result = run(baseline(true));
    expect(result.status).toBe(1);
    expect(result.out).toContain("no current report was supplied");
  });
});

describe("judging a run against the examiners", () => {
  it("passes a marker that sits about where the examiners do", () => {
    expect(run(baseline(true), passing()).status).toBe(0);
  });

  /*
   * The failure this marker actually has. It has run generous through every
   * configuration tried, and a generous marker can look accurate on average
   * while telling every student they did better than they did.
   */
  it("refuses a generous marker even when its error is small", () => {
    const result = run(baseline(true), passing({ meanBias: 0.6 }));
    expect(result.status).toBe(1);
    expect(result.out).toContain("biased by");
  });

  /*
   * The scale trap. Comparing the marker's distance-to-consensus against the
   * gap *between* examiners would pass a marker twice as far out as they are,
   * because each examiner sits about half that gap from the consensus.
   */
  it("compares against half the examiners' gap, not the whole of it", () => {
    // 0.45 is inside the 0.5 human gap but nearly twice the 0.25 each examiner
    // sits from consensus, so it must fail.
    const result = run(baseline(true), passing({ candidateDisagreement: 0.45 }));
    expect(result.status).toBe(1);
    expect(result.out).toContain("as far from the examiners' consensus");
  });

  it("refuses a run that landed outside the examiners' spread too often", () => {
    const result = run(baseline(true), passing({ withinHumanVariationShare: 0.6 }));
    expect(result.status).toBe(1);
    expect(result.out).toContain("inside the examiners' own spread");
  });

  it("refuses a sample too small to mean anything", () => {
    const result = run(baseline(true), passing({ records: 8 }));
    expect(result.status).toBe(1);
    expect(result.out).toContain("below the 25 required");
  });

  /*
   * Unaccounted cost is a correctness problem, not only a billing one: a
   * marking whose calls went unreported may have been routed somewhere the run
   * did not intend, so the figures may not describe the marker being gated.
   */
  it("refuses a run whose cost was never fully reported", () => {
    const result = run(baseline(true), passing({ unaccountedMarkings: 2 }));
    expect(result.status).toBe(1);
    expect(result.out).toContain("not accountable");
  });

  /*
   * A provider updating a model shifts severity without shifting anything this
   * repository can see, and routing moves on its own -- a failover has already
   * reached a different model family here. A baseline describes the marker that
   * produced it, and nothing else.
   */
  it("refuses a run produced by different models than the baseline", () => {
    const result = run(baseline(true), passing({ models: ["moonshotai/kimi-k3"] }));
    expect(result.status).toBe(1);
    expect(result.out).toContain("re-measure before gating");
  });

  it("does not care what order the models are reported in", () => {
    const result = run(baseline(true), passing({ models: ["z-ai/glm-5.3-flash", "qwen/qwen3.6-35b-a3b"] }));
    expect(result.status).toBe(0);
  });

  /*
   * Whole-paper marking is two blind markers plus a juror on every question;
   * what a student gets buys a second marker only when the mark is likely to be
   * wrong. Reporting one as the other flatters the product by an ensemble
   * nobody is given.
   */
  it("refuses a run that measured the wrong pipeline", () => {
    const result = run(baseline(true), passing({ pipeline: "wholePaper" }));
    expect(result.status).toBe(1);
    expect(result.out).toContain("not pastPaperPractice");
  });

  it("refuses a run with no double-marked humans to be judged against", () => {
    const result = run(baseline(true), passing({ humanDisagreement: 0 }));
    expect(result.status).toBe(1);
    expect(result.out).toContain("no double-marked human benchmark");
  });
});
