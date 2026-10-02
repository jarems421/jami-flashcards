/**
 * The keys a GCSE or A-level student cannot reach from their own keyboard.
 *
 * Nothing here types LaTeX. An earlier version did -- a fraction key wrote
 * `$\frac{}{}$` on the grounds that the app renders it later -- and what a
 * student saw while typing was a line of backslashes and braces, which is
 * exactly what a symbol keyboard is supposed to save them from. Everything now
 * types the finished character, so the field reads the way the answer reads.
 *
 * That leaves powers and indices, which are the one thing a fixed set of keys
 * cannot cover: there is no key for "to the power of whatever comes next".
 * Superscript and subscript are handled as *modes* instead, the way Shift is
 * handled on a real keyboard. Press the `x²` key and the next characters typed
 * on the real keyboard arrive as superscripts -- so `x`, mode, `-`, `3` gives
 * `x⁻³`, and any exponent works without a key of its own. That is also what
 * lets the keyboard stay short: no shelf of superscript digits, no preset
 * fractions, nothing spent on the handful of values somebody guessed at.
 *
 * The character set is chosen against GCSE and A-level papers. Each one has to
 * be something a student at that level actually writes and genuinely cannot
 * type; a symbol that only appears in a degree course is not on it.
 */

export type IndexMode = "super" | "sub";

/**
 * U+2044, not the ordinary slash.
 *
 * Set between a raised numerator and a lowered denominator it draws a real
 * fraction -- 3/4 becomes ³⁄₄ -- in any font, with no maths rendering involved.
 * An ordinary "/" between full-size digits does not.
 */
export const FRACTION_SLASH = "⁄";

export type SymbolKey = {
  /**
   * Stable identity, unique across every group.
   *
   * Separate from `name` because a character can honestly belong in two groups,
   * and the recents list has to be able to tell those two keys apart. Built
   * from the group and a slug of the name rather than a position, so reordering
   * a group does not silently remap somebody's recents onto different keys.
   */
  id: string;
  /** What the key shows, and what it types. */
  label: string;
  insert: string;
  /** Announced by screen readers and shown on hover. */
  name: string;
  /** Keys that do something cleverer than typing their own text. */
  /**
   * Keys that do more than type their own text: the fraction lifts what was
   * typed into its top, standard form and the power and subscript keys open a
   * slot that typing goes into (see `script-typing.ts`), and a root opens
   * brackets with the caret inside.
   */
  action?: "fraction" | "standard-form" | "power" | "subscript" | "root";
};

export type SymbolGroup = {
  id: string;
  label: string;
  keys: SymbolKey[];
};

type RawKey = Omit<SymbolKey, "id">;

const c = (char: string, name: string): RawKey => ({
  label: char,
  insert: char,
  name,
});

