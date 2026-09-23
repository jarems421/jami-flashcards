"use client";

import { useFirstNight } from "@/components/onboarding/FirstNightProvider";
import { DrawnLines, makeFirstNightStar, Sparkle } from "@/components/onboarding/FirstNightSky";
import ConstellationStar from "@/components/constellation/ConstellationStar";
import { firstNightDiscoveries, nextFirstNightDiscovery } from "@/lib/onboarding/first-night";

function Arrow() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

/**
 * "Your first constellation" on Today: a star for each real thing to do, and
 * the next one offered as a single step.
 *
 * A checklist of six equal rows asked the student to choose, then to find the
 * place, then to work out what to do there. The next star is now offered on
 * its own with how long it takes and what it is, and one press goes there; the
 * rest stay in the sky and in the list, a press away, for anyone who would
 * rather pick. A star still lights only when the app hears the thing happen.
 */
export default function FirstNightPanel() {
  const { active, state, justLit, finale, goTo, end } = useFirstNight();
  if (!active || !state || (state.stage !== "tour" && state.stage !== "exploring")) return null;

  const discoveries = firstNightDiscoveries(state);
  const lit = state.lit;
  const litCount = discoveries.filter((discovery) => lit.includes(discovery.id)).length;
  const complete = litCount === discoveries.length;
  const exploring = state.stage === "exploring";
  const next = nextFirstNightDiscovery(state);
  const points = discoveries.map(({ x, y }) => ({ x, y }));
  const allPairs = discoveries.slice(1).map((_, index) => [index, index + 1] as [number, number]);
  const pairs = allPairs.filter(([a, b]) => lit.includes(discoveries[a].id) && lit.includes(discoveries[b].id));
  const ring = discoveries.find((discovery) => discovery.id === justLit);

  return (
    <section data-tutorial-target="first-night" className={`fn-constellation app-panel rounded-2xl p-5 ${finale === "leaving" ? "fn-leave" : ""}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-2xs font-semibold uppercase tracking-[0.18em] text-text-muted">First night</div>
          <h2 className="mt-1.5 text-lg font-semibold text-text-primary">
            {complete ? "Your first constellation is complete" : "Your first constellation"}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="app-chip whitespace-nowrap rounded-full px-3 py-1 text-xs tabular-nums text-text-secondary">
            {litCount} of {discoveries.length} lit
          </span>
          <button type="button" className="rounded-full px-2 py-1 text-xs text-text-muted transition duration-fast hover:text-text-primary" onClick={end}>
            Skip
          </button>
        </div>
      </div>

      <div className={`fn-first-sky ${finale === "drawing" ? "fn-first-sky-glow" : ""}`}>
        <span className="fn-sky-dust" aria-hidden="true" />
        {/* The shape still to fill, faintly, so there is something to light. */}
        <DrawnLines ghost points={points} pairs={allPairs} />
        {pairs.length ? <DrawnLines key={pairs.length} points={points} pairs={pairs} delay={0.5} step={0} /> : null}
        {discoveries.map((discovery) =>
          lit.includes(discovery.id) ? (
            <div key={discovery.id} className={`fn-star-wrap ${justLit === discovery.id ? "fn-fade-slow" : ""}`}>
              <ConstellationStar star={makeFirstNightStar(`first-night-${discovery.id}`, discovery.x, discovery.y, 3.6, 1)} variant="preview" visualSize={34} />
            </div>
          ) : (
            <span
              key={discovery.id}
              className={`fn-unlit ${exploring && next?.id === discovery.id ? "fn-unlit-next" : ""}`}
              style={{ left: `${discovery.x}%`, top: `${discovery.y}%` }}
            >
              <Sparkle size={16} />
            </span>
          )
        )}
        {ring ? <span key={ring.id} className="fn-ring" style={{ left: `${ring.x}%`, top: `${ring.y}%` }} /> : null}
      </div>

      {exploring && next ? (
        <div key={next.id} className="fn-next">
          <div className="fn-next-meta">
            <Sparkle size={11} />
            <span>Up next · about {next.minutes} {next.minutes === 1 ? "minute" : "minutes"}</span>
          </div>
          <div className="fn-next-title">{next.title}</div>
          <p className="fn-next-text">{next.promise}</p>
          <button type="button" className="fn-cta fn-small-cta fn-next-go" onClick={() => goTo(next.id)}>
            Take me there <Arrow />
          </button>
        </div>
      ) : null}

      <ol className="mt-2 flex flex-col gap-1">
        {discoveries.map((discovery) => {
          const isLit = lit.includes(discovery.id);
          if (exploring && discovery.id === next?.id) return null;
          return (
            <li key={discovery.id}>
              <button
                type="button"
                disabled={isLit || !exploring}
                onClick={() => goTo(discovery.id)}
                className="flex w-full items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-left transition duration-fast enabled:hover:border-[var(--color-border)] enabled:hover:bg-[var(--nav-hover-bg)]"
              >
                <span className={`fn-row-mark ${isLit ? "fn-row-mark-lit" : ""}`}>
                  <Sparkle size={12} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm font-medium ${isLit ? "text-text-muted" : "text-text-primary"}`}>{discovery.title}</span>
                  <span className="block text-xs text-text-muted">
                    {isLit ? "Lit" : `In ${discovery.where} · about ${discovery.minutes} min`}
                  </span>
                </span>
                {isLit ? null : (
                  <span className="text-text-muted">
                    <Arrow />
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
