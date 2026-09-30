"use client";

import { useFirstNight } from "@/components/onboarding/FirstNightProvider";
import { DrawnLines, Sparkle } from "@/components/onboarding/FirstNightSky";
import { SECOND_NIGHT_STARS } from "@/lib/onboarding/first-night";

/**
 * Three more stars, for a student who wants them.
 *
 * The first night covers the loop; this covers what a student would otherwise
 * only find by wandering -- their own material for Jami to read, a plan for the
 * week, and where they stand. It is offered, never required: nothing is locked
 * behind it, it can be put away in one press, and it earns only its own lit
 * stars.
 */
export default function SecondNightPanel() {
  const { secondNight, state, goToSecondNight, hideSecondNight } = useFirstNight();
  if (!secondNight || !state) return null;

  const lit = state.bonus;
  const points = SECOND_NIGHT_STARS.map(({ x, y }) => ({ x, y }));
  const pairs = SECOND_NIGHT_STARS.slice(1).map((_, index) => [index, index + 1] as [number, number]);
  const litPairs = pairs.filter(([a, b]) => lit.includes(SECOND_NIGHT_STARS[a].id) && lit.includes(SECOND_NIGHT_STARS[b].id));

  return (
    <section className="fn-constellation app-panel rounded-2xl p-5" aria-label="Second night">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-2xs font-semibold uppercase tracking-[0.18em] text-text-muted">Second night · optional</div>
          <h2 className="mt-1.5 text-lg font-semibold text-text-primary">Three more stars, if you want them</h2>
        </div>
        <button type="button" className="shrink-0 rounded-full px-2 py-1 text-xs text-text-muted transition duration-fast hover:text-text-primary" onClick={hideSecondNight}>
          Put away
        </button>
      </div>

      <div className="fn-first-sky fn-second-sky">
        <span className="fn-sky-dust" aria-hidden="true" />
        <DrawnLines ghost points={points} pairs={pairs} />
        {litPairs.length ? <DrawnLines key={litPairs.length} points={points} pairs={litPairs} delay={0.3} step={0} /> : null}
        {SECOND_NIGHT_STARS.map((star) => (
          <span
            key={star.id}
            className={lit.includes(star.id) ? "fn-second-lit" : "fn-unlit"}
            style={{ left: `${star.x}%`, top: `${star.y}%` }}
          >
            <Sparkle size={lit.includes(star.id) ? 22 : 16} />
          </span>
        ))}
      </div>

      <ol className="flex flex-col gap-1">
        {SECOND_NIGHT_STARS.map((star) => {
          const isLit = lit.includes(star.id);
          return (
            <li key={star.id}>
              <button
                type="button"
                disabled={isLit}
                onClick={() => goToSecondNight(star.id)}
                className="flex w-full items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-left transition duration-fast enabled:hover:border-[var(--color-border)] enabled:hover:bg-[var(--nav-hover-bg)]"
              >
                <span className={`fn-row-mark ${isLit ? "fn-row-mark-lit" : ""}`}>
                  <Sparkle size={12} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm font-medium ${isLit ? "text-text-muted" : "text-text-primary"}`}>{star.title}</span>
                  <span className="block text-xs text-text-muted">{isLit ? "Lit" : star.promise}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
