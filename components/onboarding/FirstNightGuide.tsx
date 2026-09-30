"use client";

import { useEffect, useId, useLayoutEffect, useRef } from "react";
import { Sparkle } from "@/components/onboarding/FirstNightSky";
import {
  easeOutCubic,
  guideThread,
  mixBox,
  placeGuideNote,
  type GuideBox,
} from "@/lib/onboarding/guide-placement";

type FirstNightGuideProps = {
  target: string | null;
  near?: string;
  eyebrow?: string;
  text: string;
  doneLabel: string;
  onDone: () => void;
  onSkip?: () => void;
};

/** How long the light takes to travel from one control to the next. */
const GLIDE_MS = 520;
/** How long a target may vanish -- a re-render, a drawer mid-animation -- before the light lets go of it. */
const LOST_GRACE_MS = 700;
/** How often the selector is looked up again, for the copy that is on screen changing (sidebar to tab bar). */
const REQUERY_MS = 400;
const SPOT_PAD = 8;
const PHONE_WIDTH = 768;
/** A phone keeps its tab bar and home indicator at the bottom; a note never sits under them. */
const PHONE_RESERVED_BOTTOM = 96;

/** Faint stars in the veil, fixed so they do not jump between notes. */
const VEIL_STARS = (() => {
  let seed = 7;
  const next = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  return Array.from({ length: 34 }, () => ({
    x: next() * 100,
    y: next() * 100,
    r: 0.5 + next() * 1.1,
    delay: next() * 6,
    duration: 3 + next() * 4,
  }));
})();

/** The one copy of a selector that is actually on screen: the sidebar on a computer, the bar on a phone. */
function findVisible(selector: string) {
  return (
    Array.from(document.querySelectorAll<HTMLElement>(selector)).find(
      (element) => element.getClientRects().length > 0
    ) ?? null
  );
}

