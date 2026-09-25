import { afterEach, describe, expect, it } from "vitest";
import {
  alreadyReloadedFor,
  appBuildLabel,
  hasUnsavedWork,
  isOutdatedBuild,
  mayReloadForUpdate,
  setUnsavedWork,
} from "@/lib/app/app-build";
import { GET } from "@/app/api/app-version/route";

describe("telling an installed app it is behind", () => {
  it("is behind only when both builds are known and differ", () => {
    expect(isOutdatedBuild("dpl_old", "dpl_new")).toBe(true);
    expect(isOutdatedBuild("dpl_new", "dpl_new")).toBe(false);
    // Outside Vercel there is no build to compare, so nothing ever reloads.
    expect(isOutdatedBuild("", "dpl_new")).toBe(false);
    expect(isOutdatedBuild("dpl_old", "")).toBe(false);
    // A server that could not say is not a new build.
    expect(isOutdatedBuild("dpl_old", null)).toBe(false);
    expect(isOutdatedBuild("dpl_old", { build: "dpl_new" })).toBe(false);
  });

  it("shows the build as the short hash git log prints", () => {
    expect(appBuildLabel("1e3201f9c0a4b5d6e7f8a9b0c1d2e3f4a5b6c7d8")).toBe("1e3201f");
    expect(appBuildLabel("dpl_AbCdEfGh1234")).toBe("AbCdEfGh");
    expect(appBuildLabel("")).toBe("development");
  });

  it("tries each new build once per session, so a stale reload cannot loop", () => {
    expect(alreadyReloadedFor("dpl_new", null)).toBe(false);
    expect(alreadyReloadedFor("dpl_new", "dpl_new")).toBe(true);
    expect(alreadyReloadedFor("dpl_newer", "dpl_new")).toBe(false);
  });
});

describe("when a reload is free", () => {
  afterEach(() => setUnsavedWork("notebook", false));

  it("reloads on launch and on a page change", () => {
    expect(mayReloadForUpdate({ moment: "launch", pathname: "/dashboard", unsavedWork: false })).toBe(true);
    expect(
      mayReloadForUpdate({ moment: "navigation", pathname: "/dashboard/practice/questions/q1", unsavedWork: false })
    ).toBe(true);
  });

  it("never reloads over unsaved work", () => {
    for (const moment of ["launch", "navigation", "resume"] as const) {
      expect(mayReloadForUpdate({ moment, pathname: "/dashboard/notebooks/n1", unsavedWork: true })).toBe(false);
    }
  });

  it("on returning to the app, reloads a saved notebook but waits on pages that cannot say", () => {
    expect(mayReloadForUpdate({ moment: "resume", pathname: "/dashboard/notebooks/n1", unsavedWork: false })).toBe(true);
    expect(mayReloadForUpdate({ moment: "resume", pathname: "/dashboard/study", unsavedWork: false })).toBe(true);
    for (const pathname of [
      "/dashboard/practice/questions/q1",
      "/dashboard/practice/papers/p1",
      "/dashboard/revision/s1",
    ]) {
      expect(mayReloadForUpdate({ moment: "resume", pathname, unsavedWork: false })).toBe(false);
    }
  });

  it("hears from a page that it has something unsaved", () => {
    expect(hasUnsavedWork()).toBe(false);
    setUnsavedWork("notebook", true);
    expect(hasUnsavedWork()).toBe(true);
    setUnsavedWork("notebook", false);
    expect(hasUnsavedWork()).toBe(false);
  });
});

describe("the deployed build", () => {
  it("is answered fresh every time", async () => {
    const response = GET();
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    const body = await response.json();
    expect(typeof body.build).toBe("string");
  });
});
