"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  describeScriptSlot,
  openScriptSlot,
  slotAfterBackspace,
  typeIntoScriptSlot,
  type ScriptSlot,
} from "@/lib/ui/script-typing";
import {
  applyFraction,
  FRACTION_SLASH,
  insertKeyIntoField,
  insertTextIntoField,
  planFraction,
  SYMBOL_GROUPS,
  SYMBOL_KEYBOARD_COLUMNS,
  type SymbolKey,
} from "@/lib/ui/symbol-keyboard";

type SymbolKeyboardProps = {
  /** The field characters are written into. */
  targetRef: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  className?: string;
};

/*
 * Key styling, kept here rather than repeated at each call site.
 *
 * What makes these read as keys rather than as a grid of buttons is the heavier
 * bottom border: it is the lit edge of something with a side to it, and pressing
 * one drops it onto that edge.
 */
const KEY_BASE =
  "flex h-9 items-center justify-center rounded-lg border border-b-2 leading-none transition duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 active:translate-y-[1px] active:border-b";
const KEY_RESTING =
  "border-[var(--color-border)] border-b-[var(--color-border-strong)] bg-[var(--color-surface-panel)] text-text-primary hover:bg-[var(--color-glass-medium)]";
/** The two keys that do more than type, picked out so they are found first. */
const KEY_ACTION =
  "border-accent/30 border-b-accent/50 bg-accent/10 text-text-primary hover:bg-accent/15";

/** Small captions over the rows of a tab whose rows mean different things. */
const ROW_CAPTIONS: Record<string, Record<number, string>> = {
  powers: { 0: "Powers", 2: "Subscripts" },
};

function KeyboardGlyph() {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className="h-[0.95rem] w-[0.95rem]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    >
      <rect x="1.75" y="4.75" width="16.5" height="10.5" rx="2.25" />
      <path d="M5 8h.01M8 8h.01M11 8h.01M14 8h.01M5 11h.01M14 11h.01" />
      <path d="M7.75 12.25h4.5" />
    </svg>
  );
}

/** Keys that end a slot without typing anything into it. */
const SLOT_ENDING_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Escape", "Tab", "Enter"]);

/**
 * The open power, subscript or fraction slot of one field, and the listeners
 * that make typing go into it. See `lib/ui/script-typing.ts` for the rules.
 *
 * `^` opens a power from the ordinary keyboard too, since that is how most
 * students already write one.
 */
function useScriptSlot(targetRef: SymbolKeyboardProps["targetRef"]) {
  const [slot, setSlotState] = useState<ScriptSlot | null>(null);
  const slotRef = useRef<ScriptSlot | null>(null);
  const setSlot = useCallback((next: ScriptSlot | null) => {
    slotRef.current = next;
    setSlotState(next);
  }, []);

  useEffect(() => {
    const field = targetRef.current;
    if (!field) return;
    // A union of input and textarea defeats addEventListener's typed overloads.
    const element: HTMLElement = field;
    const onBeforeInput = (event: InputEvent) => {
      if (event.isComposing) return;
      const current = slotRef.current;
      if (event.inputType === "insertText" && event.data) {
        if (!current) {
          if (event.data === "^") {
            event.preventDefault();
            setSlot(openScriptSlot("super"));
          }
          return;
        }
        if (event.data.length !== 1) {
          setSlot(null);
          return;
        }
        const result = typeIntoScriptSlot(current, event.data);
        if (result.insert !== null) {
          event.preventDefault();
          insertTextIntoField(field, result.insert);
        }
        setSlot(result.slot);
        return;
      }
      if (event.inputType === "deleteContentBackward") {
        const start = field.selectionStart ?? 0;
        const collapsed = start === (field.selectionEnd ?? start);
        setSlot(collapsed ? slotAfterBackspace(field.value, start) : null);
        return;
      }
      if (current) setSlot(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!slotRef.current || !SLOT_ENDING_KEYS.has(event.key)) return;
      // → finishes the slot where the caret is, rather than also moving past the next character.
      if (event.key === "ArrowRight") event.preventDefault();
      setSlot(null);
    };
    const close = () => {
      if (slotRef.current) setSlot(null);
    };
    element.addEventListener("beforeinput", onBeforeInput);
    element.addEventListener("keydown", onKeyDown);
    element.addEventListener("pointerdown", close);
    element.addEventListener("blur", close);
    return () => {
      element.removeEventListener("beforeinput", onBeforeInput);
      element.removeEventListener("keydown", onKeyDown);
      element.removeEventListener("pointerdown", close);
      element.removeEventListener("blur", close);
    };
  }, [setSlot, targetRef]);

  return { slot, slotRef, setSlot };
}

