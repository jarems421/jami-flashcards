"use client";

import { useLayoutEffect, useState, type CSSProperties } from "react";
import { Sparkle } from "@/components/onboarding/FirstNightSky";

type Box = { left: number; top: number; right: number; bottom: number; width: number; height: number };

type FirstNightGuideProps = {
  target: string | null;
  near?: string;
  text: string;
  doneLabel: string;
  onDone: () => void;
  onSkip?: () => void;
};

/** The one copy of a selector that is actually on screen: the sidebar on a computer, the bar on a phone. */
function findVisible(selector: string) {
  return Array.from(document.querySelectorAll<HTMLElement>(selector)).find((element) => element.getClientRects().length > 0) ?? null;
}

function boxOf(element: HTMLElement | null): Box | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
}

function sameBox(a: Box | null, b: Box | null) {
  if (!a || !b) return a === b;
  return Math.abs(a.left - b.left) < 1 && Math.abs(a.top - b.top) < 1 && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;
}

/**
 * A note beside one real control, with the rest of the screen dimmed around it.
 *
 * It never blocks: the dim lets every press through, so the student can use the
 * control it points at, or anything else. Pages render their controls when
 * their data arrives, so the target is looked for continuously rather than
 * measured once.
 */
export default function FirstNightGuide({ target, near, text, doneLabel, onDone, onSkip }: FirstNightGuideProps) {
  const [box, setBox] = useState<Box | null>(null);
  const [nearBox, setNearBox] = useState<Box | null>(null);
  const [viewport, setViewport] = useState({ width: 1200, height: 800 });

  useLayoutEffect(() => {
    let revealed = false;
    const measure = () => {
      setViewport((current) =>
        current.width === window.innerWidth && current.height === window.innerHeight
          ? current
          : { width: window.innerWidth, height: window.innerHeight }
      );
      if (!target) return;
      const element = findVisible(target);
      if (element && !revealed) {
        element.scrollIntoView({ block: "nearest", inline: "center" });
        revealed = true;
      }
      const next = boxOf(element);
      setBox((current) => (sameBox(current, next) ? current : next));
      const nextNear = near ? boxOf(findVisible(near)) : null;
      setNearBox((current) => (sameBox(current, nextNear) ? current : nextNear));
    };
    measure();
    const interval = window.setInterval(measure, 400);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [target, near]);

  if (target && !box) return null;

  const noteWidth = 340;
  const sideWidth = 300;
  let noteStyle: CSSProperties = { right: 24, bottom: 24, width: noteWidth };
  if (box) {
    const below = viewport.height - box.bottom > 240;
    noteStyle = {
      left: Math.min(Math.max(16, box.left + box.width / 2 - noteWidth / 2), viewport.width - noteWidth - 16),
      top: below ? box.bottom + 22 : Math.max(16, box.top - 22 - 200),
    };
    if (nearBox && viewport.width - nearBox.right >= sideWidth + 40) {
      noteStyle = { left: nearBox.right + 22, top: Math.min(Math.max(16, box.top), viewport.height - 220), width: sideWidth };
    } else if (nearBox && nearBox.left >= sideWidth + 40) {
      noteStyle = { left: nearBox.left - sideWidth - 22, top: Math.min(Math.max(16, box.top), viewport.height - 220), width: sideWidth };
    }
  }

  const pad = 8;
  return (
    <>
      {box ? (
        <div
          className="fn-spot"
          aria-hidden="true"
          style={{ left: box.left - pad, top: box.top - pad, width: box.width + pad * 2, height: box.height + pad * 2 }}
        />
      ) : null}
      <div key={text} className="fn-note" role="status" style={noteStyle}>
        <div className="fn-note-head">
          <span className="fn-note-star">
            <Sparkle size={13} />
          </span>
          <span className="fn-eyebrow">Jami</span>
        </div>
        <p className="fn-note-text">{text}</p>
        <div className="fn-note-actions">
          <button type="button" className="fn-cta fn-small-cta" onClick={onDone}>
            {doneLabel}
          </button>
          {onSkip ? (
            <button type="button" className="fn-quiet fn-skip" onClick={onSkip}>
              Skip tour
            </button>
          ) : null}
        </div>
      </div>
    </>
  );
}
