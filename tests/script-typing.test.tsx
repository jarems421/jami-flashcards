// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import SymbolKeyboard from "@/components/ui/SymbolKeyboard";
import {
  openScriptSlot,
  slotAfterBackspace,
  typeIntoScriptSlot,
  type ScriptSlot,
} from "@/lib/ui/script-typing";
import { insertTextIntoField } from "@/lib/ui/symbol-keyboard";

/** Types a string into a slot, the way the field would, returning the text written. */
function typeAll(slot: ScriptSlot | null, text: string) {
  let out = "";
  let current = slot;
  for (const character of text) {
    if (!current) {
      out += character;
      continue;
    }
    const result = typeIntoScriptSlot(current, character);
    out += result.insert ?? character;
    current = result.slot;
  }
  return { out, slot: current };
}

describe("typing into a power or subscript slot", () => {
  it("raises a whole power of any length, then comes back down", () => {
    expect(typeAll(openScriptSlot("super"), "42 + 1").out).toBe("⁴² + 1");
    // A leading sign belongs to the power; after a digit a sign is the next term.
    expect(typeAll(openScriptSlot("super"), "-1").out).toBe("⁻¹");
    expect(typeAll(openScriptSlot("super"), "2+1").out).toBe("²+1");
    // Brackets keep a sum raised until they close.
    expect(typeAll(openScriptSlot("super"), "(n+1)x").out).toBe("⁽ⁿ⁺¹⁾ˣ");
    expect(typeAll(openScriptSlot("super"), "2=").out).toBe("²=");
  });

  it("lowers subscripts and stops at a capital", () => {
    expect(typeAll(openScriptSlot("sub"), "2O").out).toBe("₂O");
  });

  it("goes from the top of a fraction to the bottom at a slash", () => {
    expect(typeAll(openScriptSlot("super", { numerator: true }), "3/4 ").out).toBe("³⁄₄ ");
  });

  it("reopens the power when its digit is deleted, so a new one takes its place", () => {
    // 7³, backspace: the next digit goes where the 3 was.
    const reopened = slotAfterBackspace("7³", 2);
    expect(reopened?.kind).toBe("super");
    expect(typeAll(reopened, "4").out).toBe("⁴");
    // Reopened by a delete, a sign is the next operator, not part of the power.
    expect(typeAll(slotAfterBackspace("x²", 2), "+1").out).toBe("+1");
    // Deleting an ordinary character opens nothing.
    expect(slotAfterBackspace("x+1", 3)).toBeNull();
    expect(slotAfterBackspace("H₂O₂", 4)?.kind).toBe("sub");
  });
});

/*
 * The keyboard on a real field: key presses and typing as a browser sends
 * them -- a cancellable beforeinput, then the text unless it was cancelled.
 */
describe("the maths keyboard on a field", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  function mount() {
    const ref = createRef<HTMLInputElement>();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => {
      root!.render(
        <div>
          <input ref={ref} defaultValue="" />
          <SymbolKeyboard targetRef={ref} />
        </div>
      );
    });
    const field = ref.current!;
    field.focus();
    return field;
  }

  function type(field: HTMLInputElement, text: string) {
    for (const character of text) {
      const event = new InputEvent("beforeinput", { data: character, inputType: "insertText", bubbles: true, cancelable: true });
      act(() => {
        if (field.dispatchEvent(event)) insertTextIntoField(field, character);
      });
    }
  }

  function backspace(field: HTMLInputElement) {
    const event = new InputEvent("beforeinput", { inputType: "deleteContentBackward", bubbles: true, cancelable: true });
    act(() => {
      if (!field.dispatchEvent(event)) return;
      const caret = field.selectionStart ?? field.value.length;
      field.setSelectionRange(caret - 1, caret);
      insertTextIntoField(field, "");
    });
  }

  function press(label: string) {
    const key = Array.from(document.querySelectorAll("button")).find(
      (button) => button.getAttribute("aria-label") === label
    );
    if (!key) throw new Error(`no key ${label}`);
    act(() => {
      key.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      key.click();
    });
  }

  function arrowRight(field: HTMLInputElement) {
    act(() => {
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    });
  }

  const status = () => document.querySelector('[role="status"]')?.textContent ?? null;

  it("writes 7 to the power of 42 and carries on, saying so while it is raised", () => {
    const field = mount();
    press("Maths symbols");
    type(field, "7");
    press("Power: type the power next");
    expect(status()).toMatch(/Power/);
    type(field, "42");
    arrowRight(field);
    expect(status()).toBeNull();
    type(field, "+1");
    expect(field.value).toBe("7⁴²+1");
  });

  it("swaps a power: 7³, delete, 4 gives 7⁴", () => {
    const field = mount();
    press("Maths symbols");
    type(field, "7");
    press("Squared");
    expect(field.value).toBe("7²");
    backspace(field);
    type(field, "4");
    expect(field.value).toBe("7⁴");
  });

  it("opens a power with ^ from the ordinary keyboard", () => {
    const field = mount();
    type(field, "x^-1 ");
    expect(field.value).toBe("x⁻¹ ");
  });

  it("puts the caret inside a root's brackets", () => {
    const field = mount();
    press("Maths symbols");
    press("Square root");
    type(field, "x+1");
    expect(field.value).toBe("√(x+1)");
  });

  it("builds a fraction from what was typed, and from nothing", () => {
    const field = mount();
    press("Maths symbols");
    type(field, "3");
    press("Fraction");
    type(field, "4 ");
    expect(field.value).toBe("³⁄₄ ");

    press("Fraction");
    expect(status()).toMatch(/Fraction top/);
    type(field, "1/2");
    expect(field.value).toBe("³⁄₄ ¹⁄₂");
  });

  it("types standard form straight into its exponent", () => {
    const field = mount();
    press("Maths symbols");
    type(field, "6.02");
    press("Standard form");
    type(field, "23");
    expect(field.value).toBe("6.02×10²³");
  });
});
