import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_THEME_BOOTSTRAP_SCRIPT } from "@/lib/app/theme-preference";
import { CONSTELLATION_BACKGROUND_EXCLUDED_PATHS } from "@/lib/constellation/background";

/**
 * Turning the star sky on used to leave the chosen colour theme underneath it,
 * so a black star field came with pink buttons, a blush nav bar and pink-tinted
 * shadows. The sky is a preset of its own now: it carries a complete black
 * palette, and no theme class is stamped while it is on.
 *
 * Two things have to hold for that, and neither is visible in review:
 *
 *  - every token a theme can set is also set in the sky's block, or the theme's
 *    value shows through;
 *  - the sky's block stays outside `@layer`, or the layered theme blocks win on
 *    the cascade no matter what it declares.
 */

const root = join(__dirname, "..");
const globalsCss = readFileSync(join(root, "app/globals.css"), "utf8");
const shell = readFileSync(
  join(root, "components/constellation/ConstellationBackgroundShell.tsx"),
  "utf8"
);

const SKY_SELECTOR = "html.constellation-background-enabled";

function declarationBlock(selector: string): string {
  const start = globalsCss.indexOf(selector);
  expect(start, selector).toBeGreaterThan(-1);

  const open = globalsCss.indexOf("{", start);
  const close = globalsCss.indexOf("\n}", open);
  expect(close, selector).toBeGreaterThan(open);

  return globalsCss.slice(open, close);
}

/** Every custom property assigned anywhere inside a theme's own block. */
function tokensSetByThemes(): Set<string> {
  const tokens = new Set<string>();

  for (const theme of ["purple", "pink", "paper-white", "soft-grey", "black"]) {
    const start = globalsCss.search(
      new RegExp(`body\\.app-theme-${theme}(?![\\w-])`)
    );
    if (start < 0) continue;

    const open = globalsCss.indexOf("{", start);
    const close = globalsCss.indexOf("\n  }", open);
    const block = globalsCss.slice(open, close);

    for (const match of block.matchAll(/(--[\w-]+)\s*:/g)) {
      tokens.add(match[1]);
    }
  }

  return tokens;
}

describe("the sky palette leaves nothing to the colour theme", () => {
  const skyBlock = declarationBlock(SKY_SELECTOR);

  it("sets every custom property any theme sets", () => {
    const missing = [...tokensSetByThemes()].filter(
      (token) => !new RegExp(`${token}\\s*:`).test(skyBlock)
    );

    expect(missing).toEqual([]);
  });

  it("pins the accent and primary button, the loudest leak of the lot", () => {
    expect(skyBlock).toContain("--color-accent:");
    expect(skyBlock).toContain("--button-primary-bg:");
    expect(skyBlock).toContain("--button-primary-text:");
  });

  it("pins the chrome, which no override elsewhere reaches", () => {
    for (const token of [
      "--topbar-border",
      "--nav-shell-bg",
      "--nav-shell-border",
      "--nav-active-bg",
      "--nav-active-text",
    ]) {
      expect(skyBlock, token).toContain(`${token}:`);
    }
  });

  it("uses black shadows rather than a theme's tinted ones", () => {
    // A pink theme's elevations are pink, which reads as a coloured haze around
    // every panel once there is a star field behind them.
    const elevation = skyBlock
      .split("--elevation-2:")[1]
      ?.split(";")[0]
      ?.trim();

    expect(elevation).toContain("rgba(0, 0, 0");
  });

  it("stays outside @layer, so it outranks the layered theme blocks", () => {
    // Layered rules always lose to unlayered ones, whatever their specificity:
    // the theme blocks live in `@layer base`, and this one must not.
    const layerStarts = [...globalsCss.matchAll(/^@layer [\w, ]+\{/gm)];
    const skyIndex = globalsCss.indexOf(SKY_SELECTOR);

    for (const layer of layerStarts) {
      const layerOpen = layer.index ?? 0;
      const layerClose = globalsCss.indexOf("\n}", layerOpen);
      expect(
        skyIndex > layerOpen && skyIndex < layerClose,
        `${layer[0]} must not contain the sky block`
      ).toBe(false);
    }
  });
});

describe("no theme class is stamped while the sky is on", () => {
  it("clears the theme classes in the shell", () => {
    // The light themes carry rules keyed on the class itself -- white text
    // turned dark, white/opacity backgrounds turned grey -- which custom
    // properties cannot override. Not stamping the class is the only fix.
    expect(shell).toMatch(
      /shouldShowBackground\s*\?\s*\[\]\s*:\s*getActiveAppThemeClassNames\(appTheme\)/
    );
  });

  it("re-runs when the sky is turned on or off, not only on a theme change", () => {
    expect(shell).toContain("[appTheme, shouldShowBackground]");
  });
});

describe("the sky is on the document before the first paint", () => {
  /** Runs the bootstrap against a stubbed window and returns the classes added. */
  function run(store: Record<string, string>, pathname = "/dashboard") {
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
    )(
      {
        localStorage: { getItem: (key: string) => store[key] ?? null },
        location: { pathname },
      },
      documentStub
    );

    return classes;
  }

  it("stamps the sky instead of the stored theme", () => {
    expect(
      run({
        "jami:app-theme": "pink",
        "constellation-background-enabled": "true",
      })
    ).toEqual(["constellation-background-enabled"]);
  });

  it("falls back to the theme when the sky crashed the page last time", () => {
    expect(
      run({
        "jami:app-theme": "pink",
        "constellation-background-enabled": "true",
        "constellation-background-crash-marked": "true",
      })
    ).toEqual(["app-theme-pink", "app-theme-light"]);
  });

  it("has the notebook palette right in the first painted frame", () => {
    /*
     * Notebooks show the sky, and the reason they were kept from it before was
     * a class arriving after the page had measured itself. Stamping it here is
     * the answer to that, so this is the assertion the whole exclusion used to
     * stand in for: by the time a notebook route paints once, the palette is
     * already the sky's and nothing changes it afterwards.
     */
    expect(
      run(
        {
          "jami:app-theme": "pink",
          "constellation-background-enabled": "true",
        },
        "/dashboard/notebooks/abc123"
      )
    ).toEqual(["constellation-background-enabled"]);
  });

  it("agrees with the shell about every excluded path", () => {
    // The two ran on different lists for a day, and a notebook opened in one
    // palette and flipped to the other a frame later.
    for (const path of CONSTELLATION_BACKGROUND_EXCLUDED_PATHS) {
      expect(
        run(
          {
            "jami:app-theme": "pink",
            "constellation-background-enabled": "true",
          },
          path
        ),
        path
      ).toEqual(["app-theme-pink", "app-theme-light"]);
    }
  });

  it("leaves the Stars page on the student's own theme", () => {
    // That page draws the sky itself, so the background is not turned on behind
    // it -- and a palette that applied there anyway would flip colours on the
    // one screen the sky is not actually behind.
    expect(
      run(
        {
          "jami:app-theme": "pink",
          "constellation-background-enabled": "true",
        },
        "/dashboard/constellation"
      )
    ).toEqual(["app-theme-pink", "app-theme-light"]);
  });

  it("stamps the theme as before when the sky is off", () => {
    expect(run({ "jami:app-theme": "black" })).toEqual(["app-theme-black"]);
  });
});
