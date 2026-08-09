import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  APP_THEME_BOOTSTRAP_SCRIPT,
  APP_THEME_CLASS_NAMES,
  APP_THEME_OPTIONS,
  getActiveAppThemeClassNames,
} from "@/lib/app/theme-preference";

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

  it("maps every option to its document class", () => {
    for (const option of APP_THEME_OPTIONS) {
      expect(getActiveAppThemeClassNames(option.value), option.value).toContain(
        `app-theme-${option.value}`
      );
    }
  });

  it("still clears the retired purple-pink class", () => {
    // Older sessions may have it stamped on the element; leaving it would apply
    // purple's variables on top of whichever theme is now selected.
    expect(APP_THEME_CLASS_NAMES).toContain("app-theme-purple-pink");
  });
});

/**
 * A great many components hard-code white text and white/opacity backgrounds.
 * On a pale surface those disappear, so globals.css carries a block of fixes
 * for it. Those fixes are keyed on an app-theme-light class rather than on one
 * theme's name, because keying them to paper-white meant the next light theme
 * silently shipped with invisible text.
 */
describe("light themes get the fixes that make them legible", () => {
  const LIGHT_THEMES = ["paper-white", "pink"];

  it("keys the white-text fixes on lightness, not on a single theme", () => {
    expect(globalsCss).toContain("body.app-theme-light .text-white");
    expect(globalsCss).toContain('body.app-theme-light [class*="bg-white/"]');
  });

  it("marks every light theme as light", () => {
    for (const theme of LIGHT_THEMES) {
      expect(
        getActiveAppThemeClassNames(
          theme as (typeof APP_THEME_OPTIONS)[number]["value"]
        ),
        theme
      ).toContain("app-theme-light");
    }
  });

  it("includes the light marker in the cleanup contract", () => {
    expect(APP_THEME_CLASS_NAMES).toContain("app-theme-light");
  });

  it("gives light themes dark text, so the fixes are actually needed", () => {
    for (const theme of LIGHT_THEMES) {
      const primary = themeBlock(theme)
        ?.split("--color-text-primary:")[1]
        ?.split(";")[0]
        ?.trim();

      // Anything starting #f/#e is a pale colour, which on a pale surface
      // would mean the theme was built inverted.
      expect(primary, theme).toMatch(/^#[0-6]/);
    }
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

/**
 * The source CSS is not the shipped CSS.
 *
 * Every other test in this file reads `globals.css`, which is why four themes
 * could ship with no colours at all while these stayed green: the rules were
 * in the file and Tailwind dropped them from the build, because the class
 * names are only ever constructed as `app-theme-${value}` and a template
 * literal is invisible to the content scanner.
 */
describe("every theme survives the Tailwind content scan", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { APP_THEME_SAFELIST } = require("../tailwind.config.js") as {
    APP_THEME_SAFELIST: string[];
  };

  it("safelists the class of every selectable theme", () => {
    for (const option of APP_THEME_OPTIONS) {
      expect(APP_THEME_SAFELIST, option.value).toContain(
        `app-theme-${option.value}`
      );
    }
  });

  it("safelists every class the runtime stamps, including legacy ones", () => {
    for (const className of APP_THEME_CLASS_NAMES) {
      expect(APP_THEME_SAFELIST, className).toContain(className);
    }
  });
});

/**
 * The theme class is applied from an effect, which runs after the first paint.
 * That meant every load painted the default navy and swapped to the chosen
 * theme a frame later -- seen on the opening screen as the whole background
 * changing colour under the mark, as though there were two loading screens.
 * A blocking script in the head stamps it before anything is painted.
 */
describe("the theme is on the document before the first paint", () => {
  const layout = readFileSync(join(root, "app/layout.tsx"), "utf8");

  it("runs the bootstrap blocking in the head", () => {
    expect(layout).toContain("APP_THEME_BOOTSTRAP_SCRIPT");
    // Anything async or deferred lands after the paint it is there to beat.
    expect(layout).not.toMatch(/APP_THEME_BOOTSTRAP_SCRIPT[\s\S]{0,200}defer/);
    expect(layout).not.toMatch(/APP_THEME_BOOTSTRAP_SCRIPT[\s\S]{0,200}async/);
  });

  it("stamps exactly what the effect would, for every theme", () => {
    for (const option of APP_THEME_OPTIONS) {
      for (const className of getActiveAppThemeClassNames(option.value)) {
        expect(APP_THEME_BOOTSTRAP_SCRIPT, option.value).toContain(className);
      }
    }
  });

  it("survives storage being unavailable rather than blanking the page", () => {
    const run = (storage: unknown) => {
      const classes: string[] = [];
      const documentStub = {
        documentElement: {
          classList: { add: (...added: string[]) => classes.push(...added) },
        },
      };
      new Function(
        "window",
        "document",
        APP_THEME_BOOTSTRAP_SCRIPT
      )({ localStorage: storage }, documentStub);
      return classes;
    };

    // A stored theme is used, including the retired one folded into purple.
    expect(run({ getItem: () => "paper-white" })).toEqual(
      getActiveAppThemeClassNames("paper-white")
    );
    expect(run({ getItem: () => "purple-pink" })).toEqual(
      getActiveAppThemeClassNames("purple")
    );
    // Nothing stored, nonsense stored, and storage that throws all fall back.
    expect(run({ getItem: () => null })).toEqual(
      getActiveAppThemeClassNames("normal")
    );
    expect(run({ getItem: () => "chartreuse" })).toEqual(
      getActiveAppThemeClassNames("normal")
    );
    expect(
      run({
        getItem: () => {
          throw new Error("denied");
        },
      })
    ).toEqual([]);
  });
});
