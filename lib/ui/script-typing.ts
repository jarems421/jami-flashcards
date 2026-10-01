import {
  FRACTION_SLASH,
  scriptKindOf,
  toIndexForm,
  type IndexMode,
} from "@/lib/ui/symbol-keyboard";

/**
 * Typing into a power, a subscript or the bottom of a fraction, as though it
 * were a box.
 *
 * The fields stay plain text -- `7⁴²`, `H₂O`, `³⁄₄` -- because that is what
 * every answer, card and chat already stores and renders. What makes it feel
 * like a box is that, while a slot is open, ordinary typing goes into it:
 * press the power key, type 4 and 2, and they arrive raised; press → or Space
 * and you are back on the line. Delete a power digit and the slot reopens, so
 * the next digit replaces it where it was.
 *
 * An earlier version had a hidden version of this -- press a key, nothing
 * visible happens, and the next character came out raised -- and it read as a
 * broken button. This one is only ever on while the keyboard shows that it is,
 * and anything that is not part of an index ends it by itself.
 *
 * Pure: the keyboard component owns the field and the events; this decides.
 */
export type ScriptSlot = {
  kind: IndexMode;
  /** How many characters have gone into the slot. */
  typed: number;
  /** Open brackets inside the slot, so (n+1) stays raised to its close. */
  depth: number;
  /**
   * How it was opened. A slot the student opened takes a leading sign (x⁻¹);
   * one reopened by deleting a digit takes digits only, because a sign typed
   * there is far more often the next operator (x² deleted, then +1).
   */
  origin: "key" | "reopened";
  /** The top of a fraction, where / moves to the bottom. */
  numerator?: boolean;
};

export function openScriptSlot(kind: IndexMode, options: { numerator?: boolean } = {}): ScriptSlot {
  return { kind, typed: 0, depth: 0, origin: "key", ...(options.numerator ? { numerator: true } : {}) };
}

export type ScriptTypingResult = {
  /** What to write instead of the typed character, or null to let it through untouched. */
  insert: string | null;
  /** The slot afterwards, or null once it has closed. */
  slot: ScriptSlot | null;
};

const CLOSE: ScriptTypingResult = { insert: null, slot: null };

/** One typed character, while a slot is open. */
export function typeIntoScriptSlot(slot: ScriptSlot, character: string): ScriptTypingResult {
  if (character.length !== 1 || character === " ") return CLOSE;

  // The top of a fraction is finished with a slash; the bottom follows lowered.
  if (slot.numerator && (character === "/" || character === FRACTION_SLASH)) {
    return { insert: FRACTION_SLASH, slot: { kind: "sub", typed: 0, depth: 0, origin: "key" } };
  }

  if (slot.origin === "reopened" && !/[0-9]/.test(character)) return CLOSE;
  // A capital would be lowercased into a different letter; it is not part of the index.
  if (/[A-Z]/.test(character)) return CLOSE;
  if (character === "=") return CLOSE;

  if (character === "+" || character === "-") {
    // A sign leads an index (x⁻¹) or sits inside its brackets (xⁿ⁺¹ as x^(n+1));
    // after a digit it is the next term.
    if (slot.typed > 0 && slot.depth === 0) return CLOSE;
  }
  if (character === ")" && slot.depth === 0) return CLOSE;

  const form = toIndexForm(character, slot.kind);
  if (!form) return CLOSE;
  const depth = character === "(" ? slot.depth + 1 : character === ")" ? slot.depth - 1 : slot.depth;
  return { insert: form, slot: { ...slot, typed: slot.typed + 1, depth } };
}

/**
 * The slot a backspace leaves open, if any.
 *
 * Deleting a raised or lowered character -- or deleting back to one -- puts
 * the caret in that index again, so a digit typed next takes the place of the
 * one removed: 7³, delete, 4 gives 7⁴.
 *
 * `text` and `caret` are before the deletion; the caret is collapsed.
 */
export function slotAfterBackspace(text: string, caret: number): ScriptSlot | null {
  if (caret <= 0) return null;
  const deleted = scriptKindOf(text[caret - 1]);
  const before = scriptKindOf(text[caret - 2]);
  const kind = deleted ?? before;
  if (!kind) return null;
  // Whatever of that index is left before the caret.
  let typed = 0;
  for (let index = caret - 2; index >= 0 && scriptKindOf(text[index]) === kind; index -= 1) typed += 1;
  return { kind, typed, depth: 0, origin: "reopened" };
}

/** What the keyboard says while a slot is open. */
export function describeScriptSlot(slot: ScriptSlot) {
  if (slot.numerator) return "Fraction top · / for the bottom";
  return slot.kind === "super" ? "Power · → to finish" : "Subscript · → to finish";
}
