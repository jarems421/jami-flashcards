import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  derivePhotoBackgroundPalette,
  derivePhotoBackgroundPaletteForView,
} from "@/lib/app/photo-background-palette";
import {
  encodePhotoBackgroundSample,
  isSoftPhotoBackground,
  normalizePhotoBackgroundRecord,
  normalizePhotoBackgroundView,
  parseCachedPhotoBackground,
  photoBackgroundStretch,
  photoBackgroundViewPixels,
  PHOTO_BACKGROUND_STORAGE_KEY,
  SHARP_PHOTO_BACKGROUND_FILE_STEM,
  shouldKeepOriginalPhoto,
} from "@/lib/app/photo-background";
import { PANEL_STYLE_STORAGE_KEY, SOLID_PANELS_CLASS_NAME } from "@/lib/app/panel-style";
import { APP_THEME_BOOTSTRAP_SCRIPT, getActiveAppThemeClassNames } from "@/lib/app/theme-preference";

const root = join(__dirname, "..");
const globalsCss = readFileSync(join(root, "app/globals.css"), "utf8");

/** RGBA for a width x height image, coloured by column. */
function pixels(width: number, height: number, colourAt: (x: number) => [number, number, number]) {
  const data: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data.push(...colourAt(x), 255);
  }
  return data;
}

const navy = pixels(16, 16, () => [18, 30, 70]);
const dark = derivePhotoBackgroundPalette(navy);

const cached = {
  userId: "alice",
  imageUrl:
    "https://firebasestorage.googleapis.com/v0/b/jami/o/users%2Falice%2FappBackgrounds%2Ff1%2Fbackground.jpg?alt=media&token=abc-123",
  storagePath: "users/alice/appBackgrounds/f1/background.jpg",
  scheme: dark.scheme,
  vars: dark.vars,
  updatedAt: 10,
  focusX: 30,
  focusY: 70,
  zoom: 1.5,
  sample: encodePhotoBackgroundSample(navy, 16, 16),
};

/** A copy of a record without some of its fields, as an older save would have been. */
function without(record: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)));
}

/** Runs the head script against a stubbed window and document. */
function run(store: Record<string, string>, pathname = "/dashboard") {
  const classes: string[] = [];
  const properties: Record<string, string> = {};
  const documentStub = {
    documentElement: {
      classList: { add: (...added: string[]) => classes.push(...added) },
      style: { setProperty: (name: string, value: string) => { properties[name] = value; } },
    },
  };
  new Function("window", "document", APP_THEME_BOOTSTRAP_SCRIPT)(
    {
      localStorage: { getItem: (key: string) => store[key] ?? null },
      location: { pathname },
    },
    documentStub
  );
  return { classes, properties };
}

describe("a stored photo background", () => {
  it("round-trips through the device's copy", () => {
    expect(parseCachedPhotoBackground(JSON.stringify(cached))).toEqual(cached);
  });

  it("reads a record saved before photos could be moved as centred", () => {
    const older = without(cached, ["focusX", "focusY", "zoom", "sample"]);
    expect(normalizePhotoBackgroundRecord(older, "alice")).toMatchObject({ focusX: 50, focusY: 50, zoom: 1 });
    expect(normalizePhotoBackgroundRecord(older, "alice")).not.toHaveProperty("sample");
  });

  it("keeps a view inside the photo and the zoom range", () => {
    expect(normalizePhotoBackgroundView({ focusX: -20, focusY: 140, zoom: 9 })).toEqual({ focusX: 0, focusY: 100, zoom: 3 });
    expect(normalizePhotoBackgroundView({ focusX: "left", zoom: 0.2 })).toEqual({ focusX: 50, focusY: 50, zoom: 1 });
  });

  it("is refused when it points at another account's file", () => {
    expect(
      normalizePhotoBackgroundRecord({ ...cached, storagePath: "users/bob/appBackgrounds/f1/background.jpg" }, "alice")
    ).toBeNull();
    expect(parseCachedPhotoBackground(JSON.stringify({ ...cached, userId: "bob" }))).toBeNull();
  });

  it("is refused when a value could do more than set a colour", () => {
    expect(
      parseCachedPhotoBackground(
        JSON.stringify({ ...cached, vars: { ...cached.vars, "--photo-text": "red; background: url(https://x.test)" } })
      )
    ).toBeNull();
    expect(parseCachedPhotoBackground(JSON.stringify({ ...cached, imageUrl: 'https://x.test/a")' }))).toBeNull();
    expect(parseCachedPhotoBackground("{not json")).toBeNull();
  });

  it("drops a sample that does not match its own size rather than reading past it", () => {
    const broken = { ...cached, sample: { width: 16, height: 16, data: "AAAA" } };
    expect(normalizePhotoBackgroundRecord(broken, "alice")).not.toHaveProperty("sample");
  });

  it("tells a photo saved before uploads were sharpened from one saved after", () => {
    // The old pipeline's detail is gone from the stored file, so the card asks for the photo again.
    expect(isSoftPhotoBackground("users/alice/appBackgrounds/f1/background.jpg")).toBe(true);
    for (const extension of ["webp", "jpg"]) {
      expect(
        isSoftPhotoBackground(`users/alice/appBackgrounds/f2/${SHARP_PHOTO_BACKGROUND_FILE_STEM}.${extension}`)
      ).toBe(false);
    }
  });
});

