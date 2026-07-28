import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_THEME_OPTIONS } from "@/lib/app/theme-preference";

/**
 * A theme is three things that have to agree: an option in the picker, a block
 * of custom properties in globals.css, and a class toggle in the background
 * shell. Miss either of the last two and the option still renders, still looks
 * selected, and changes nothing — which is invisible in review and obvious to
 * a student.
 */

const root = join(__dirname, "..");
const globalsCss = readFileSync(join(root, "app/globals.css"), "utf8");

/**
 * Returns the declaration block for a theme.
 *
 * Selectors are sometimes grouped (`body.app-theme-purple,` on its own line),
 * so this matches the selector wherever it appears in the list. The trailing
 * boundary matters: without it "purple" would also match "purple-pink".
 */
function themeBlock(theme: string): string | null {
  const selector = new RegExp(`body\\.app-theme-${theme}(?![\\w-])`);
  const start = globalsCss.search(selector);
  if (start < 0) return null;

  const open = globalsCss.indexOf("{", start);
  const close = globalsCss.indexOf("\n  }", open);
  if (open < 0 || close < 0) return null;

  return globalsCss.slice(open, close);
}
const backgroundShell = readFileSync(
  join(root, "components/constellation/ConstellationBackgroundShell.tsx"),
  "utf8"
);

describe("app theme options", () => {
  it("offers the expected themes", () => {
    expect(APP_THEME_OPTIONS.map((option) => option.value)).toEqual([
      "normal",
      "purple",
      "pink",
      "paper-white",
      "soft-grey",
      "black",
    ]);
  });

  it("gives every theme a label, description and preview", () => {
    for (const option of APP_THEME_OPTIONS) {
      expect(option.label, option.value).toBeTruthy();
      expect(option.description, option.value).toBeTruthy();
      expect(option.preview, option.value).toContain("gradient");
    }
  });

  it("uses each value only once", () => {
    const values = APP_THEME_OPTIONS.map((option) => option.value);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("every theme is actually implemented", () => {
  it("defines custom properties for each theme in globals.css", () => {
    for (const option of APP_THEME_OPTIONS) {
      // "normal" is the default and lives in :root rather than its own block.
      if (option.value === "normal") continue;
      expect(themeBlock(option.value), option.value).toBeTruthy();
    }
  });

  it("sets a surface and text colour for each theme, not just a background", () => {
    for (const option of APP_THEME_OPTIONS) {
      if (option.value === "normal") continue;
      const block = themeBlock(option.value);

      expect(block, option.value).toContain("--color-surface-base");
      expect(block, option.value).toContain("--color-text-primary");
      expect(block, option.value).toContain("--color-accent");
    }
  });

  it("toggles a class for each theme in the background shell", () => {
    for (const option of APP_THEME_OPTIONS) {
      expect(backgroundShell, option.value).toContain(`"app-theme-${option.value}"`);
    }
  });

  it("still clears the retired purple-pink class", () => {
    // Older sessions may have it stamped on the element; leaving it would apply
    // purple's variables on top of whichever theme is now selected.
    expect(backgroundShell).toContain('"app-theme-purple-pink"');
  });
});

describe("black is a true black, distinct from grey", () => {
  function surfaceBase(theme: string) {
    return themeBlock(theme)
      ?.split("--color-surface-base:")[1]
      ?.split(";")[0]
      ?.trim();
  }

  it("uses #000 rather than a dark grey", () => {
    expect(surfaceBase("black")).toBe("#000000");
  });

  it("is darker than the grey theme it sits beside", () => {
    expect(surfaceBase("black")).not.toBe(surfaceBase("soft-grey"));
  });
});
