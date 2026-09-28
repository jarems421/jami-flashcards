/*
 * The question, answer and marks below are written for this page. They are not
 * taken from any exam board's paper or mark scheme, so nothing here needs a
 * permission record -- and nothing licensed should ever be pasted in to make
 * the picture look more real.
 */
const MARK_POINTS = [
  { text: "Enzyme denatures", earned: true },
  { text: "Active site changes shape", earned: true },
  { text: "Substrate no longer fits", earned: true },
  { text: "Fewer enzyme–substrate complexes", earned: false },
] as const;

const EARNED = MARK_POINTS.filter((point) => point.earned).length;

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

function MarkedAnswer() {
  return (
    <div className="signed-out-panel rounded-xl p-4 sm:rounded-2xl sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="app-chip rounded-full px-2.5 py-0.5 text-2xs font-semibold uppercase tracking-[0.14em]">
            Biology
          </span>
          <span className="text-xs text-text-muted">Question 3</span>
        </div>
        <span className="text-xs font-medium text-text-muted">4 marks</span>
      </div>

      <p className="mt-3 text-sm font-medium leading-6 text-text-primary">
        Explain why an enzyme works more slowly above its optimum temperature.
      </p>

      <p className="landing-ruled mt-3 rounded-md px-1 text-sm text-text-secondary">
        The enzyme denatures, so its active site changes shape and the substrate
        no longer fits.
      </p>

      <div className="mt-4 border-t border-[var(--color-border)] pt-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-2xs font-semibold uppercase tracking-[0.16em] text-text-muted">
            Marked against the scheme
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
                strokeDasharray={`${(RING * EARNED) / MARK_POINTS.length} ${RING}`}
              />
            </svg>
            <span className="text-base font-semibold tabular-nums text-text-primary">
              {EARNED}
              <span className="text-text-muted">/{MARK_POINTS.length}</span>
            </span>
          </span>
        </div>

        <ul className="mt-3 grid gap-2">
          {MARK_POINTS.map((point) => (
            <li key={point.text} className="flex items-center gap-2.5 text-xs sm:text-sm">
              <span
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${
                  point.earned
                    ? "bg-success-muted text-[var(--color-success-mark)]"
                    : "border border-dashed border-[var(--color-error-mark)] text-[var(--color-error-mark)]"
                }`}
              >
                {point.earned ? <Tick /> : <Cross />}
              </span>
              <span
                className={point.earned ? "text-text-secondary" : "text-text-primary"}
              >
                {point.text}
              </span>
              {point.earned ? null : (
                <span className="ml-auto shrink-0 rounded-full bg-error-muted px-2 py-0.5 text-2xs font-semibold text-[var(--color-error-text)]">
                  Missed
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function NextUp() {
  return (
    <div className="signed-out-panel signed-out-panel-opaque landing-tilted w-44 rounded-lg px-4 py-3 [--landing-tilt:3deg] sm:w-48">
      <div className="text-2xs font-semibold uppercase tracking-[0.16em] text-text-muted">
        Up next
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-warning-mark)] ring-4 ring-warning-muted" />
        <span className="text-sm font-semibold text-text-primary">Enzymes</span>
      </div>
      <p className="mt-0.5 text-xs leading-5 text-text-muted">
        Slipping · 3 cards due
      </p>
    </div>
  );
}

function NewFlashcard() {
  return (
    <div className="signed-out-panel signed-out-panel-opaque landing-tilted landing-tilted-late w-56 rounded-lg px-4 py-3.5 [--landing-tilt:-3deg] sm:w-64">
      <div className="flex items-center justify-between gap-2 text-2xs font-semibold uppercase tracking-[0.16em] text-text-muted">
        New flashcard
        <span className="normal-case tracking-normal">from Q3</span>
      </div>
      <p className="mt-2 text-sm font-medium leading-5 text-text-primary">
        What forms less often once an enzyme denatures?
      </p>
      <p className="mt-2 border-t border-dashed border-[var(--color-border-strong)] pt-2 text-xs leading-5 text-text-secondary">
        Enzyme–substrate complexes
      </p>
    </div>
  );
}

/**
 * The landing page's picture of Jami: one past-paper answer, marked, and what
 * came of it.
 *
 * It replaces the walkthrough's constellation trail, which showed a signed-out
 * visitor the shape of an onboarding checklist they had never seen. This shows
 * the three things the page goes on to describe instead -- a marked answer, a
 * flashcard kept from the mark that was missed, and the topic Jami puts next --
 * so the picture and the words say the same thing.
 *
 * Built from markup rather than a screenshot, so it is sharp at every size and
 * cannot go on showing a screen the app no longer has. To a screen reader it is
 * one image with a description; the made-up question is not content.
 */
export default function LandingPreview() {
  return (
    <div
      role="img"
      aria-label="An example answer marked 3 out of 4 against the mark scheme, a flashcard made from the missed mark, and Enzymes suggested as the next thing to revise."
      /*
        * The padding is the room the two floating cards sit in. Each overlaps
        * the answer card only by about its own padding, so neither ever covers
        * a line of the answer or its marks.
        */
      className="relative mx-auto w-full max-w-lg px-1 pb-[7.5rem] pt-[5.25rem] sm:px-8 sm:pb-[7.75rem] sm:pt-[5.5rem]"
    >
      <div className="landing-orbit landing-orbit-turning h-[26rem] w-[26rem] sm:h-[34rem] sm:w-[34rem]" />
      <div className="landing-orbit h-[18rem] w-[18rem] opacity-60 sm:h-[24rem] sm:w-[24rem]" />

      <MarkedAnswer />

      <div className="absolute right-0 top-0 sm:-right-2">
        <NextUp />
      </div>
      <div className="absolute bottom-0 left-0 sm:-left-4">
        <NewFlashcard />
      </div>
    </div>
  );
}