describe("a small background image", () => {
  it("is measured as stretched well past sharp on a retina laptop", () => {
    // A 736 x 1177 wallpaper covering a 1440 x 900 window at 2x.
    const stretch = photoBackgroundStretch({
      imageWidth: 736,
      imageHeight: 1177,
      screenWidth: 1440,
      screenHeight: 900,
      pixelRatio: 2,
      zoom: 1,
    });
    expect(stretch).toBeCloseTo(3.91, 2);
    expect(
      photoBackgroundStretch({ imageWidth: 3840, imageHeight: 2400, screenWidth: 1440, screenHeight: 900, pixelRatio: 2, zoom: 1 })
    ).toBeLessThan(1);
  });

  it("is uploaded untouched when it needs no shrinking, rather than compressed again", () => {
    expect(shouldKeepOriginalPhoto({ type: "image/jpeg", size: 120_000, scale: 1 })).toBe(true);
    expect(shouldKeepOriginalPhoto({ type: "image/png", size: 120_000, scale: 1 })).toBe(true);
    // Shrunk, in a format Storage refuses, or over its limit: re-encoded instead.
    expect(shouldKeepOriginalPhoto({ type: "image/jpeg", size: 120_000, scale: 0.5 })).toBe(false);
    // A graphic that was enlarged and sharpened is its own new file.
    expect(shouldKeepOriginalPhoto({ type: "image/jpeg", size: 120_000, scale: 3.9 })).toBe(false);
    expect(shouldKeepOriginalPhoto({ type: "image/heic", size: 120_000, scale: 1 })).toBe(false);
    expect(shouldKeepOriginalPhoto({ type: "image/png", size: 20 * 1024 * 1024, scale: 1 })).toBe(false);
  });
});

describe("solid panels over a background", () => {
  it("are stamped by the head script before the first paint, only when chosen", () => {
    expect(run({ [PANEL_STYLE_STORAGE_KEY]: "solid" }).classes).toContain(SOLID_PANELS_CLASS_NAME);
    expect(run({ [PANEL_STYLE_STORAGE_KEY]: "glass" }).classes).not.toContain(SOLID_PANELS_CLASS_NAME);
    expect(run({}).classes).not.toContain(SOLID_PANELS_CLASS_NAME);
  });

  it("make the photo's and the sky's panels opaque", () => {
    expect(globalsCss).toContain("html.panels-solid.photo-background-enabled");
    expect(globalsCss).toContain("html.panels-solid body.constellation-background-enabled .app-panel");
  });
});

/*
 * A photo that is white on the left and black on the right needs light glass
 * over one half and dark glass over the other, so moving it has to move the
 * colours too -- and a zoomed view has to take its colours from everything any
 * screen could show around the chosen point.
 */
describe("the colours follow the part of the photo in view", () => {
  const halves = pixels(32, 32, (x) => (x < 16 ? [250, 250, 250] : [5, 5, 5]));
  const sample = encodePhotoBackgroundSample(halves, 32, 32);

  it("sees the whole photo unzoomed, and only the chosen side when zoomed in on it", () => {
    expect(photoBackgroundViewPixels(sample, { focusX: 50, focusY: 50, zoom: 1 })).toHaveLength(32 * 32 * 4);
    const left = photoBackgroundViewPixels(sample, { focusX: 0, focusY: 50, zoom: 2 });
    expect(left).toHaveLength(16 * 16 * 4);
    expect(left.every((value, index) => index % 4 === 3 || value === 250)).toBe(true);
  });

  it("gives each side the glass it needs", () => {
    expect(derivePhotoBackgroundPaletteForView(sample, { focusX: 0, focusY: 50, zoom: 2 }).scheme).toBe("light");
    expect(derivePhotoBackgroundPaletteForView(sample, { focusX: 100, focusY: 50, zoom: 2 }).scheme).toBe("dark");
  });
});

