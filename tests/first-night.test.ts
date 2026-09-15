import { describe, expect, it } from "vitest";
import {
  createFirstNightState,
  FIRST_NIGHT_TARGETS,
  isOnDiscoveryRoute,
  getFirstNightDiscovery,
  navTarget,
  pendingNavLabels,
  planFirstNightGuide,
  readFirstNightQuery,
  readFirstNightState,
  type FirstNightState,
} from "@/lib/onboarding/first-night";

const exploring = (overrides: Partial<FirstNightState> = {}): FirstNightState => ({
  ...createFirstNightState(),
  stage: "exploring",
  ...overrides,
});

const presentOnly = (...selectors: string[]) => (selector: string) => selectors.includes(selector);

describe("starting and remembering the preview", () => {
  it("starts from the link and ends from it", () => {
    expect(readFirstNightQuery("?first-night=preview")).toBe("preview");
    expect(readFirstNightQuery("?first-night=off")).toBe("off");
    expect(readFirstNightQuery("?other=1")).toBeNull();
  });

  it("reads back a stored state defensively", () => {
    expect(readFirstNightState({ version: 1, stage: "exploring", tourStep: 2, lit: ["learn", "nope", "learn"], intent: "exam" })).toEqual({
      version: 1,
      stage: "exploring",
      tourStep: 2,
      lit: ["learn"],
      intent: "exam",
    });
    expect(readFirstNightState({ version: 2, stage: "tour" })).toBeNull();
    expect(readFirstNightState("tour")).toBeNull();
  });
});

describe("where each discovery lives", () => {
  it("counts folders and notebooks as Practice, but exam questions only for the exam star", () => {
    const notebook = getFirstNightDiscovery("notebook");
    const exam = getFirstNightDiscovery("exam");
    expect(isOnDiscoveryRoute("/dashboard/folders/abc", notebook)).toBe(true);
    expect(isOnDiscoveryRoute("/dashboard/practice/questions/new", notebook)).toBe(false);
    expect(isOnDiscoveryRoute("/dashboard/practice/questions/new", exam)).toBe(true);
  });

  it("marks the sidebar entries that still hold a star", () => {
    expect(pendingNavLabels(exploring({ lit: ["notebook", "learn"] }))).toEqual(["Practice", "Tutor", "Stars"]);
    expect(pendingNavLabels(exploring({ stage: "finished" }))).toEqual([]);
  });
});

describe("which note shows", () => {
  it("tours the sidebar on a computer and the bar on a phone", () => {
    const tour = exploring({ stage: "tour", tourStep: 1 });
    expect(planFirstNightGuide({ state: tour, pathname: "/dashboard", isPhone: false, pointing: null, present: () => false })?.target).toBe(
      FIRST_NIGHT_TARGETS.loopGroup
    );
    expect(planFirstNightGuide({ state: tour, pathname: "/dashboard", isPhone: true, pointing: null, present: () => false })?.target).toBe(
      navTarget("Practice")
    );
  });

  it("points at the sidebar entry until the student gets there", () => {
    const state = exploring();
    const away = planFirstNightGuide({ state, pathname: "/dashboard", isPhone: false, pointing: "tutor", present: () => true });
    expect(away).toMatchObject({ target: navTarget("Tutor"), done: "clear-point" });

    const there = planFirstNightGuide({ state, pathname: "/dashboard/tutor", isPhone: false, pointing: "tutor", present: presentOnly(FIRST_NIGHT_TARGETS.tutorMaterial) });
    expect(there).toMatchObject({ target: FIRST_NIGHT_TARGETS.tutorMaterial, lights: "tutor" });
  });

  it("leads from a folder to a notebook to the pen", () => {
    const state = exploring();
    const run = (pathname: string, ...present: string[]) =>
      planFirstNightGuide({ state, pathname, isPhone: false, pointing: null, present: presentOnly(...present) });

    expect(run("/dashboard/practice", FIRST_NIGHT_TARGETS.firstFolder, FIRST_NIGHT_TARGETS.examQuestions)?.target).toBe(FIRST_NIGHT_TARGETS.firstFolder);
    expect(run("/dashboard/practice", FIRST_NIGHT_TARGETS.createFolder)?.target).toBe(FIRST_NIGHT_TARGETS.createFolder);
    expect(run("/dashboard/folders/f1", FIRST_NIGHT_TARGETS.firstNotebook)?.target).toBe(FIRST_NIGHT_TARGETS.firstNotebook);
    expect(run("/dashboard/notebooks/n1", FIRST_NIGHT_TARGETS.pen)).toMatchObject({ target: FIRST_NIGHT_TARGETS.pen, lights: "notebook" });
    // Nothing to point at yet while the notebook is still loading.
    expect(run("/dashboard/notebooks/n1")).toBeNull();
  });

  it("offers exam questions on Practice once notebooks are done, or first when asked for", () => {
    const present = presentOnly(FIRST_NIGHT_TARGETS.firstFolder, FIRST_NIGHT_TARGETS.examQuestions);
    expect(planFirstNightGuide({ state: exploring({ lit: ["notebook"] }), pathname: "/dashboard/practice", isPhone: false, pointing: null, present })?.target).toBe(
      FIRST_NIGHT_TARGETS.examQuestions
    );
    expect(planFirstNightGuide({ state: exploring({ intent: "exam" }), pathname: "/dashboard/practice", isPhone: false, pointing: null, present })?.target).toBe(
      FIRST_NIGHT_TARGETS.examQuestions
    );
  });

  it("still guides a student with no cards, without pointing at nothing", () => {
    const plan = planFirstNightGuide({ state: exploring(), pathname: "/dashboard/study", isPhone: false, pointing: null, present: () => false });
    expect(plan).toMatchObject({ target: null, lights: "learn" });
  });

  it("says nothing once a star is lit or the walkthrough is over", () => {
    expect(planFirstNightGuide({ state: exploring({ lit: ["stars"] }), pathname: "/dashboard/constellation", isPhone: false, pointing: null, present: () => true })).toBeNull();
    expect(planFirstNightGuide({ state: exploring({ stage: "finished" }), pathname: "/dashboard", isPhone: false, pointing: null, present: () => true })).toBeNull();
  });
});
