"use client";

import { useEffect, useState } from "react";
import { formatElapsed } from "@/lib/app/elapsed-time";

type ElapsedTimeProps = {
  /**
   * When the wait began, in milliseconds -- a job's own `createdAt`, so leaving
   * the page and coming back shows the real time taken. Left out, the clock
   * starts when it appears, which suits a block that only exists while the
   * wait does.
   */
  startedAt?: number | null;
  className?: string;
  /** What the clock is timing, for screen readers. */
  label?: string;
};

/**
 * A running clock for anything a student waits on, shown beside its progress bar.
 *
 * A percentage says nothing about time: a paper job sat at 58% for eleven
 * minutes looking exactly as it had after one. The clock cannot overstate
 * progress, and it tells a student whether a short wait has become a long one.
 *
 * It renders nothing until its first tick, so the server and the first client
 * render always agree.
 */
export default function ElapsedTime({ startedAt, className = "", label = "Time elapsed" }: ElapsedTimeProps) {
  const [mountedAt] = useState(() => Date.now());
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  if (now === null) return null;
  const text = formatElapsed(now - (startedAt ?? mountedAt));
  return (
    <span className={`tabular-nums ${className}`} title={label} aria-label={`${label}: ${text}`}>
      {text}
    </span>
  );
}
