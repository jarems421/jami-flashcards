"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

/*
 * The questions, answers and marks below are written for this page. They are
 * not taken from any exam board's paper or mark scheme, so nothing here needs
 * a permission record -- and nothing licensed should ever be pasted in to make
 * the demo look more real.
 */
type Example = {
  subject: string;
  question: string;
  marks: number;
  answer: string;
  points: readonly { text: string; earned: boolean }[];
  flashcard: { front: string; back: string };
  next: { topic: string; reason: string; tone: "warning" | "info" };
};

const EXAMPLES: readonly Example[] = [
  {
    subject: "Biology",
    question: "Explain why an enzyme works more slowly above its optimum temperature.",
    marks: 4,
    answer:
      "The enzyme denatures, so its active site changes shape and the substrate no longer fits.",
    points: [
      { text: "Enzyme denatures", earned: true },
      { text: "Active site changes shape", earned: true },
      { text: "Substrate no longer fits", earned: true },
      { text: "Fewer enzyme–substrate complexes", earned: false },
    ],
    flashcard: {
      front: "What forms less often once an enzyme denatures?",
      back: "Enzyme–substrate complexes",
    },
    next: { topic: "Enzymes", reason: "Slipping · 3 cards due", tone: "warning" },
  },
  {
    subject: "Chemistry",
    question: "Explain why raising the temperature increases the rate of a reaction.",
    marks: 3,
    answer: "The particles gain energy and move faster, so they collide more often.",
    points: [
      { text: "Particles gain kinetic energy", earned: true },
      { text: "Collisions are more frequent", earned: true },
      { text: "More collisions exceed the activation energy", earned: false },
    ],
    flashcard: {
      front: "Why are more collisions successful at a higher temperature?",
      back: "More particles have at least the activation energy",
    },
    next: { topic: "Rates of reaction", reason: "Not tested yet · worth a first look", tone: "info" },
  },
  {
    subject: "History",
    question: "Describe two ways the Treaty of Versailles affected Germany.",
    marks: 4,
    answer:
      "Germany lost land, including Alsace-Lorraine, and it had to pay reparations to the Allies.",
    points: [
      { text: "Loss of territory identified", earned: true },
      { text: "Supported with an example", earned: true },
      { text: "Reparations identified", earned: true },
      { text: "Reparations developed with detail", earned: false },
    ],
    flashcard: {
      front: "What were German reparations set at in 1921?",
      back: "£6.6 billion",
    },
    next: { topic: "Treaty of Versailles", reason: "Slipping · 4 cards due", tone: "warning" },
  },
];

/** How often the demo's clock advances. Coarse on purpose: nothing here needs 60fps. */
const TICK_MS = 50;
const TYPE_MS_PER_CHAR = 28;
const MARK_MS_PER_POINT = 520;

/**
 * Where each moment of an example falls on its clock. Derived rather than
 * stored, so jumping to a step is only setting the clock.
 */
function timelineFor(example: Example) {
  const typed = example.answer.length * TYPE_MS_PER_CHAR;
  const markStart = typed + 450;
  const keepStart = markStart + example.points.length * MARK_MS_PER_POINT + 700;
  const flipAt = keepStart + 1_700;
  const nextStart = keepStart + 3_600;
  const end = nextStart + 3_800;
  return { typed, markStart, keepStart, flipAt, nextStart, end };
}

const STEPS = [
  {
    label: "Get marked",
    detail: "Past-paper questions, typed or handwritten, marked point by point against the scheme.",
  },
  {
    label: "Keep it",
    detail: "The mark you missed becomes a flashcard you approve, reviewed before you forget.",
  },
  {
    label: "See what’s next",
    detail: "Jami spots what is slipping and what you have not tested yet, and says why.",
  },
] as const;

/** Circumference of the score ring's r=15.5 circle. */
const RING = 2 * Math.PI * 15.5;

function Tick() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3 w-3"
    >
      <path d="m3.5 8.5 3 3 6-6.5" />
    </svg>
  );
}