function rowsOf<T>(items: readonly T[], size: number) {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) rows.push(items.slice(index, index + size));
  return rows;
}

/**
 * A small scientific keypad for the characters a keyboard will not give you.
 *
 * Laid out like a calculator: four short tabs, six keys a row, each row one
 * kind of thing. It opens on Maths, which holds the essentials; Powers, Greek
 * and Science hold what a particular subject needs. Every key types straight
 * into the field. The fraction key lifts what was just typed into the top of
 * a fraction, and standard form types ×10 and turns to the Powers tab for its
 * exponent.
 *
 * It lives in the corner of the field rather than above it, because it belongs
 * to the thing being typed into and not to the page.
 *
 * The detail that makes it usable is `preventDefault` on mousedown. Without it
 * the browser moves focus to the key the instant it is pressed, the field loses
 * its selection, and every character lands at the end of the answer instead of
 * where the caret was. With it the field never loses focus at all.
 */
export default function SymbolKeyboard({
  targetRef,
  className = "",
}: SymbolKeyboardProps) {
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState(SYMBOL_GROUPS[0].id);
  const [openUpward, setOpenUpward] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const active =
    SYMBOL_GROUPS.find((entry) => entry.id === group) ?? SYMBOL_GROUPS[0];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (rootRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      targetRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, targetRef]);

  const toggle = useCallback(() => {
    setOpen((wasOpen) => {
      if (wasOpen) return false;
      // A field near the bottom of a phone would otherwise put the keyboard
      // under the fold.
      const bounds = rootRef.current?.getBoundingClientRect();
      if (bounds) {
        const below = window.innerHeight - bounds.bottom;
        setOpenUpward(below < 280 && bounds.top > below);
      }
      return true;
    });
  }, []);

  const { slot, slotRef, setSlot } = useScriptSlot(targetRef);

  const press = useCallback(
    (key: SymbolKey) => {
      const field = targetRef.current;
      if (!field) return;
      field.focus();
      switch (key.action) {
        case "power":
          setSlot(openScriptSlot("super"));
          break;
        case "subscript":
          setSlot(openScriptSlot("sub"));
          break;
        case "standard-form":
          insertKeyIntoField(field, key);
          setSlot(openScriptSlot("super"));
          break;
        case "fraction": {
          const caret = field.selectionStart ?? field.value.length;
          if (slotRef.current?.numerator) {
            // Pressed again with the top typed: on to the bottom.
            insertTextIntoField(field, FRACTION_SLASH);
            setSlot(openScriptSlot("sub"));
          } else if (planFraction(field.value, caret).from === caret) {
            // Nothing typed to lift: type the top first, then / for the bottom.
            setSlot(openScriptSlot("super", { numerator: true }));
          } else {
            applyFraction(field);
            setSlot(openScriptSlot("sub"));
          }
          break;
        }
        case "root": {
          // The brackets are the root's box: the caret goes inside them.
          insertKeyIntoField(field, key);
          const caret = field.selectionStart ?? field.value.length;
          field.setSelectionRange(caret - 1, caret - 1);
          setSlot(null);
          break;
        }
        default:
          insertKeyIntoField(field, key);
          setSlot(null);
      }
    },
    [setSlot, slotRef, targetRef]
  );

  /*
   * `relative` only when the caller has not placed this itself: every caller
   * that positions it passes `absolute`, and Tailwind emits `.relative` after
   * `.absolute`, so a hardcoded `relative` would always win.
   */
  const positioned = /(^|\s)(absolute|fixed|sticky)(\s|$)/.test(className);
  const captions = ROW_CAPTIONS[active.id] ?? {};

  return (
    <div
      ref={rootRef}
      className={positioned ? className : `relative ${className}`}
    >
      {/*
        The open slot, said where the student is looking. This is what keeps
        it from being a hidden mode: while typing goes up into a power, the
        field says so, and how to come back down.
      */}
      {slot ? (
        <span
          role="status"
          className="pointer-events-none absolute right-full top-1/2 mr-1.5 -translate-y-1/2 whitespace-nowrap rounded-full border border-accent/40 bg-accent/15 px-2 py-0.5 text-2xs font-semibold text-text-primary shadow-e1"
        >
          {describeScriptSlot(slot)}
        </span>
      ) : null}
      <button
        type="button"
        aria-label="Maths symbols"
        title="Maths symbols"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        // The field must not lose its caret when the keyboard is opened.
        onMouseDown={(event) => event.preventDefault()}
        onClick={toggle}
        className={`flex h-7 w-7 items-center justify-center rounded-full border transition duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 ${
          open
            ? "border-accent/55 bg-accent/15 text-text-primary"
            : "border-[var(--color-border)] bg-[var(--color-glass-subtle)] text-text-muted hover:border-[var(--color-border-strong)] hover:bg-[var(--color-glass-medium)] hover:text-text-primary"
        }`}
      >
        <KeyboardGlyph />
      </button>

      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="Maths symbols"
          className={`absolute right-0 z-40 w-[16.5rem] rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-panel-strong)] p-2 shadow-e3 ${
            openUpward ? "bottom-9" : "top-9"
          }`}
        >
          <div
            role="tablist"
            aria-label="Symbol groups"
            className="mb-2 grid grid-cols-4 gap-0.5 rounded-full bg-[var(--color-glass-subtle)] p-0.5"
          >
            {SYMBOL_GROUPS.map((entry) => {
              const selected = entry.id === active.id;
              return (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setGroup(entry.id)}
                  className={`rounded-full py-1 text-2xs font-semibold transition duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 ${
                    selected
                      ? "bg-[var(--color-surface-panel)] text-text-primary shadow-e1"
                      : "text-text-muted hover:text-text-secondary"
                  }`}
                >
                  {entry.label}
                </button>
              );
            })}
          </div>

          <div role="tabpanel" aria-label={active.label} className="space-y-1">
            {rowsOf(active.keys, SYMBOL_KEYBOARD_COLUMNS).map((row, rowIndex) => (
              <div key={`${active.id}-${rowIndex}`}>
                {captions[rowIndex] ? (
                  <p className={`px-0.5 pb-1 text-2xs font-semibold uppercase tracking-[0.08em] text-text-muted ${rowIndex > 0 ? "pt-1" : ""}`}>
                    {captions[rowIndex]}
                  </p>
                ) : null}
                <div className="grid grid-cols-6 gap-1">
                  {row.map((key) => {
                    const slotKey = key.action === "power" || key.action === "subscript";
                    const live =
                      slotKey &&
                      slot !== null &&
                      !slot.numerator &&
                      (key.action === "power") === (slot.kind === "super");
                    return (
                      <button
                        key={key.id}
                        type="button"
                        title={key.name}
                        aria-label={key.name}
                        aria-pressed={slotKey ? live : undefined}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => (live ? setSlot(null) : press(key))}
                        className={`${KEY_BASE} ${
                          live
                            ? "border-accent border-b-accent bg-accent/25 text-text-primary"
                            : key.action && key.action !== "root"
                              ? KEY_ACTION
                              : KEY_RESTING
                        } ${key.label.length > 2 ? "text-xs font-medium" : "text-base"}`}
                      >
                        <span aria-hidden="true">{key.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
