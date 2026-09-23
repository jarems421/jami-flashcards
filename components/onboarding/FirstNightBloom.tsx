"use client";

import { useEffect, useRef, useState } from "react";
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
        <span className="fn-bloom-rays" />
        <span className="fn-bloom-core">
          <Sparkle size={22} />
        </span>
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
