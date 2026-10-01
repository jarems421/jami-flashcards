"use client";

import { useMemo } from "react";
import { OcclusionPicture } from "@/components/cards/OcclusionFigure";
import { Button, SectionHeader } from "@/components/ui";
import type { Card } from "@/lib/study/cards";
import type { CardStrength } from "@/lib/study/card-strength";
import { getDiagramStrengths } from "@/lib/study/diagram-strength";
import {
  getWalkthroughMasks,
  groupDiagramCards,
  type OcclusionDiagram,
} from "@/lib/study/image-occlusion";

type DeckDiagramsSectionProps = {
  cards: Card[];
  onEdit: (card: Card) => void;
  onWalkthrough: (diagram: OcclusionDiagram, title: string, cards: Card[]) => void;
  /** A new diagram on the same picture: the heart labelled again for vessels. */
  onReuse?: (diagram: OcclusionDiagram) => void;
};

const NO_REVEALED = new Set<string>();

/** A one-line account of how well a diagram is known, from its label cards. */
function strengthSummary(strengths: ReadonlyMap<string, CardStrength>) {
  const counts = { strong: 0, building: 0, "needs-focus": 0, new: 0 };
  for (const strength of strengths.values()) counts[strength] += 1;
  const studied = strengths.size - counts.new;
  if (studied === 0) return "Not studied yet";
  const parts = [
    counts.strong ? `${counts.strong} strong` : "",
    counts["needs-focus"] ? `${counts["needs-focus"]} need focus` : "",
    counts.building ? `${counts.building} building` : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

/**
 * The deck's diagrams, one tile each.
 *
 * A diagram's cards -- one for the whole picture, or one per label -- are
 * listed with the cards below; this is where a
 * diagram is handled as the one picture it is -- to go over by hand, to edit
 * its boxes, or to label the same picture again. The thumbnail colours each
 * label by how well it is known, so the weak spots show at a glance.
 */
export default function DeckDiagramsSection({ cards, onEdit, onWalkthrough, onReuse }: DeckDiagramsSectionProps) {
  const groups = useMemo(() => groupDiagramCards(cards), [cards]);
  if (groups.length === 0) return null;

  return (
    <section className="app-panel p-4 sm:p-5">
      <SectionHeader
        eyebrow="Diagrams"
        title={groups.length === 1 ? "1 labelled picture" : `${groups.length} labelled pictures`}
        description="Each box is coloured by how well you know it: green strong, amber building, red needs focus, grey not studied yet."
      />
      <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {groups.map(({ diagram, cards: diagramCards }) => {
          const title = diagramCards[0]?.front.trim() || "Diagram";
          const count = diagram.labels.length;
          const strengths = getDiagramStrengths(diagramCards);
          return (
            <li
              key={diagram.id}
              className="flex min-w-0 gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-3"
            >
              <button
                type="button"
                onClick={() => onWalkthrough(diagram, title, diagramCards)}
                aria-label={`Go over ${title}`}
                className="h-24 w-32 shrink-0 overflow-hidden rounded-lg bg-[var(--color-glass-medium)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-selected-border)]"
              >
                <OcclusionPicture
                  diagram={diagram}
                  masks={getWalkthroughMasks(diagram, NO_REVEALED)}
                  label=""
                  fit="contain"
                  compact
                  tintByLabelId={strengths}
                />
              </button>
              <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-text-primary">{title}</p>
                  <p className="text-xs text-text-muted">
                    {count} label{count === 1 ? "" : "s"} ·{" "}
                    {diagramCards.length === 1 ? "one card" : `${diagramCards.length} cards`}
                  </p>
                  <p className="mt-0.5 text-xs text-text-secondary">{strengthSummary(strengths)}</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button type="button" size="sm" variant="secondary" onClick={() => onWalkthrough(diagram, title, diagramCards)}>
                    Go over it
                  </Button>
                  {diagramCards[0] ? (
                    <Button type="button" size="sm" variant="ghost" onClick={() => onEdit(diagramCards[0])}>
                      Edit
                    </Button>
                  ) : null}
                  {onReuse ? (
                    <Button type="button" size="sm" variant="ghost" onClick={() => onReuse(diagram)}>
                      Label again
                    </Button>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
