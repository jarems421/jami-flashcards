// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ALL_SYMBOL_KEYS,
  applyFraction,
  FRACTION_SLASH,
  INDEX_KEYS,
  insertKeyIntoField,
  insertTextIntoField,
  readSymbolRecents,
  rememberSymbol,
  planFraction,
  SYMBOL_GROUPS,
  toIndexForm,
  type SymbolKey,
} from "@/lib/ui/symbol-keyboard";

function field(value: string, start = value.length, end = start) {
  const node = document.createElement("input");
  node.value = value;
  document.body.append(node);
  node.setSelectionRange(start, end);
  return node;
}

function key(name: string): SymbolKey {
  const found = ALL_SYMBOL_KEYS.filter((entry) => entry.name === name);
  if (found.length === 0) throw new Error(`no key named ${name}`);
  return found[0];
}

beforeEach(() => {
  window.localStorage.clear();
  document.body.replaceChildren();
});

describe("the key set", () => {
  it("offers four groups and no empty one", () => {
    expect(SYMBOL_GROUPS.map((entry) => entry.label)).toEqual([
      "Maths",
      "Symbols",
      "Science",
      "Sets",
    ]);
    for (const entry of SYMBOL_GROUPS) {
      expect(entry.keys.length, `${entry.id} is empty`).toBeGreaterThan(0);
    }
  });

  /*
   * The whole point of the rewrite. A key that typed `$\frac{}{}$` left the
   * student looking at braces and backslashes, which is exactly what a symbol
   * keyboard is meant to save them from.
   */
  it("types no LaTeX anywhere", () => {
    for (const entry of ALL_SYMBOL_KEYS) {
      expect(entry.insert, `${entry.name} types LaTeX`).not.toMatch(/[\\{}$]/);
    }
  });

  it("stays short enough to scan", () => {
    // Leaner than the set it replaced, which ran to 132 keys. Everything here
    // has to be something a GCSE or A-level student writes and cannot type.
    const total = SYMBOL_GROUPS.reduce(
      (sum, entry) => sum + entry.keys.length,
      0
    );
    expect(total).toBeLessThanOrEqual(80);
    for (const entry of SYMBOL_GROUPS) {
      expect(
        entry.keys.length,
        `${entry.id} is overstuffed`
      ).toBeLessThanOrEqual(24);
    }
  });

  it("names and labels every key", () => {
    for (const entry of ALL_SYMBOL_KEYS) {
      expect(entry.label.trim()).not.toBe("");
      expect(entry.insert).not.toBe("");
      expect(entry.name.trim()).not.toBe("");
    }
  });

  it("gives every key an id unique across the whole set", () => {
    // Recents are stored by id, so two keys sharing one would restore wrongly.
    const ids = ALL_SYMBOL_KEYS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("carries no preset fractions or index digits", () => {
    const labels = ALL_SYMBOL_KEYS.map((entry) => entry.label);
    for (const dropped of ["½", "⅓", "¼", "¾", "²", "³", "₂", "₃", "₄"]) {
      expect(labels, `${dropped} should come from a key or mode`).not.toContain(
        dropped
      );
    }
  });

  it("keeps the general fraction key", () => {
    const fraction = key("Fraction");
    expect(fraction.action).toBe("fraction");
    // Subscript is armed afterwards so the denominator arrives lowered.
    expect(fraction.then).toBe("sub");
  });

  it("keeps standard form, which nobody can type", () => {
    expect(INDEX_KEYS.map((entry) => entry.name)).toContain("Standard form");
    expect(key("Standard form").then).toBe("super");
  });
});

describe("raising and lowering a typed character", () => {
  it("raises digits, signs and brackets", () => {
    expect(toIndexForm("2", "super")).toBe("²");
    expect(toIndexForm("-", "super")).toBe("⁻");
    expect(toIndexForm("(", "super")).toBe("⁽");
    expect(toIndexForm("n", "super")).toBe("ⁿ");
  });

  it("lowers the ones chemistry needs", () => {
    expect(toIndexForm("2", "sub")).toBe("₂");
    expect(toIndexForm("4", "sub")).toBe("₄");
    expect(toIndexForm("x", "sub")).toBe("ₓ");
  });

  /*
   * Unicode has no superscript q and no subscript b. Returning null is what
   * tells the keyboard to leave the mode and type the character normally,
   * rather than swallowing the keystroke.
   */
  it("returns null for a character with no raised form", () => {
    expect(toIndexForm("q", "super")).toBeNull();
    expect(toIndexForm("b", "sub")).toBeNull();
    expect(toIndexForm(" ", "super")).toBeNull();
  });

  it("accepts a capital by falling back to its lowercase form", () => {
    expect(toIndexForm("N", "super")).toBe("ⁿ");
  });

  it("builds a whole exponent one character at a time", () => {
    const typed = ["-", "3"]
      .map((character) => toIndexForm(character, "super"))
      .join("");
    expect(`x${typed}`).toBe("x⁻³");
  });
});

describe("writing into a field", () => {
  it("appends at the end when the caret is at the end", () => {
    const node = field("20");
    expect(insertKeyIntoField(node, key("Degree"))).toBe("20°");
  });

  /*
   * The reason this function exists. Setting `.value` and moving on puts the
   * character at the end of whatever is in the box, which is wrong for anyone
   * who clicked back into the middle of an answer to fix it.
   */
  it("writes at the caret rather than the end", () => {
    const node = field("H2O", 1);
    expect(insertTextIntoField(node, "₂")).toBe("H₂2O");
    expect(node.selectionStart).toBe(2);
  });

  it("replaces a selection", () => {
    const node = field("H2O", 1, 2);
    expect(insertTextIntoField(node, "₂")).toBe("H₂O");
  });

  it("types a multi-character key whole", () => {
    const node = field("NaCl");
    expect(insertKeyIntoField(node, key("Aqueous"))).toBe("NaCl(aq)");
  });

  it("types standard form ready for its exponent", () => {
    const node = field("6.02 ");
    expect(insertKeyIntoField(node, key("Standard form"))).toBe("6.02 ×10");
  });

  /*
   * React caches the last value it wrote to a node and ignores an event whose
   * value matches it. Assigning `.value` directly leaves that cache intact, so
   * the character shows up and then disappears on the next keystroke. Going
   * through the prototype setter is what clears it.
   */
  it("fires a bubbling input event so React sees the change", () => {
    const node = field("a");
    const onInput = vi.fn();
    node.addEventListener("input", onInput);
    insertKeyIntoField(node, key("Pi"));
    expect(onInput).toHaveBeenCalledTimes(1);
    expect(onInput.mock.calls[0][0].bubbles).toBe(true);
  });

  it("works on a textarea as well as an input", () => {
    const node = document.createElement("textarea");
    node.value = "Energy is conserved";
    document.body.append(node);
    node.setSelectionRange(6, 6);
    expect(insertKeyIntoField(node, key("Change in"))).toBe(
      "EnergyΔ is conserved"
    );
  });
});

describe("remembering what gets used", () => {
  it("starts empty and puts the newest first", () => {
    expect(readSymbolRecents()).toEqual([]);
    rememberSymbol(key("Pi"), rememberSymbol(key("Degree"), []));
    expect(readSymbolRecents().map((entry) => entry.name)).toEqual([
      "Pi",
      "Degree",
    ]);
  });

  it("moves a repeat to the front instead of listing it twice", () => {
    const first = rememberSymbol(key("Degree"), []);
    const second = rememberSymbol(key("Pi"), first);
    rememberSymbol(key("Degree"), second);
    expect(readSymbolRecents().map((entry) => entry.name)).toEqual([
      "Degree",
      "Pi",
    ]);
  });

  it("survives nonsense in storage", () => {
    window.localStorage.setItem("jami:symbol-keyboard-recents", "{ not json");
    expect(readSymbolRecents()).toEqual([]);
  });
});

/*
 * One key, and no instruction to read. The student types the numerator as
 * normal, presses the key, and what they already wrote is lifted into the top
 * of the fraction.
 */
describe("the fraction key", () => {
  it("raises a number already typed and adds the slash", () => {
    expect(planFraction("3", 1)).toEqual({ from: 0, insert: `³${FRACTION_SLASH}` });
  });

  it("takes only the number, not the words in front of it", () => {
    const { from, insert } = planFraction("speed = 3", 9);
    expect(from).toBe(8);
    expect(insert).toBe(`³${FRACTION_SLASH}`);
  });

  it("carries a bracketed expression up whole", () => {
    expect(planFraction("(x+1)", 5).insert).toBe(`⁽ˣ⁺¹⁾${FRACTION_SLASH}`);
  });

  it("stops at a capital rather than quietly lowercasing it", () => {
    // A superscript N would read as n, which is a different quantity.
    expect(planFraction("N", 1)).toEqual({ from: 1, insert: FRACTION_SLASH });
  });

  it("gives a bare slash when there is nothing to raise", () => {
    expect(planFraction("", 0)).toEqual({ from: 0, insert: FRACTION_SLASH });
  });

  it("builds a readable fraction end to end", () => {
    const node = field("3");
    applyFraction(node);
    expect(node.value).toBe(`³${FRACTION_SLASH}`);
    // The denominator then arrives lowered, because the key arms subscript.
    insertTextIntoField(node, toIndexForm("4", "sub")!);
    expect(node.value).toBe("³⁄₄");
  });

  it("leaves what came before a fraction untouched", () => {
    const node = field("Probability is 1");
    applyFraction(node);
    insertTextIntoField(node, toIndexForm("6", "sub")!);
    expect(node.value).toBe("Probability is ¹⁄₆");
  });
});
