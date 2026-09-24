"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Sparkle } from "@/components/onboarding/FirstNightSky";

export type FirstNightBloomContent = {
  /** Changes for every star, so a second star lit while the first is showing replays the bloom. */
  key: string;
  eyebrow: string;
  title: string;
  text: string;
  next?: { label: string; run: () => void };
};

/** Long enough to read two sentences; held open while the student is reading it. */
const BLOOM_MS = 9_000;

/*
 * The orbit around the lit star: one tilted ellipse, split at its widest point
 * so the far half passes behind the star and the near half crosses in front.
 *
 * This replaced a conic gradient of eight wedges, which at 52px read as blocky
 * rectangular rays rather than light. A single hairline loop is the quieter
 * mark, and splitting it is what makes it read as circling the star rather than
 * sitting on top of it.
 */
const ORBIT_TILT = "rotate(-22 26 26)";
const ORBIT_BACK = "M2 26A24 8.5 0 0 1 50 26";
const ORBIT_FRONT = "M50 26A24 8.5 0 0 1 2 26";
const ORBIT_LOOP = `${ORBIT_FRONT}A24 8.5 0 0 1 50 26`;

function BloomOrbit({ half, gradientId }: { half: "back" | "front"; gradientId: string }) {
  return (
    <svg className={`fn-bloom-orbit fn-bloom-orbit-${half}`} viewBox="0 0 52 52" aria-hidden="true">
      {half === "front" ? (
        <defs>
          <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1="2" y1="0" x2="50" y2="0">
            <stop offset="0" stopColor="#d6c8ff" stopOpacity="0.28" />
            <stop offset="0.5" stopColor="#fff" stopOpacity="0.95" />
            <stop offset="1" stopColor="#d6c8ff" stopOpacity="0.28" />
          </linearGradient>
        </defs>
      ) : null}
      <g transform={ORBIT_TILT}>
        <path
          d={half === "front" ? ORBIT_FRONT : ORBIT_BACK}
          pathLength={1}
          stroke={`url(#${gradientId})`}
        />
        {half === "front" ? (
          <circle className="fn-bloom-spark" r="1.3">
            <animateMotion dur="7s" begin="1.4s" repeatCount="indefinite" path={ORBIT_LOOP} />
            {/* Dimmed while it is on the far side, behind the star. */}
            <animate
              attributeName="opacity"
              dur="7s"
              begin="1.4s"
              repeatCount="indefinite"
              keyTimes="0;0.42;0.54;0.9;1"
              values="1;1;0.15;0.15;1"
            />
          </circle>
        ) : null}
      </g>
    </svg>
  );
}

/**
 * The moment a star lights.
 *
 * It used to be a toast that said "Star lit" and vanished, which is a receipt,
 * not a reward. This says what the thing just done is for -- the part a student
 * would not otherwise notice -- and offers the next star in one tap, so the
 * walkthrough moves by momentum rather than by the student hunting for it.
 */
export default function FirstNightBloom({
  content,
  onClose,
}: {
  content: FirstNightBloomContent | null;
  onClose: () => void;
}) {
  const [held, setHeld] = useState(false);
  const orbitGradientId = `fn-bloom-orbit-${useId().replace(/:/g, "")}`;
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!content || held) return;
    const timer = window.setTimeout(() => closeRef.current(), BLOOM_MS);
    return () => window.clearTimeout(timer);
  }, [content, held]);

  if (!content) return null;

  return (
    <div
      key={content.key}
      className="fn-bloom"
      role="status"
      aria-live="polite"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <span className="fn-bloom-mark" aria-hidden="true">
        <BloomOrbit half="back" gradientId={orbitGradientId} />
        <span className="fn-bloom-core">
          <Sparkle size={22} />
        </span>
        <BloomOrbit half="front" gradientId={orbitGradientId} />
      </span>
      <div className="fn-bloom-body">
        <div className="fn-eyebrow">{content.eyebrow}</div>
        <div className="fn-bloom-title">{content.title}</div>
        <p className="fn-bloom-text">{content.text}</p>
        <div className="fn-bloom-actions">
          {content.next ? (
            <button
              type="button"
              className="fn-cta fn-small-cta"
              onClick={() => {
                content.next?.run();
                closeRef.current();
              }}
            >
              {content.next.label}
            </button>
          ) : null}
          <button type="button" className="fn-quiet" onClick={() => closeRef.current()}>
            {content.next ? "Later" : "Close"}
          </button>
        </div>
      </div>
    </div>
  );
}
