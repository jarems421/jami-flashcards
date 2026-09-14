import { describe, expect, it } from "vitest";
import {
  getPaperBuilderJobs,
  isPracticePaperJobBuilding,
  mapPracticePaperJobData,
} from "@/lib/practice/practice-paper-jobs";

function job(id: string, data: Record<string, unknown>) {
  return mapPracticePaperJobData(id, { title: id, ...data });
}

describe("the Practice paper builder list", () => {
  it("keeps papers that are building, waiting on the student, or failed", () => {
    const jobs = [
      job("queued", { status: "queued" }),
      job("running", { status: "running" }),
      job("confirm", { status: "needs_confirmation" }),
      job("clarify", { status: "needs_clarification" }),
      job("failed", { status: "failed" }),
    ];

    expect(getPaperBuilderJobs(jobs).map((item) => item.id)).toEqual([
      "queued",
      "running",
      "confirm",
      "clarify",
      "failed",
    ]);
  });

  it("drops finished, cancelled, and dismissed papers so an idle builder is empty", () => {
    const jobs = [
      job("ready", { status: "ready", readyUnread: true }),
      job("cancelled", { status: "cancelled" }),
      job("dismissed", { status: "failed", failureDismissed: true }),
    ];

    expect(getPaperBuilderJobs(jobs)).toEqual([]);
  });

  it("reads a missing dismissal flag on older jobs as not dismissed", () => {
    expect(job("older", { status: "failed" }).failureDismissed).toBe(false);
  });

  it("polls only while Jami is working without the student", () => {
    expect(isPracticePaperJobBuilding("queued")).toBe(true);
    expect(isPracticePaperJobBuilding("running")).toBe(true);
    expect(isPracticePaperJobBuilding("needs_clarification")).toBe(false);
    expect(isPracticePaperJobBuilding("failed")).toBe(false);
  });
});
