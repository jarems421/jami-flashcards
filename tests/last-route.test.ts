// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  forgetLastRoute,
  isRestorableRoute,
  readLastRoute,
  rememberLastRoute,
} from "@/lib/app/last-route";

/**
 * Relaunching an installed app should put the student back where they were,
 * and a properly closed one should open at home. Session storage is what draws
 * that line, so these pin the behaviour that depends on it.
 */

beforeEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("isRestorableRoute", () => {
  it.each(["/dashboard", "/dashboard/decks", "/dashboard/notebooks/abc?page=2"])(
    "accepts %s",
    (path) => {
      expect(isRestorableRoute(path)).toBe(true);
    }
  );

  /**
   * This value is handed straight to the router, so anything that could leave
   * the app is refused rather than tidied up.
   */
  it.each([
    ["the sign-in page, which would loop", "/"],
    ["another part of the site", "/auth"],
    ["a protocol-relative host", "//evil.example/dashboard"],
    ["an absolute URL", "https://evil.example/dashboard"],
    ["a backslash path", "/dashboard\\..\\auth"],
    ["a non-string", 42],
    ["nothing at all", null],
  ])("refuses %s", (_label, path) => {
    expect(isRestorableRoute(path)).toBe(false);
  });
});

describe("remembering where they were", () => {
  it("opens at the remembered page when the session is still going", () => {
    rememberLastRoute("/dashboard/practice");

    expect(readLastRoute()).toBe("/dashboard/practice");
  });

  it("opens at home once the app has been properly closed", () => {
    rememberLastRoute("/dashboard/practice");
    // Closing the app ends the session, and session storage goes with it.
    window.sessionStorage.clear();

    expect(readLastRoute()).toBe("/dashboard");
  });

  it("opens at home when nothing was ever recorded", () => {
    expect(readLastRoute()).toBe("/dashboard");
  });

  it("keeps only the latest page", () => {
    rememberLastRoute("/dashboard/decks");
    rememberLastRoute("/dashboard/library");

    expect(readLastRoute()).toBe("/dashboard/library");
  });

  it("declines to record somewhere it would not send anyone", () => {
    rememberLastRoute("/dashboard/decks");
    rememberLastRoute("https://evil.example/dashboard");

    expect(readLastRoute()).toBe("/dashboard/decks");
  });

  it("opens at home rather than a page that was tampered with", () => {
    window.sessionStorage.setItem("jami:last-route", "//evil.example");

    expect(readLastRoute()).toBe("/dashboard");
  });

  it("forgets on sign-out, since that page is no longer theirs", () => {
    rememberLastRoute("/dashboard/decks");
    forgetLastRoute();

    expect(readLastRoute()).toBe("/dashboard");
  });
});

describe("when storage is unavailable", () => {
  it("still opens the app rather than failing", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Storage disabled");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage disabled");
    });

    expect(() => rememberLastRoute("/dashboard/decks")).not.toThrow();
    expect(readLastRoute()).toBe("/dashboard");
  });
});