function boxOf(element: HTMLElement | null): GuideBox | null {
  if (!element || !element.isConnected) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function inView(box: GuideBox) {
  return box.top >= 0 && box.left >= 0 && box.top + box.height <= window.innerHeight && box.left + box.width <= window.innerWidth;
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/**
 * A note beside one real control, with the night drawn in around it.
 *
 * It follows its control every frame rather than every 400ms, so it stays on
 * the control through a scroll, a drawer opening or a page settling, instead
 * of swimming after it. Positions are written straight to the elements -- one
 * frame of layout reads, then writes -- so following costs no React render.
 * When it moves to a new control the light travels there; everything else is
 * immediate, because a highlight that lags its target reads as broken.
 *
 * It never blocks: the veil lets every press through, so the student can use
 * the control it points at, or anything else.
 */
export default function FirstNightGuide({ target, near, eyebrow, text, doneLabel, onDone, onSkip }: FirstNightGuideProps) {
  const maskId = `fn-veil-${useId().replace(/[:]/g, "")}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const holeRef = useRef<SVGRectElement>(null);
  const threadRef = useRef<SVGPathElement>(null);
  const threadEndRef = useRef<SVGCircleElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLDivElement>(null);
  /** Where the light was last drawn, so a new target is travelled to rather than jumped to. */
  const shownRef = useRef<GuideBox | null>(null);

  useLayoutEffect(() => {
    const reduced = prefersReducedMotion();
    let frame = 0;
    let element: HTMLElement | null = null;
    let nearElement: HTMLElement | null = null;
    let lastQuery = -Infinity;
    let lastLive: GuideBox | null = null;
    let lostAt = 0;
    let revealed = false;
    const glideFrom = shownRef.current;
    const glideStart = performance.now();

    const tick = (now: number) => {
      // Reads first.
      if (target && (now - lastQuery > REQUERY_MS || !element?.isConnected)) {
        element = findVisible(target);
        nearElement = near ? findVisible(near) : null;
        lastQuery = now;
      }
      const live = target ? boxOf(element) : null;
      const beside = near ? boxOf(nearElement) : null;
      if (live) {
        lastLive = live;
        lostAt = 0;
        if (!revealed && element && !inView(live)) {
          element.scrollIntoView({ block: "center", inline: "center", behavior: reduced ? "auto" : "smooth" });
        }
        revealed = true;
      } else if (lastLive && lostAt === 0) {
        lostAt = now;
      }
      const anchor = live ?? (lastLive && now - lostAt < LOST_GRACE_MS ? lastLive : null);
      const phone = window.innerWidth < PHONE_WIDTH;
      const note = noteRef.current;
      const noteSize = note ? { width: note.offsetWidth, height: note.offsetHeight } : { width: 320, height: 160 };

      // Then writes.
      const root = rootRef.current;
      if (!root) {
        frame = requestAnimationFrame(tick);
        return;
      }
      if (target && !anchor) {
        root.dataset.state = "seeking";
        shownRef.current = null;
        frame = requestAnimationFrame(tick);
        return;
      }

      let shown: GuideBox | null = null;
      if (anchor) {
        const t = reduced || !glideFrom ? 1 : easeOutCubic((now - glideStart) / GLIDE_MS);
        shown = glideFrom && t < 1 ? mixBox(glideFrom, anchor, t) : anchor;
        shownRef.current = shown;
        const spot = {
          left: shown.left - SPOT_PAD,
          top: shown.top - SPOT_PAD,
          width: shown.width + SPOT_PAD * 2,
          height: shown.height + SPOT_PAD * 2,
        };
        const ring = ringRef.current;
        if (ring) {
          ring.style.transform = `translate3d(${spot.left}px, ${spot.top}px, 0)`;
          ring.style.width = `${spot.width}px`;
          ring.style.height = `${spot.height}px`;
        }
        const hole = holeRef.current;
        if (hole) {
          hole.setAttribute("x", String(spot.left));
          hole.setAttribute("y", String(spot.top));
          hole.setAttribute("width", String(spot.width));
          hole.setAttribute("height", String(spot.height));
        }
      }

      const placement = placeGuideNote({
        target: shown,
        beside: shown && beside && !phone ? beside : null,
        note: noteSize,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          reservedBottom: phone ? PHONE_RESERVED_BOTTOM : 0,
        },
      });
      if (note) {
        note.style.transform = `translate3d(${placement.x}px, ${placement.y}px, 0)`;
        note.dataset.side = placement.side;
      }

      const thread = threadRef.current;
      const threadEnd = threadEndRef.current;
      if (thread && threadEnd) {
        const line = shown
          ? guideThread({ left: placement.x, top: placement.y, ...noteSize }, shown, SPOT_PAD + 2)
          : null;
        if (line) {
          // A slight bow, like a line drawn between stars rather than a ruler.
          const midX = (line.from.x + line.to.x) / 2;
          const midY = (line.from.y + line.to.y) / 2;
          const bow = Math.min(28, line.length * 0.12);
          const nx = -(line.to.y - line.from.y) / line.length;
          const ny = (line.to.x - line.from.x) / line.length;
          thread.setAttribute(
            "d",
            `M ${line.from.x} ${line.from.y} Q ${midX + nx * bow} ${midY + ny * bow} ${line.to.x} ${line.to.y}`
          );
          threadEnd.setAttribute("cx", String(line.to.x));
          threadEnd.setAttribute("cy", String(line.to.y));
          thread.style.opacity = "1";
          threadEnd.style.opacity = "1";
        } else {
          thread.style.opacity = "0";
          threadEnd.style.opacity = "0";
        }
      }

      // Shown only once everything is in place, so nothing is ever seen at the corner of the screen.
      root.dataset.state = "shown";
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, near]);

  // A note with nothing to point at forgets where the light was, so the next one rises from nowhere.
  useEffect(() => {
    if (!target) shownRef.current = null;
  }, [target]);

  return (
    <div ref={rootRef} className="fn-guide" data-state="seeking">
      {target ? (
        <>
          <svg className="fn-veil" aria-hidden="true">
            <defs>
              <mask id={maskId}>
                <rect x="0" y="0" width="100%" height="100%" fill="white" />
                <rect ref={holeRef} rx="18" ry="18" fill="black" />
              </mask>
              <radialGradient id={`${maskId}-glow`} cx="50%" cy="42%" r="75%">
                <stop offset="0%" stopColor="rgb(18, 10, 48)" stopOpacity="0.5" />
                <stop offset="100%" stopColor="rgb(4, 2, 14)" stopOpacity="0.76" />
              </radialGradient>
              <linearGradient id={`${maskId}-thread`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="rgb(236, 230, 255)" stopOpacity="0.15" />
                <stop offset="100%" stopColor="rgb(214, 200, 255)" stopOpacity="0.95" />
              </linearGradient>
            </defs>
            <g mask={`url(#${maskId})`}>
              <rect className="fn-veil-fill" x="0" y="0" width="100%" height="100%" fill={`url(#${maskId}-glow)`} />
              {VEIL_STARS.map((star, index) => (
                <circle
                  key={index}
                  className="fn-veil-star"
                  cx={`${star.x}%`}
                  cy={`${star.y}%`}
                  r={star.r}
                  style={{ animationDelay: `${star.delay}s`, animationDuration: `${star.duration}s` }}
                />
              ))}
            </g>
            <path ref={threadRef} className="fn-thread" stroke={`url(#${maskId}-thread)`} />
            <circle ref={threadEndRef} className="fn-thread-end" r="2.6" />
          </svg>
          <div ref={ringRef} className="fn-light" aria-hidden="true" />
        </>
      ) : null}

      <div ref={noteRef} className="fn-note" data-floating={target ? undefined : "true"}>
        <div key={text} className="fn-note-body">
          <div className="fn-note-head">
            <span className="fn-note-sigil" aria-hidden="true">
              <Sparkle size={12} />
            </span>
            <span className="fn-eyebrow">{eyebrow ?? "Jami"}</span>
          </div>
          <p className="fn-note-text" role="status" aria-live="polite">
            {text}
          </p>
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
      </div>
    </div>
  );
}
