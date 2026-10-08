"use client";

import { useState } from "react";
import { OcclusionPicture } from "@/components/cards/OcclusionFigure";
import DiagramMixUpDialog from "@/components/decks/diagram/DiagramMixUpDialog";
import { Button, SectionHeader } from "@/components/ui";
import { useDiagramMixUps } from "@/hooks/useDiagramMixUps";
import type { Card } from "@/lib/study/cards";
import {
  describeLastMixUp,
  getMixUpLabels,
  getMixUpMasks,
  type DiagramMixUp,
} from "@/lib/study/diagram-confusion";
import { getLabelDisplayName } from "@/lib/study/image-occlusion";

/** Pairs shown before "Show all": the ones mixed up most. */
const FIRST_SHOWN = 6;

const mixUpKey = (mixUp: DiagramMixUp) => `${mixUp.diagram.id}:${mixUp.labelIds.join(":")}`;

/**
 * The labels a student keeps giving for each other on this deck's diagrams.
 *
 * A wrong answer on a diagram is usually the right answer to the box next
 * door, and Learn records which box when it is. This gathers those mix-ups,
 * most often first, so each pair can be looked at side by side. Nothing is
 * shown until there is at least one, and nothing waits on it.
 */
export default function DiagramMixUpsSection({ userId, cards }: { userId: string; cards: readonly Card[] }) {
  const mixUps = useDiagramMixUps(userId, cards);
  const [comparing, setComparing] = useState<DiagramMixUp | null>(null);
  const [showAll, setShowAll] = useState(false);
  // Fixed for the visit, so "last yesterday" never changes under the student.
  // Nothing is drawn before the mix-ups load in the browser, so it never meets
  // the server's clock.
  const [now] = useState(() => Date.now());
  if (mixUps.length === 0) return null;

  const shown = showAll ? mixUps : mixUps.slice(0, FIRST_SHOWN);
  return (
    <section className="app-panel p-4 sm:p-5">
      <SectionHeader
        eyebrow="Your mix-ups"
        title={mixUps.length === 1 ? "1 pair of labels to untangle" : `${mixUps.length} pairs of labels to untangle`}
        description="Labels you've given for each other in Learn. Seeing the two side by side is the quickest way to tell them apart."
      />
      <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((mixUp) => (
          <MixUpTile key={mixUpKey(mixUp)} mixUp={mixUp} now={now} onCompare={() => setComparing(mixUp)} />
        ))}
      </ul>
      {mixUps.length > FIRST_SHOWN ? (
        <div className="mt-3 flex justify-center">
          <Button type="button" size="sm" variant="ghost" onClick={() => setShowAll((current) => !current)}>
            {showAll ? "Show fewer" : `Show all ${mixUps.length}`}
          </Button>
        </div>
      ) : null}
      <DiagramMixUpDialog mixUp={comparing} now={now} onClose={() => setComparing(null)} />
    </section>
  );
}

function MixUpTile({ mixUp, now, onCompare }: { mixUp: DiagramMixUp; now: number; onCompare: () => void }) {
  const pair = getMixUpLabels(mixUp.diagram, mixUp.labelIds);
  if (!pair) return null;
  const [first, second] = pair.map(({ label, index }) => getLabelDisplayName(label, index));
  const times = mixUp.count === 1 ? "Once" : `${mixUp.count} times`;
  return (
    <li className="flex min-w-0 gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-3">
      <button
        type="button"
        onClick={onCompare}
        aria-label={`Compare ${first} and ${second}`}
        className="h-24 w-32 shrink-0 overflow-hidden rounded-lg bg-[var(--color-glass-medium)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-selected-border)]"
      >
        <OcclusionPicture
          diagram={mixUp.diagram}
          masks={getMixUpMasks(mixUp.diagram, mixUp.labelIds)}
          label=""
          fit="contain"
          compact
        />
      </button>
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-text-primary">
            <span aria-hidden="true" className="occlusion-key occlusion-key--target" />
            <span className="truncate">{first}</span>
          </p>
          <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-text-primary">
            <span aria-hidden="true" className="occlusion-key occlusion-key--confused" />
            <span className="truncate">{second}</span>
          </p>
          <p className="truncate text-xs text-text-muted">
            {times}
            {mixUp.lastAt !== undefined ? `, last ${describeLastMixUp(mixUp.lastAt, now)}` : ""} · {mixUp.title}
          </p>
        </div>
        <div>
          <Button type="button" size="sm" variant="secondary" onClick={onCompare}>
            Compare
          </Button>
        </div>
      </div>
    </li>
  );
}