function group(id: string, label: string, keys: RawKey[]): SymbolGroup {
  return {
    id,
    label,
    keys: keys.map((key) => ({
      ...key,
      id: `${id}:${key.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    })),
  };
}

/*
 * Laid out like a scientific calculator: four short tabs, six keys to a row,
 * and each row one kind of thing, so a key is found by where it sits rather
 * than by reading every glyph. The first tab holds the essentials and is the
 * one that opens; the rest hold what a particular subject needs.
 *
 * Deliberately not everything. It used to run to five tabs of up to 24 keys in
 * eight tight columns, with a recents row on top -- a grid of near-identical
 * glyphs a student had to search. A key earns a place here only if students at
 * GCSE, A-level or first-year university write it and cannot type it.
 */

/** The two keys that do more than type a character. */
export const INDEX_KEYS: SymbolKey[] = [
  {
    id: "maths:fraction",
    label: "a⁄b",
    insert: FRACTION_SLASH,
    name: "Fraction",
    action: "fraction",
  },
  {
    id: "maths:standard-form",
    label: "×10ⁿ",
    insert: "×10",
    name: "Standard form",
    action: "standard-form",
  },
];

/** Labelled with an x so a power key reads as a power, not a stray digit. */
const power = (char: string, name: string): RawKey => ({
  label: `x${char}`,
  insert: char,
  name,
});

/** Opens first: powers and roots, operators, relations, the common symbols. */
const MATHS: RawKey[] = [
  // Powers and roots: each one a slot to type into, not a fixed character.
  power("²", "Squared"),
  { label: "xⁿ", insert: "", name: "Power: type the power next", action: "power" },
  { label: "xₙ", insert: "", name: "Subscript: type it next", action: "subscript" },
  { label: "√", insert: "√()", name: "Square root", action: "root" },
  { label: "∛", insert: "∛()", name: "Cube root", action: "root" },
  INDEX_KEYS[0],
  // Operators
  c("×", "Multiply"),
  c("÷", "Divide"),
  c("±", "Plus or minus"),
  c("≠", "Not equal"),
  c("≈", "Approximately equal"),
  INDEX_KEYS[1],
  // Relations and symbols
  c("≤", "Less than or equal"),
  c("≥", "Greater than or equal"),
  c("π", "Pi"),
  c("°", "Degree"),
  c("∞", "Infinity"),
  c("θ", "Theta, angle"),
  // Change, calculus and argument
  c("Δ", "Change in"),
  c("∫", "Integral"),
  c("∑", "Sum"),
  c("→", "Tends to, or gives"),
  c("∴", "Therefore"),
  c("∠", "Angle"),
];

/** Raised in the top two rows, lowered in the bottom two. */
const POWERS: RawKey[] = [
  c("⁰", "To the power zero"),
  c("¹", "To the power one"),
  c("²", "Squared"),
  c("³", "Cubed"),
  c("⁴", "To the power four"),
  c("⁵", "To the power five"),
  c("⁶", "To the power six"),
  c("⁷", "To the power seven"),
  c("⁸", "To the power eight"),
  c("⁹", "To the power nine"),
  c("⁻", "Negative power"),
  c("ⁿ", "To the power n"),
  c("₀", "Subscript zero"),
  c("₁", "Subscript one"),
  c("₂", "Subscript two"),
  c("₃", "Subscript three"),
  c("₄", "Subscript four"),
  c("₅", "Subscript five"),
  c("₆", "Subscript six"),
  c("₇", "Subscript seven"),
  c("₈", "Subscript eight"),
  c("₉", "Subscript nine"),
  c("ₙ", "Subscript n"),
  c("ₓ", "Subscript x"),
];

/** The Greek letters that name quantities, lower case then capitals. */
const GREEK: RawKey[] = [
  c("α", "Alpha"),
  c("β", "Beta"),
  c("γ", "Gamma"),
  c("δ", "Delta, small change"),
  c("ε", "Epsilon"),
  c("θ", "Theta"),
  c("λ", "Lambda, wavelength"),
  c("μ", "Mu, micro"),
  c("π", "Pi"),
  c("ρ", "Rho, density"),
  c("σ", "Sigma"),
  c("ω", "Omega, angular velocity"),
  c("Δ", "Capital delta"),
  c("Σ", "Capital sigma, sum"),
  c("Φ", "Capital phi, flux"),
  c("Ω", "Ohm"),
  c("η", "Eta, efficiency"),
  c("φ", "Phi"),
];

/** Reactions, charges, states and units. */
const SCIENCE: RawKey[] = [
  c("→", "Reacts to give"),
  c("⇌", "Reversible reaction"),
  c("↑", "Gas given off"),
  c("↓", "Precipitate forms"),
  c("⁺", "Positive charge"),
  { label: "⁻", insert: "⁻", name: "Negative charge" },
  { label: "(aq)", insert: "(aq)", name: "Aqueous" },
  { label: "(s)", insert: "(s)", name: "Solid" },
  { label: "(l)", insert: "(l)", name: "Liquid" },
  { label: "(g)", insert: "(g)", name: "Gas" },
  c("℃", "Degrees Celsius"),
  c("Ω", "Ohms"),
];

/** Every tab is six keys wide; the keyboard draws it that way. */
export const SYMBOL_KEYBOARD_COLUMNS = 6;

export const SYMBOL_GROUPS: SymbolGroup[] = [
  group("maths", "Maths", MATHS),
  group("powers", "Powers", POWERS),
  group("greek", "Greek", GREEK),
  group("science", "Science", SCIENCE),
];

const SUPERSCRIPTS: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
  "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾",
  a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", e: "ᵉ", f: "ᶠ", g: "ᵍ", h: "ʰ",
  i: "ⁱ", j: "ʲ", k: "ᵏ", l: "ˡ", m: "ᵐ", n: "ⁿ", o: "ᵒ", p: "ᵖ",
  r: "ʳ", s: "ˢ", t: "ᵗ", u: "ᵘ", v: "ᵛ", w: "ʷ", x: "ˣ", y: "ʸ", z: "ᶻ",
};

const SUBSCRIPTS: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄",
  "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎",
  a: "ₐ", e: "ₑ", h: "ₕ", i: "ᵢ", j: "ⱼ", k: "ₖ", l: "ₗ", m: "ₘ",
  n: "ₙ", o: "ₒ", p: "ₚ", r: "ᵣ", s: "ₛ", t: "ₜ", u: "ᵤ", v: "ᵥ", x: "ₓ",
};

/**
 * The raised or lowered form of a typed character, if there is one.
 *
 * `q` has no superscript in Unicode and neither do most capitals, so the answer
 * is often null. The caller treats that as "this is not part of the index" and
 * leaves the mode, which is what a student means when they finish an exponent
 * and carry on writing.
 */
export function toIndexForm(character: string, mode: IndexMode): string | null {
  const table = mode === "super" ? SUPERSCRIPTS : SUBSCRIPTS;
  return table[character] ?? table[character.toLowerCase()] ?? null;
}

const RAISED = new Set(Object.values(SUPERSCRIPTS));
const LOWERED = new Set(Object.values(SUBSCRIPTS));

/** Whether a character is already raised or lowered, and which. */
export function scriptKindOf(character: string | undefined): IndexMode | null {
  if (!character) return null;
  if (RAISED.has(character)) return "super";
  if (LOWERED.has(character)) return "sub";
  return null;
}

export type EditableField = HTMLInputElement | HTMLTextAreaElement;

/**
 * Write text into a field as though the student had typed it.
 *
 * Setting `.value` directly is not enough. React tracks the last value it wrote
 * to the node, sees no difference on the next event, and swallows the change --
 * so the character appears until the next keystroke and then vanishes. Calling
 * the prototype's own setter updates the node *and* clears that cached value,
 * and the dispatched `input` event is then indistinguishable from a real one.
 *
 * The caret lands after what was written rather than at the end, so a character
 * dropped into the middle of an answer does not send the cursor to the end.
 */
export function insertTextIntoField(field: EditableField, text: string) {
  const start = field.selectionStart ?? field.value.length;
  const end = field.selectionEnd ?? start;
  const next = field.value.slice(0, start) + text + field.value.slice(end);

  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setValue = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setValue) setValue.call(field, next);
  else field.value = next;

  const caret = start + text.length;
  field.setSelectionRange?.(caret, caret);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  return next;
}

export function insertKeyIntoField(field: EditableField, key: SymbolKey) {
  return insertTextIntoField(field, key.insert);
}

/** The most a fraction key will reach back for, so it cannot eat a sentence. */
const MAX_NUMERATOR = 8;

/**
 * Turn what has just been typed into the top of a fraction.
 *
 * This is what makes one key enough. A student writes `3`, presses the fraction
 * key, and the 3 they already typed is lifted into a superscript with a
 * fraction slash after it -- so `3` becomes `³⁄` and the denominator follows in
 * subscript, giving `³⁄₄`. No second key, no instruction to read, and it works
 * for `(x+1)⁄2` as readily as for a half.
 *
 * The run stops at the first character with no raised form, which is what keeps
 * it from swallowing the words in front of it: in "speed = 3", only the 3 is
 * taken, because the space before it cannot be raised.
 *
 * Returns where the replacement starts and what goes there. An empty run is
 * fine and gives a bare slash -- the student can go back and raise the top
 * themselves.
 */
export function planFraction(text: string, caret: number) {
  const raised: string[] = [];
  let from = caret;
  while (from > 0 && raised.length < MAX_NUMERATOR) {
    const character = text[from - 1];
    // Digits, lowercase letters, brackets and the two signs, which is what a
    // numerator is made of. Capitals are left alone rather than quietly
    // lowercased into a superscript that says something else, and a space or an
    // equals sign is where the expression starts.
    if (!/[0-9a-z()+-]/.test(character)) break;
    const form = toIndexForm(character, "super");
    if (!form) break;
    raised.unshift(form);
    from -= 1;
  }
  return { from, insert: raised.join("") + FRACTION_SLASH };
}

/**
 * Press the fraction key: raise the numerator already typed, add the slash.
 *
 * The caller arms subscript afterwards, so the denominator arrives lowered.
 */
export function applyFraction(field: EditableField) {
  const caret = field.selectionStart ?? field.value.length;
  const { from, insert } = planFraction(field.value, caret);
  field.setSelectionRange?.(from, caret);
  return insertTextIntoField(field, insert);
}

/** Every key, each once: the fraction and standard-form keys live in Maths. */
export const ALL_SYMBOL_KEYS: SymbolKey[] = SYMBOL_GROUPS.flatMap((entry) => entry.keys);
