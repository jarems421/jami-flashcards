import { beforeEach, describe, expect, it, vi } from "vitest";
import { describeSpaceLimit, getSpaceLeft, OWN_NOTEBOOK_TYPES } from "@/lib/billing/space";
import { planFirstNightSetup } from "@/lib/onboarding/first-night";

const mocks = vi.hoisted(() => ({
  flags: { enableBilling: true },
  loadPlanSummary: vi.fn(),
  getActiveStudyFolders: vi.fn(),
  getNotebooksForFolderPage: vi.fn(),
  reportAllowanceRefusal: vi.fn(),
}));

vi.mock("@/lib/app/feature-flags", () => ({ featureFlags: mocks.flags }));
vi.mock("@/services/billing/plan-summary-store", () => ({ loadPlanSummary: mocks.loadPlanSummary }));
vi.mock("@/services/study/folders", () => ({ getActiveStudyFolders: mocks.getActiveStudyFolders }));
vi.mock("@/services/study/notebooks", () => ({ getNotebooksForFolderPage: mocks.getNotebooksForFolderPage }));
vi.mock("@/services/billing/allowance-events", () => ({ reportAllowanceRefusal: mocks.reportAllowanceRefusal }));

const { assertRoomForFolder, assertRoomForNotebook, getFolderRoom } = await import(
  "@/services/billing/space-limits"
);

describe("room on each plan", () => {
  it("keeps Free to three folders and three notebooks a folder, and nothing else to any", () => {
    expect(getSpaceLeft("free", "folders", 2)).toBe(1);
    expect(getSpaceLeft("free", "folders", 5)).toBe(0);
    expect(getSpaceLeft("free", "notebooks", 3)).toBe(0);
    expect(getSpaceLeft("plus", "folders", 40)).toBeNull();
    expect(getSpaceLeft("pro", "notebooks", 40)).toBeNull();
    expect(getSpaceLeft("lifetime", "folders", 40)).toBeNull();
  });

  it("says what Free includes and both ways on", () => {
    expect(describeSpaceLimit("free", "folders")).toBe(
      "Free includes 3 folders. Archive a folder to make room, or choose Nova for as many as you like."
    );
    expect(describeSpaceLimit("free", "notebooks")).toContain("3 notebooks in each folder");
  });

  it("never counts papers or practice notebooks against a folder", () => {
    expect(OWN_NOTEBOOK_TYPES).toContain("blank");
    expect(OWN_NOTEBOOK_TYPES).toContain("uploaded_file");
    expect(OWN_NOTEBOOK_TYPES).not.toContain("practice_paper");
    expect(OWN_NOTEBOOK_TYPES).not.toContain("past_paper");
  });
});

describe("checking room before making something", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.flags.enableBilling = true;
    mocks.loadPlanSummary.mockResolvedValue({ enabled: true, plan: "free" });
  });

  it("refuses a fourth folder on Free and opens the plans sheet", async () => {
    mocks.getActiveStudyFolders.mockResolvedValue([{}, {}, {}]);
    await expect(assertRoomForFolder("user-1")).rejects.toThrow("Free includes 3 folders");
    expect(mocks.reportAllowanceRefusal).toHaveBeenCalledWith(
      expect.objectContaining({ code: "allowance_used", allowance: null })
    );
  });

  it("allows the third folder", async () => {
    mocks.getActiveStudyFolders.mockResolvedValue([{}, {}]);
    await expect(assertRoomForFolder("user-1")).resolves.toBeUndefined();
  });

  it("counts only the student's own notebooks in a folder", async () => {
    mocks.getNotebooksForFolderPage.mockResolvedValue({
      items: [{ type: "blank" }, { type: "uploaded_file" }, { type: "practice_paper" }, { type: "past_paper" }],
    });
    await expect(assertRoomForNotebook("user-1", "folder-1")).resolves.toBeUndefined();
    mocks.getNotebooksForFolderPage.mockResolvedValue({
      items: [{ type: "blank" }, { type: "blank" }, { type: "free_working" }],
    });
    await expect(assertRoomForNotebook("user-1", "folder-1")).rejects.toThrow("3 notebooks in each folder");
  });

  it("lets paid plans, Lifetime, billing-off and failed reads carry on", async () => {
    mocks.getActiveStudyFolders.mockResolvedValue(new Array(20).fill({}));
    mocks.loadPlanSummary.mockResolvedValue({ enabled: true, plan: "plus" });
    await expect(assertRoomForFolder("user-1")).resolves.toBeUndefined();
    mocks.loadPlanSummary.mockResolvedValue({ enabled: true, plan: "lifetime" });
    await expect(assertRoomForFolder("user-1")).resolves.toBeUndefined();
    mocks.loadPlanSummary.mockRejectedValue(new Error("offline"));
    await expect(assertRoomForFolder("user-1")).resolves.toBeUndefined();
    mocks.flags.enableBilling = false;
    mocks.loadPlanSummary.mockResolvedValue({ enabled: true, plan: "free" });
    expect(await getFolderRoom("user-1")).toBeNull();
    expect(mocks.getActiveStudyFolders).not.toHaveBeenCalled();
  });
});

describe("the first-night welcome on Free", () => {
  it("makes folders for the first subjects up to the room, and counts the rest", () => {
    const answers = {
      studyLevel: null,
      subjects: ["Biology", "Chemistry", "Physics", "History", "Maths"].map((name) => ({
        name,
        examCourse: null,
      })),
    };
    const plan = planFirstNightSetup(answers, [], 3);
    expect(plan.create.map((folder) => folder.name)).toEqual(["Biology", "Chemistry", "Physics"]);
    expect(plan.overPlan).toBe(2);
    expect(planFirstNightSetup(answers, []).create).toHaveLength(5);
    expect(planFirstNightSetup(answers, []).overPlan).toBe(0);
  });
});