function Cross() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="h-3 w-3"
    >
      <path d="m5 5 6 6M11 5l-6 6" />
    </svg>
  );
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

/**
 * The landing page's picture of Jami, played rather than posed: an answer is
 * written, marked point by point, the missed mark becomes a flashcard, and the
 * topic Jami would put next lights up. Then the next subject begins.
 *
 * The subjects and the three steps under the card are real controls -- choosing
 * one jumps the demo there -- so the page answers "how does it work" by showing
 * it. With reduced motion the finished state is shown and nothing plays by
 * itself.
 *
 * The animated card is hidden from assistive technology; each example is
 * described in one sentence instead, since the made-up question is not content.
 */
export default function LandingPreview() {
  const reducedMotion = usePrefersReducedMotion();
  // One piece of state, so the clock can roll over into the next example in
  // the same update that advances it.
  const [demo, setDemo] = useState({ index: 0, elapsed: 0 });
  const stageRef = useRef<HTMLDivElement>(null);

  const exampleIndex = demo.index;
  const elapsed = demo.elapsed;
  const example = EXAMPLES[exampleIndex];
  const timeline = timelineFor(example);
  // Reduced motion shows every example finished, whatever the clock says.
  const clock = reducedMotion ? timeline.end : elapsed;

  useEffect(() => {
    if (reducedMotion) return;
    const interval = window.setInterval(() => {
      if (document.hidden) return;
      setDemo((current) => {
        const next = current.elapsed + TICK_MS;
        if (next < timelineFor(EXAMPLES[current.index]).end) {
          return { index: current.index, elapsed: next };
        }
        return { index: (current.index + 1) % EXAMPLES.length, elapsed: 0 };
      });
    }, TICK_MS);
    return () => window.clearInterval(interval);
  }, [reducedMotion]);

  const chooseExample = useCallback((index: number) => {
    setDemo({ index, elapsed: 0 });
  }, []);

  const stepStarts = [0, timeline.keepStart, timeline.nextStart, timeline.end];
  const activeStep = clock >= timeline.nextStart ? 2 : clock >= timeline.keepStart ? 1 : 0;

  const chooseStep = (step: number) => {
    // Land just inside the step, so its first moment has already happened.
    setDemo({ index: exampleIndex, elapsed: step === 0 ? 0 : stepStarts[step] + 1 });
  };

  // A slight lean toward the pointer, and light that follows it. Written to CSS
  // variables directly: re-rendering on every pointer move would be wasteful.
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const stage = stageRef.current;
    if (!stage || event.pointerType !== "mouse" || reducedMotion) return;
    const rect = stage.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    stage.style.setProperty("--landing-spot-x", `${(x * 100).toFixed(1)}%`);
    stage.style.setProperty("--landing-spot-y", `${(y * 100).toFixed(1)}%`);
    stage.style.setProperty("--landing-lean-x", `${((0.5 - y) * 5).toFixed(2)}deg`);
    stage.style.setProperty("--landing-lean-y", `${((x - 0.5) * 7).toFixed(2)}deg`);
  };

  const handlePointerLeave = () => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.style.setProperty("--landing-lean-x", "0deg");
    stage.style.setProperty("--landing-lean-y", "0deg");
  };

  const typedChars = Math.min(
    example.answer.length,
    Math.floor(clock / TYPE_MS_PER_CHAR)
  );
  const typing = typedChars < example.answer.length;
  const pointsShown = Math.max(
    0,
    Math.min(
      example.points.length,
      Math.floor((clock - timeline.markStart) / MARK_MS_PER_POINT) + 1
    )
  );
  const earnedShown = example.points
    .slice(0, pointsShown)
    .filter((point) => point.earned).length;
  const keeping = clock >= timeline.keepStart;
  const flipped = clock >= timeline.flipAt;
  const nextLive = clock >= timeline.nextStart;
  const earnedTotal = example.points.filter((point) => point.earned).length;

  return (
    <div className="relative mx-auto w-full max-w-lg">
      <div
        role="tablist"
        aria-label="Example subject"
        className="relative z-10 mb-4 flex flex-wrap gap-2"
      >
        {EXAMPLES.map((item, index) => {
          const selected = index === exampleIndex;
          return (
            <button
              key={item.subject}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => chooseExample(index)}
              className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition duration-fast ${
                selected
                  ? "border-[var(--color-border-strong)] bg-[var(--color-glass-medium)] text-text-primary shadow-e1"
                  : "border-transparent text-text-muted hover:bg-[var(--button-ghost-bg-hover)] hover:text-text-primary"
              }`}
            >
              {item.subject}
            </button>
          );
        })}
      </div>

      <p className="sr-only" aria-live="polite">
        {`${example.subject} example: an answer marked ${earnedTotal} out of ${example.points.length} against the mark scheme, a flashcard made from the missed mark, and ${example.next.topic} suggested as the next thing to revise.`}
      </p>

      <div
        ref={stageRef}
        aria-hidden="true"
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        className="landing-stage relative pt-14 sm:pt-12"
      >
        <div className="landing-orbit landing-orbit-turning h-[26rem] w-[26rem] sm:h-[32rem] sm:w-[32rem]" />

        <div className="landing-lean">
          <div className="signed-out-panel landing-spotlight rounded-xl p-4 sm:rounded-2xl sm:p-6">
            <div className="flex items-center justify-between gap-3 pr-36 sm:pr-40">
              <div className="flex items-center gap-2">
                <span className="app-chip rounded-full px-2.5 py-0.5 text-2xs font-semibold uppercase tracking-[0.14em]">
                  {example.subject}
                </span>
                <span className="text-xs text-text-muted">{example.marks} marks</span>
              </div>
            </div>

            <p className="mt-3 min-h-[3rem] text-sm font-medium leading-6 text-text-primary">
              {example.question}
            </p>

            <p className="landing-ruled mt-2 min-h-[3.25rem] rounded-md px-1 text-sm text-text-secondary">
              {example.answer.slice(0, typedChars)}
              {typing ? <span className="landing-caret" /> : null}
            </p>

            <div className="mt-4 border-t border-[var(--color-border)] pt-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-2xs font-semibold uppercase tracking-[0.16em] text-text-muted">
                  {pointsShown > 0 ? "Marked against the scheme" : "Waiting to mark"}
                </span>
                <span className="flex items-center gap-2">
                  <svg viewBox="0 0 36 36" className="h-8 w-8 -rotate-90">
                    <circle
                      cx="18"
                      cy="18"
                      r="15.5"
                      fill="none"
                      stroke="var(--color-border-strong)"
                      strokeWidth="3"
                    />
                    <circle
                      cx="18"
                      cy="18"
                      r="15.5"
                      fill="none"
                      stroke="var(--color-success-mark)"
                      strokeWidth="3"
                      strokeLinecap="round"
                      className="landing-ring"
                      strokeDasharray={`${(RING * earnedShown) / example.points.length} ${RING}`}
                    />
                  </svg>
                  <span className="text-base font-semibold tabular-nums text-text-primary">
                    {earnedShown}
                    <span className="text-text-muted">/{example.points.length}</span>
                  </span>
                </span>
              </div>

              <ul className="mt-3 grid gap-2">
                {example.points.map((point, index) => {
                  const shown = index < pointsShown;
                  return (
                    <li
                      key={point.text}
                      className={`flex items-center gap-2.5 text-xs transition duration-normal sm:text-sm ${
                        shown ? "translate-x-0 opacity-100" : "-translate-x-1 opacity-0"
                      }`}
                    >
                      <span
                        className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${
                          point.earned
                            ? "bg-success-muted text-[var(--color-success-mark)]"
                            : "border border-dashed border-[var(--color-error-mark)] text-[var(--color-error-mark)]"
                        }`}
                      >
                        {point.earned ? <Tick /> : <Cross />}
                      </span>
                      <span className={point.earned ? "text-text-secondary" : "text-text-primary"}>
                        {point.text}
                      </span>
                      {point.earned ? null : (
                        <span className="ml-auto shrink-0 rounded-full bg-error-muted px-2 py-0.5 text-2xs font-semibold text-[var(--color-error-text)]">
                          Missed
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>

            <div
              className={`landing-flip mt-4 h-[5.25rem] transition duration-slow ${
                keeping ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
              }`}
              data-flipped={flipped ? "true" : "false"}
            >
              <div className="landing-flip-inner">
                <div className="landing-flip-face rounded-lg border border-dashed border-[var(--color-border-strong)] bg-[var(--color-glass-subtle)] px-3.5 py-3">
                  <div className="text-2xs font-semibold uppercase tracking-[0.16em] text-text-muted">
                    New flashcard · from the missed mark
                  </div>
                  <p className="mt-1.5 text-sm font-medium leading-5 text-text-primary">
                    {example.flashcard.front}
                  </p>
                </div>
                <div className="landing-flip-face landing-flip-back rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-glass-medium)] px-3.5 py-3">
                  <div className="text-2xs font-semibold uppercase tracking-[0.16em] text-text-muted">
                    Answer
                  </div>
                  <p className="mt-1.5 text-sm font-semibold leading-5 text-text-primary">
                    {example.flashcard.back}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="absolute right-0 top-0 sm:-right-3">
          <div
            className={`signed-out-panel signed-out-panel-opaque landing-tilted w-44 rounded-lg px-4 py-3 [--landing-tilt:3deg] sm:w-52 ${
              nextLive ? "landing-next-live" : ""
            }`}
          >
            <div className="text-2xs font-semibold uppercase tracking-[0.16em] text-text-muted">
              Up next
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  example.next.tone === "warning"
                    ? "bg-[var(--color-warning-mark)] ring-4 ring-warning-muted"
                    : "bg-[var(--color-accent)] ring-4 ring-[var(--color-accent-muted)]"
                }`}
              />
              <span className="truncate text-sm font-semibold text-text-primary">
                {example.next.topic}
              </span>
            </div>
            <p className="mt-0.5 text-xs leading-5 text-text-muted">{example.next.reason}</p>
          </div>
        </div>
      </div>

      <ol className="relative z-10 mt-5 grid gap-2 sm:grid-cols-3">
        {STEPS.map((step, index) => {
          const active = index === activeStep;
          const span = stepStarts[index + 1] - stepStarts[index];
          // Only the step playing shows its progress, so the row reads as
          // "where the demo is", not as a checklist being completed.
          const progress = active
            ? Math.min(1, Math.max(0, (clock - stepStarts[index]) / span))
            : 0;
          return (
            <li key={step.label}>
              <button
                type="button"
                onClick={() => chooseStep(index)}
                aria-current={active ? "step" : undefined}
                className={`group relative w-full overflow-hidden rounded-lg border px-3.5 pb-3 pt-2.5 text-left transition duration-fast ${
                  active
                    ? "border-[var(--color-border-strong)] bg-[var(--color-glass-medium)]"
                    : "border-transparent hover:bg-[var(--button-ghost-bg-hover)]"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span
                    className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-2xs font-semibold tabular-nums transition duration-fast ${
                      active
                        ? "bg-[var(--color-text-primary)] text-[var(--app-background)]"
                        : "border border-[var(--color-border-strong)] text-text-muted"
                    }`}
                  >
                    {index + 1}
                  </span>
                  <span
                    className={`text-xs font-semibold ${
                      active ? "text-text-primary" : "text-text-secondary group-hover:text-text-primary"
                    }`}
                  >
                    {step.label}
                  </span>
                </span>
                <span
                  className={`mt-1.5 block text-xs leading-5 text-text-muted sm:hidden ${
                    active ? "" : "hidden"
                  }`}
                >
                  {step.detail}
                </span>
                <span
                  className="landing-step-progress absolute inset-x-0 bottom-0 h-0.5 origin-left"
                  style={{ transform: `scaleX(${progress})` }}
                  aria-hidden="true"
                />
              </button>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 hidden min-h-[2.5rem] px-1 text-sm leading-6 text-text-muted sm:block">
        {STEPS[activeStep].detail}
      </p>
    </div>
  );
}
