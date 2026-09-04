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
  /** Switch the field into this index mode once the key has been typed. */
  then?: IndexMode;
  /** Keys that do something cleverer than typing their own text. */
  action?: "fraction";
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

/** Operators and relations, from foundation GCSE up to A-level. */
const MATHS: RawKey[] = [
  c("×", "Multiply"),
  c("÷", "Divide"),
  c("±", "Plus or minus"),
  c("·", "Dot product"),
  c("≈", "Approximately equal"),
  c("≠", "Not equal"),
  c("≡", "Identical to"),
  c("≤", "Less than or equal"),
  c("≥", "Greater than or equal"),
  c("∝", "Proportional to"),
  c("∞", "Infinity"),
  c("°", "Degree"),
  c("′", "Prime"),
  c("√", "Square root"),
  c("∛", "Cube root"),
  c("π", "Pi"),
  c("∑", "Sum"),
  c("∫", "Integral"),
  c("∴", "Therefore"),
  c("∵", "Because"),
  c("∠", "Angle"),
  c("⊥", "Perpendicular"),
  c("∥", "Parallel"),
  // A combining macron: it lands on the character before it, so x then this
  // reads as one x-bar rather than two glyphs.
  { label: "x̄", insert: "̄", name: "Bar, for a mean" },
];

/** The Greek letters that name quantities in the specifications. */
const GREEK: RawKey[] = [
  c("α", "Alpha"),
  c("β", "Beta"),
  c("γ", "Gamma"),
  c("δ", "Delta, small change"),
  c("ε", "Epsilon"),
  c("η", "Eta, efficiency"),
  c("θ", "Theta, angle"),
  c("λ", "Lambda, wavelength"),
  c("μ", "Mu"),
  c("ν", "Nu, frequency"),
  c("ρ", "Rho, density"),
  c("σ", "Sigma"),
  c("τ", "Tau"),
  c("φ", "Phi"),
  c("ω", "Omega, angular velocity"),
  c("Δ", "Change in"),
  c("Σ", "Capital sigma, sum"),
  c("Φ", "Capital phi, flux"),
  c("Ω", "Ohm"),
];

/** Physics and chemistry: reactions, states, charges and units. */
const SCIENCE: RawKey[] = [
  c("→", "Reacts to give"),
  c("⇌", "Reversible reaction"),
  c("↑", "Gas given off"),
  c("↓", "Precipitate forms"),
  c("⁺", "Positive charge"),
  c("⁻", "Negative charge"),
  { label: "(aq)", insert: "(aq)", name: "Aqueous" },
  { label: "(s)", insert: "(s)", name: "Solid" },
  { label: "(l)", insert: "(l)", name: "Liquid" },
  { label: "(g)", insert: "(g)", name: "Gas" },
  c("℃", "Degrees Celsius"),
  c("µ", "Micro"),
];

/** A-level maths: set notation, quantifiers and implication. */
const SETS: RawKey[] = [
  c("∈", "Is a member of"),
  c("∉", "Is not a member of"),
  c("⊂", "Is a proper subset of"),
  c("⊆", "Is a subset of"),
  c("∪", "Union"),
  c("∩", "Intersection"),
  c("∅", "Empty set"),
  c("ℕ", "Natural numbers"),
  c("ℤ", "Integers"),
  c("ℚ", "Rational numbers"),
  c("ℝ", "Real numbers"),
  c("⇒", "Implies"),
  c("⇔", "If and only if"),
  c("∀", "For all"),
  c("∃", "There exists"),
  c("|", "Such that"),
];

export const SYMBOL_GROUPS: SymbolGroup[] = [
  group("maths", "Maths", MATHS),
  group("symbols", "Symbols", GREEK),
  group("science", "Science", SCIENCE),
  group("sets", "Sets", SETS),
];

/**
 * The bottom row, present whatever tab is showing.
 *
 * Two of these are modes rather than characters, which is why they sit apart
 * from the groups: like Shift, they change what the next keystroke does instead
 * of typing something themselves.
 */
export const INDEX_KEYS: SymbolKey[] = [
  {
    id: "index:fraction",
    label: "a⁄b",
    insert: FRACTION_SLASH,
    name: "Fraction",
    action: "fraction",
    then: "sub",
  },
  {
    id: "index:standard-form",
    label: "×10ⁿ",
    insert: "×10",
    name: "Standard form",
    then: "super",
  },
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

type EditableField = HTMLInputElement | HTMLTextAreaElement;

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

export const ALL_SYMBOL_KEYS: SymbolKey[] = [
  ...SYMBOL_GROUPS.flatMap((entry) => entry.keys),
  ...INDEX_KEYS,
];

const RECENTS_KEY = "jami:symbol-keyboard-recents";
const MAX_RECENTS = 8;

/** The keys this student reaches for, most recent first. */
export function readSymbolRecents(): SymbolKey[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const ids = JSON.parse(raw) as unknown;
    if (!Array.isArray(ids)) return [];
    return ids
      .map((id) => ALL_SYMBOL_KEYS.find((key) => key.id === id))
      .filter((key): key is SymbolKey => Boolean(key))
      .slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

export function rememberSymbol(key: SymbolKey, current: SymbolKey[]) {
  const next = [key, ...current.filter((entry) => entry.id !== key.id)].slice(
    0,
    MAX_RECENTS
  );
  try {
    window.localStorage.setItem(
      RECENTS_KEY,
      JSON.stringify(next.map((entry) => entry.id))
    );
  } catch {
    // A convenience, not something worth failing a keystroke over.
  }
  return next;
}
