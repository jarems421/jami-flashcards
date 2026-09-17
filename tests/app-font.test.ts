// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  APP_FONT_CLASS_NAMES,
  APP_FONT_OPTIONS,
  APP_FONT_STORAGE_KEY,
  DEFAULT_APP_FONT,
  readAppFont,
  saveAppFont,
} from "@/lib/app/app-font";
import { APP_THEME_BOOTSTRAP_SCRIPT } from "@/lib/app/theme-preference";

const root = join(__dirname, "..");
const globalsCss = readFileSync(join(root, "app/globals.css"), "utf8");
const tailwindConfig = readFileSync(join(root, "tailwind.config.js"), "utf8");

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
});

describe("the face Jami is set in", () => {
  it("offers a shelf of faces, each with its own id", () => {
    expect(APP_FONT_OPTIONS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(APP_FONT_OPTIONS.map((option) => option.id)).size).toBe(APP_FONT_OPTIONS.length);
  });

  it("keeps a chosen face and stamps it on the document at once", () => {
    saveAppFont("cinzel");
    expect(readAppFont()).toBe("cinzel");
    expect(document.documentElement.classList.contains("app-font-cinzel")).toBe(true);

    // Only ever one face class, so the last choice is the one that paints.
    saveAppFont("lora");
    expect(
      APP_FONT_CLASS_NAMES.filter((name) => document.documentElement.classList.contains(name))
    ).toEqual(["app-font-lora"]);
  });

  it("falls back to Jami's own face when what is stored is not one we offer", () => {
    localStorage.setItem(APP_FONT_STORAGE_KEY, "papyrus");
    expect(readAppFont()).toBe(DEFAULT_APP_FONT);
  });
});

/**
 * A face is three things that have to agree: an option in the picker, a rule
 * in globals.css pointing `--app-font` at it, and an entry in Tailwind's
 * safelist. Miss the last one and the rule is purged from the build: the tile
 * ticks, the class lands on the document, and the lettering never changes --
 * which is exactly the bug this file was written after.
 */
describe("every face the picker offers", () => {
  it.each(APP_FONT_OPTIONS.map((option) => option.id))("%s has a rule and survives the build", (id) => {
    expect(globalsCss).toContain(`.app-font-${id} {`);
    expect(globalsCss).toContain(`--app-font: var(--font-${id})`);
    expect(tailwindConfig).toContain(`"app-font-${id}"`);
  });
});

describe("the blocking script in the head", () => {
  it("stamps the stored face before the first paint", () => {
    localStorage.setItem(APP_FONT_STORAGE_KEY, "marcellus");
    new Function(APP_THEME_BOOTSTRAP_SCRIPT)();
    expect(document.documentElement.classList.contains("app-font-marcellus")).toBe(true);
  });

  it("ignores a stored face it does not recognise rather than stamping anything", () => {
    localStorage.setItem(APP_FONT_STORAGE_KEY, "papyrus");
    new Function(APP_THEME_BOOTSTRAP_SCRIPT)();
    expect(document.documentElement.className).not.toContain("app-font-");
  });
});
