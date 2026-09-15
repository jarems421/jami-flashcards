"use client";

import ConstellationStar from "@/components/constellation/ConstellationStar";
import { useFirstNight } from "@/components/onboarding/FirstNightProvider";
import { DrawnLines, Sparkle, makeFirstNightStar } from "@/components/onboarding/FirstNightSky";
import { firstNightDiscoveries } from "@/lib/onboarding/first-night";

/**
 * "Your first constellation" on Today: a star for each real thing to do.
 *
 * Pressing a row does not do it for the student. It lights the sidebar entry
 * where that thing lives, so they get there the way they always will, and the
 * star lights once the app hears it happen.
 */
export default function FirstNightPanel() {
  const { active, state, justLit, finale, point, end } = useFirstNight();
  if (!active || !state || (state.stage !== "tour" && state.stage !== "exploring")) return null;

  const discoveries = firstNightDiscoveries(state);
  const lit = state.lit;
  const litCount = discoveries.filter((discovery) => lit.includes(discovery.id)).length;
  const complete = litCount === discoveries.length;
  const points = discoveries.map(({ x, y }) => ({ x, y }));
  const allPairs = discoveries.slice(1).map((_, index) => [index, index + 1] as [number, number]);
  const pairs = allPairs.filter(([a, b]) => lit.includes(discoveries[a].id) && lit.includes(discoveries[b].id));
  const ring = discoveries.find((discovery) => discovery.id === justLit);

  return (
    <section data-tutorial-target="first-night" className={`app-panel rounded-2xl p-5 ${finale === "leaving" ? "fn-leave" : ""}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-2xs font-semibold uppercase tracking-[0.18em] text-text-muted">First night</div>
          <h2 className="mt-1.5 text-lg font-semibold text-text-primary">
            {complete ? "Your first constellation is complete" : "Your first constellation"}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="app-chip whitespace-nowrap rounded-full px-3 py-1 text-xs text-text-secondary">
            {litCount} of {discoveries.length} lit
          </span>
          <button type="button" className="rounded-full px-2 py-1 text-xs text-text-muted transition duration-fast hover:text-text-primary" onClick={end}>
            Skip
          </button>
        </div>
      </div>

      <div className={`fn-first-sky ${finale === "drawing" ? "fn-first-sky-glow" : ""}`}>
        {/* The shape still to fill, faintly, so there is something to light. */}
        <DrawnLines ghost points={points} pairs={allPairs} />
        {pairs.length ? <DrawnLines key={pairs.length} points={points} pairs={pairs} delay={0.5} step={0} /> : null}
        {discoveries.map((discovery) =>
          lit.includes(discovery.id) ? (
            <div key={discovery.id} className={`fn-star-wrap ${justLit === discovery.id ? "fn-fade-slow" : ""}`}>
              <ConstellationStar star={makeFirstNightStar(`first-night-${discovery.id}`, discovery.x, discovery.y, 3.6, 1)} variant="preview" visualSize={34} />
            </div>
          ) : (
            <span key={discovery.id} className="fn-unlit" style={{ left: `${discovery.x}%`, top: `${discovery.y}%` }}>
              <Sparkle size={16} />
            </span>
          )
        )}
        {ring ? <span key={ring.id} className="fn-ring" style={{ left: `${ring.x}%`, top: `${ring.y}%` }} /> : null}
      </div>

      <ol className="flex flex-col gap-1">
        {discoveries.map((discovery) => {
          const isLit = lit.includes(discovery.id);
          return (
            <li key={discovery.id}>
              <button
                type="button"
                disabled={isLit || state.stage !== "exploring"}
                onClick={() => point(discovery.id)}
                className="flex w-full items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-left transition duration-fast enabled:hover:border-[var(--color-border)] enabled:hover:bg-[var(--nav-hover-bg)]"
              >
                <span className={`fn-row-mark ${isLit ? "fn-row-mark-lit" : ""}`}>
                  <Sparkle size={12} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm font-medium ${isLit ? "text-text-muted" : "text-text-primary"}`}>{discovery.title}</span>
                  <span className="block text-xs text-text-muted">In {discovery.where}</span>
                </span>
                <span className="text-xs text-text-muted">
                  {isLit ? (
                    "Lit"
                  ) : (
                    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
