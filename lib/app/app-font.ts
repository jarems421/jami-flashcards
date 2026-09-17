/**
 * The typeface Jami is set in, as one account's choice.
 *
 * A colour theme changes the room; the face changes the voice. The catalogue
 * below is one voice per entry -- a few moderns for people who want Jami to
 * stay quiet, a shelf of book serifs for people reading on it all evening, and
 * a small set of carved display faces for anyone who wants their notes to look
 * like they were found rather than typed.
 *
 * Only data here: the faces themselves are loaded in `app/fonts.ts`, and the
 * class stamped on the document points `--app-font` at the one in use. Kept
 * apart so the blocking script in the head, which runs before any font is
 * fetched, can read the stored id without pulling `next/font` with it.
 */

export const APP_FONT_STORAGE_KEY = "jami:app-font";
export const APP_FONT_EVENT = "jami-app-font-change";

export type AppFontId =
  | "urbanist"
  | "jost"
  | "outfit"
  | "manrope"
  | "raleway"
  | "josefin-sans"
  | "questrial"
  | "comfortaa"
  | "syne"
  | "cormorant-garamond"
  | "eb-garamond"
  | "spectral"
  | "literata"
  | "newsreader"
  | "lora"
  | "crimson-pro"
  | "playfair-display"
  | "bodoni-moda"
  | "fraunces"
  | "cinzel"
  | "marcellus"
  | "tenor-sans"
  | "forum"
  | "italiana"
  | "gilda-display";

/** Which shelf a face sits on in the chooser. */
export type AppFontFamilyKind = "modern" | "book" | "carved";

export type AppFontOption = {
  id: AppFontId;
  /** What the face is called, shown in the face itself. */
  label: string;
  /** One line on the register it sets, used as the option's description. */
  description: string;
  kind: AppFontFamilyKind;
};

export const DEFAULT_APP_FONT: AppFontId = "urbanist";

export const APP_FONT_GROUPS: Array<{ kind: AppFontFamilyKind; title: string; blurb: string }> = [
  { kind: "modern", title: "Clear", blurb: "Quiet geometric faces that stay out of the way." },
  { kind: "book", title: "Storybook", blurb: "Serifs made for long reading by lamplight." },
  { kind: "carved", title: "Mythic", blurb: "Carved and courtly faces, best at large sizes." },
];

export const APP_FONT_OPTIONS: AppFontOption[] = [
  { id: "urbanist", label: "Urbanist", description: "Jami's own face: round, airy, geometric.", kind: "modern" },
  { id: "jost", label: "Jost", description: "Bauhaus circles with a modern edge.", kind: "modern" },
  { id: "outfit", label: "Outfit", description: "Even and unfussy, built for screens.", kind: "modern" },
  { id: "manrope", label: "Manrope", description: "Softly squared, steady at small sizes.", kind: "modern" },
  { id: "raleway", label: "Raleway", description: "Slim and elegant with a light step.", kind: "modern" },
  { id: "josefin-sans", label: "Josefin Sans", description: "Tall, 1920s and a little dreamy.", kind: "modern" },
  { id: "questrial", label: "Questrial", description: "Plain circles, almost no personality.", kind: "modern" },
  { id: "comfortaa", label: "Comfortaa", description: "Rounded and gentle, like handwriting tidied up.", kind: "modern" },
  { id: "syne", label: "Syne", description: "Odd widths and a gallery-poster air.", kind: "modern" },
  { id: "cormorant-garamond", label: "Cormorant Garamond", description: "Fine, high-contrast and unmistakably old.", kind: "book" },
  { id: "eb-garamond", label: "EB Garamond", description: "The classic book face, warm and readable.", kind: "book" },
  { id: "spectral", label: "Spectral", description: "A screen serif with a scholarly calm.", kind: "book" },
  { id: "literata", label: "Literata", description: "Sturdy storytelling serif, easy for hours.", kind: "book" },
  { id: "newsreader", label: "Newsreader", description: "Ink-soft edges, like a printed page.", kind: "book" },
  { id: "lora", label: "Lora", description: "Brushed curves with a quiet confidence.", kind: "book" },
  { id: "crimson-pro", label: "Crimson Pro", description: "Old-style serif shaped for close reading.", kind: "book" },
  { id: "playfair-display", label: "Playfair Display", description: "High contrast and quietly dramatic.", kind: "book" },
  { id: "bodoni-moda", label: "Bodoni Moda", description: "Hairline strokes and sharp fashion-plate edges.", kind: "book" },
  { id: "fraunces", label: "Fraunces", description: "Wobbling, characterful and a bit enchanted.", kind: "book" },
  { id: "cinzel", label: "Cinzel", description: "Roman capitals cut into stone.", kind: "carved" },
  { id: "marcellus", label: "Marcellus", description: "Inscriptional and ceremonial.", kind: "carved" },
  { id: "tenor-sans", label: "Tenor Sans", description: "Wide, calm and softly antique.", kind: "carved" },
  { id: "forum", label: "Forum", description: "Flared strokes, like a carved title.", kind: "carved" },
  { id: "italiana", label: "Italiana", description: "Very fine and very formal.", kind: "carved" },
  { id: "gilda-display", label: "Gilda Display", description: "Delicate, gilded and storybook-grand.", kind: "carved" },
];

const FONT_IDS = new Set<string>(APP_FONT_OPTIONS.map((option) => option.id));

export const APP_FONT_CLASS_NAMES = APP_FONT_OPTIONS.map((option) => `app-font-${option.id}`);

export function isAppFontId(value: unknown): value is AppFontId {
  return typeof value === "string" && FONT_IDS.has(value);
}

export function getAppFontOption(id: AppFontId): AppFontOption {
  return APP_FONT_OPTIONS.find((option) => option.id === id) ?? APP_FONT_OPTIONS[0];
}

export function readAppFont(): AppFontId {
  if (typeof window === "undefined") return DEFAULT_APP_FONT;
  try {
    const value = window.localStorage.getItem(APP_FONT_STORAGE_KEY);
    if (isAppFontId(value)) return value;
  } catch {
    // Non-critical local display preference.
  }
  return DEFAULT_APP_FONT;
}

/** Stamps a face on the document now, so the change is instant everywhere. */
export function applyAppFontClass(id: AppFontId) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.remove(...APP_FONT_CLASS_NAMES);
  root.classList.add(`app-font-${id}`);
}

export function saveAppFont(id: AppFontId) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(APP_FONT_STORAGE_KEY, id);
  } catch {
    // Non-critical local display preference.
  }
  applyAppFontClass(id);
  window.dispatchEvent(new Event(APP_FONT_EVENT));
}
