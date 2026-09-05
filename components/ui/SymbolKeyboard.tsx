"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  applyFraction,
  INDEX_KEYS,
  insertKeyIntoField,
  readSymbolRecents,
  rememberSymbol,
  SYMBOL_GROUPS,
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
 * one drops it onto that edge. Built from border weight rather than a custom
 * shadow so it stays on the product's elevation scale -- the softest shadow the
 * scale offers is a 20px blur, far too diffuse to read as an edge at this size.
 */
const KEY_BASE =
  "flex items-center justify-center rounded-md border border-b-2 transition duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 active:translate-y-[1px] active:border-b";
const KEY_RESTING =
  "border-[var(--color-border)] border-b-[var(--color-border-strong)] bg-[var(--color-glass-medium)] text-text-secondary hover:border-[var(--color-border-strong)] hover:bg-[var(--color-glass-strong)] hover:text-text-primary";

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

/**
 * A small keyboard for the characters a keyboard will not give you.
 *
 * It lives in the corner of the field rather than above it, because it belongs
 * to the thing being typed into and not to the page: on a phone or an iPad the
 * alternative is a row of glyphs taking up space in every form whether or not
 * anyone needs one.
 *
 * The detail that makes it usable is `preventDefault` on mousedown. Without it
 * the browser moves focus to the key the instant it is pressed, the field loses
 * its selection, and every character lands at the end of the answer instead of
 * where the caret was. With it the field never loses focus at all, so a student
 * can place a caret mid-word, press three keys in a row, and carry on typing
 * without touching the mouse again.
 */
export default function SymbolKeyboard({
  targetRef,
  className = "",
}: SymbolKeyboardProps) {
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState(SYMBOL_GROUPS[0].id);
  const [openUpward, setOpenUpward] = useState(false);
  const [recents, setRecents] = useState<SymbolKey[]>([]);
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
      // Read on open rather than on mount: another field may have been used
      // since, and this is the moment the list is about to be looked at.
      setRecents(readSymbolRecents());
      // A field near the bottom of a phone would otherwise put the keyboard
      // under the fold.
      const bounds = rootRef.current?.getBoundingClientRect();
      if (bounds) {
        const below = window.innerHeight - bounds.bottom;
        setOpenUpward(below < 320 && bounds.top > below);
      }
      return true;
    });
  }, []);

  const press = useCallback(
    (key: SymbolKey) => {
      const field = targetRef.current;
      if (!field) return;
      if (key.action === "fraction") applyFraction(field);
      else insertKeyIntoField(field, key);
      field.focus();
      setRecents((current) => rememberSymbol(key, current));
    },
    [targetRef]
  );

  const renderKey = (key: SymbolKey, scope: string, wide = false) => (
    <button
      key={`${scope}-${key.id}`}
      type="button"
      title={key.name}
      aria-label={key.name}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => press(key)}
      className={`${KEY_BASE} ${KEY_RESTING} h-9 ${
        wide ? "col-span-2 px-1 text-2xs font-medium" : "text-base"
      }`}
    >
      <span aria-hidden="true">{key.label}</span>
    </button>
  );

  /*
   * `relative` only when the caller has not placed this itself.
   *
   * It used to be hardcoded and the caller's classes appended after it -- but
   * every caller that positions this passes `absolute`, and Tailwind emits
   * `.relative` after `.absolute`, so `relative` won regardless of the order the
   * classes are written in. The button was therefore laid out in normal flow,
   * after the field, instead of sitting inside it: half in and half out of the
   * corner on every surface that has one, not just gap fill.
   *
   * An absolutely positioned element is itself a containing block, so the
   * popover below still anchors to this root either way.
   */
  const positioned = /(^|\s)(absolute|fixed|sticky)(\s|$)/.test(className);

  return (
    <div
      ref={rootRef}
      className={positioned ? className : `relative ${className}`}
    >
      <button
        type="button"
        aria-label="Symbols and formulas"
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
          className={`absolute right-0 z-40 w-[19rem] rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-panel-strong)] p-2.5 shadow-e3 backdrop-blur-md sm:w-[21rem] ${
            openUpward ? "bottom-9" : "top-9"
          }`}
        >
          <div role="tablist" aria-label="Symbol groups" className="mb-2 flex gap-1">
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
                  className={`flex-1 rounded-full border px-1.5 py-1 text-2xs font-medium transition duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 ${
                    selected
                      ? "border-accent/50 bg-accent/10 text-text-primary"
                      : "border-transparent text-text-muted hover:bg-[var(--color-glass-subtle)] hover:text-text-secondary"
                  }`}
                >
                  {entry.label}
                </button>
              );
            })}
          </div>

          {/* The key well: keys sit in something rather than on the panel. */}
          <div className="space-y-1.5 rounded-xl border border-[var(--color-border)] bg-black/25 p-1.5">
            {recents.length > 0 ? (
              <div className="grid grid-cols-8 gap-1">
                {recents.map((key) => renderKey(key, "recent"))}
              </div>
            ) : null}

            <div
              role="tabpanel"
              aria-label={active.label}
              className="grid grid-cols-8 gap-1"
            >
              {active.keys.map((key) =>
                renderKey(key, active.id, key.label.length > 2)
              )}
            </div>

            {/*
              Always present, whatever tab is showing. Both type something the
              moment they are pressed; nothing here arms a mode.
            */}
            <div className="grid grid-cols-8 gap-1 border-t border-[var(--color-border)] pt-1.5">
              {INDEX_KEYS.map((key) => renderKey(key, "index", true))}
            </div>
          </div>

          <p
            aria-live="polite"
            className="mt-2 px-0.5 text-2xs leading-4 text-text-muted"
          >
            Every key types straight into your answer. Powers and subscripts are
            in the Powers tab; a⁄b lifts what you just typed into the top of a
            fraction.
          </p>
        </div>
      ) : null}
    </div>
  );
}