describe("the photo is on the document before the first paint", () => {
  it("stamps the photo's classes, colours and position instead of the theme's", () => {
    const { classes, properties } = run({
      "jami:app-theme": "pink",
      [PHOTO_BACKGROUND_STORAGE_KEY]: JSON.stringify(cached),
    });
    expect(classes).toEqual(["photo-background-enabled", `photo-background-${dark.scheme}`]);
    expect(properties["--photo-image"]).toBe(`url("${cached.imageUrl}")`);
    expect(properties["--photo-text"]).toBe(dark.vars["--photo-text"]);
    expect(properties["--photo-position"]).toBe("30% 70%");
    expect(properties["--photo-zoom"]).toBe("1.5");
  });

  it("leaves the position alone when the record has none", () => {
    const older = without(cached, ["focusX", "focusY", "zoom"]);
    const { properties } = run({ [PHOTO_BACKGROUND_STORAGE_KEY]: JSON.stringify(older) });
    expect(properties["--photo-position"]).toBeUndefined();
    expect(properties["--photo-zoom"]).toBeUndefined();
  });

  it("lets the sky win when both are on, because the sky was the later choice", () => {
    expect(
      run({
        "constellation-background-enabled": "true",
        [PHOTO_BACKGROUND_STORAGE_KEY]: JSON.stringify(cached),
      }).classes
    ).toEqual(["constellation-background-enabled"]);
  });

  it("shows the photo behind notebooks and past-paper questions, since a still photo costs the ink nothing", () => {
    for (const path of ["/dashboard/notebooks/abc", "/dashboard/practice/questions/s1"]) {
      const { classes } = run(
        { "jami:app-theme": "pink", [PHOTO_BACKGROUND_STORAGE_KEY]: JSON.stringify(cached) },
        path
      );
      expect(classes, path).toEqual(["photo-background-enabled", `photo-background-${dark.scheme}`]);
    }
  });

  /*
   * The constellation page was the last one left out. Its sky is a panel of its
   * own, so the photo sits around it like every other page rather than behind
   * the stars.
   */
  it("shows the photo on the constellation page too", () => {
    const { classes, properties } = run(
      { "jami:app-theme": "pink", [PHOTO_BACKGROUND_STORAGE_KEY]: JSON.stringify(cached) },
      "/dashboard/constellation"
    );
    expect(classes).toEqual(["photo-background-enabled", `photo-background-${dark.scheme}`]);
    expect(properties["--photo-image"]).toBe(`url("${cached.imageUrl}")`);
  });

  it("shows no photo on a notebook while the sky is the chosen background", () => {
    // The sky cannot be drawn there, but it is still the later choice, so the theme shows.
    const { classes } = run(
      {
        "jami:app-theme": "pink",
        "constellation-background-enabled": "true",
        [PHOTO_BACKGROUND_STORAGE_KEY]: JSON.stringify(cached),
      },
      "/dashboard/notebooks/abc"
    );
    expect(classes).toEqual(getActiveAppThemeClassNames("pink"));
  });

  it("falls back to the theme rather than blanking the page on a bad record", () => {
    for (const bad of ["{not json", JSON.stringify({ ...cached, imageUrl: 'https://x.test/a")' })]) {
      expect(run({ "jami:app-theme": "black", [PHOTO_BACKGROUND_STORAGE_KEY]: bad }).classes).toEqual(
        getActiveAppThemeClassNames("black")
      );
    }
  });

  it("never sets a value that could escape its property", () => {
    const { properties } = run({
      [PHOTO_BACKGROUND_STORAGE_KEY]: JSON.stringify({
        ...cached,
        vars: { ...cached.vars, "--photo-text": "red; background: url(https://x.test)" },
      }),
    });
    expect(properties["--photo-text"]).toBeUndefined();
  });
});

/**
 * The photo's palette has to cover everything a colour theme can set, or the
 * theme's value shows through -- the leak the star sky once had. Tokens shared
 * by both schemes live in the main block; status colours differ by scheme, so
 * each scheme's block has to supply the rest.
 */
describe("the photo palette leaves nothing to the colour theme", () => {
  function block(selector: string) {
    const start = globalsCss.indexOf(`${selector},`);
    expect(start, selector).toBeGreaterThan(-1);
    const open = globalsCss.indexOf("{", start);
    const close = globalsCss.indexOf("\n}", open);
    return globalsCss.slice(open, close);
  }

  function tokensSetByThemes() {
    const tokens = new Set<string>();
    for (const theme of ["purple", "pink", "paper-white", "soft-grey", "black"]) {
      const start = globalsCss.search(new RegExp(`body\\.app-theme-${theme}(?![\\w-])`));
      if (start < 0) continue;
      const open = globalsCss.indexOf("{", start);
      const close = globalsCss.indexOf("\n  }", open);
      for (const match of globalsCss.slice(open, close).matchAll(/(--[\w-]+)\s*:/g)) tokens.add(match[1]);
    }
    return tokens;
  }

  it("sets every custom property any theme sets, for both schemes", () => {
    const main = block("html.photo-background-enabled");
    for (const scheme of ["dark", "light"]) {
      const schemeBlock = block(`html.photo-background-${scheme}`);
      const missing = [...tokensSetByThemes()].filter(
        (token) => !new RegExp(`${token}\\s*:`).test(main) && !new RegExp(`${token}\\s*:`).test(schemeBlock)
      );
      expect(missing, scheme).toEqual([]);
    }
  });

  it("stays outside @layer, so it outranks the layered theme blocks", () => {
    const photoIndex = globalsCss.indexOf("html.photo-background-enabled,");
    expect(photoIndex).toBeGreaterThan(-1);
    for (const layer of globalsCss.matchAll(/^@layer [\w, ]+\{/gm)) {
      const open = layer.index ?? 0;
      const close = globalsCss.indexOf("\n}", open);
      expect(photoIndex > open && photoIndex < close).toBe(false);
    }
  });
});
