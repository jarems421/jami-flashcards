import { markTypedAnswer } from "@/lib/study/answer-marking";
import { getStudyDayKey, getStudyDayStartFromKey } from "@/lib/study/day";
import {
  getOcclusionLabel,
  groupDiagramCards,
  type CardOcclusion,
  type OcclusionDiagram,
  type OcclusionLabel,
  type OcclusionMask,
} from "@/lib/study/image-occlusion";

/**
 * Which neighbour a student gave instead of the label asked.
 *
 * A wrong answer on a diagram is usually a right answer to the box next door:
 * "mitral valve" for the tricuspid. Seeing both side by side is what untangles
 * them, so the answer is matched against every other label of the diagram --
 * its words and its accepted alternatives -- the way a typed answer is marked.
 * Null when it matches none of them, or matches the label asked.
 */
export function findConfusedLabel(occlusion: CardOcclusion, response: string) {
  const text = response.trim();
  const { label: target } = getOcclusionLabel(occlusion);
  if (!text || !target) return null;
  for (const label of occlusion.diagram.labels) {
    if (label.id === target.id || !label.answer.trim()) continue;
    const verdict = markTypedAnswer({
      response: text,
      expectedAnswer: label.answer,
      settings: label.accepts?.length ? { acceptedAnswers: label.accepts } : undefined,
    }).verdict;
    if (verdict === "correct") return label.id;
  }
  return null;
}

/** One recorded mix-up: the card asked, the label given instead, and when. */
export type DiagramConfusionEvent = { cardId: string; confusedWithLabelId: string; reviewedAt?: number };

export type DiagramConfusionPair = {
  labelIds: [string, string];
  names: [string, string];
  count: number;
  /** The most recent time the pair was mixed up, when the events say. */
  lastAt?: number;
};

/**
 * The pairs of labels a student mixes up, most often first.
 *
 * Built only from what review events record: which card was asked and which
 * label was given instead. A pair counts both ways round -- mitral for
 * tricuspid and tricuspid for mitral are one confusion.
 */
export function summariseDiagramConfusions(
  diagram: OcclusionDiagram,
  cards: ReadonlyArray<{ id: string; occlusion?: CardOcclusion }>,
  events: readonly DiagramConfusionEvent[]
): DiagramConfusionPair[] {
  const askedLabelByCard = new Map(
    cards.flatMap((card) =>
      card.occlusion?.diagram.id === diagram.id && card.occlusion.labelId
        ? [[card.id, card.occlusion.labelId] as const]
        : []
    )
  );
  const names = new Map(
    diagram.labels.map((label, index) => [label.id, label.answer.trim() || `Label ${index + 1}`])
  );
  const counts = new Map<string, { labelIds: [string, string]; count: number; lastAt?: number }>();
  for (const event of events) {
    const asked = askedLabelByCard.get(event.cardId);
    const given = event.confusedWithLabelId;
    if (!asked || asked === given || !names.has(asked) || !names.has(given)) continue;
    const labelIds = [asked, given].sort() as [string, string];
    const key = labelIds.join(" ");
    const entry = counts.get(key) ?? { labelIds, count: 0 };
    entry.count += 1;
    if (typeof event.reviewedAt === "number") {
      entry.lastAt = Math.max(entry.lastAt ?? 0, event.reviewedAt);
    }
    counts.set(key, entry);
  }
  return [...counts.values()]
    .map(({ labelIds, count, lastAt }) => ({
      labelIds,
      names: [names.get(labelIds[0])!, names.get(labelIds[1])!] as [string, string],
      count,
      ...(lastAt !== undefined ? { lastAt } : {}),
    }))
    .sort((left, right) => right.count - left.count || left.names[0].localeCompare(right.names[0]));
}

// ---------------------------------------------------------------------------
// Your mix-ups

/**
 * At most this many cards are asked about: thirty per read, so twenty reads.
 * A deck with more diagram labels than this has its most-studied ones checked.
 */
export const MIX_UP_CARD_LIMIT = 600;

type MixUpCard = {
  id: string;
  front: string;
  occlusion?: CardOcclusion;
  reps?: number;
};

/**
 * The cards worth asking about: one label each, studied at least once.
 *
 * Only a card that asks one label can record which other label was given, and
 * only a card that has been answered can have been answered wrong. A card from
 * before review counts were kept is asked about rather than assumed unstudied.
 */
export function mixUpCardIds(cards: readonly MixUpCard[], limit = MIX_UP_CARD_LIMIT): string[] {
  return cards
    .filter((card) => card.occlusion?.labelId && card.reps !== 0)
    .sort((left, right) => (right.reps ?? 0) - (left.reps ?? 0))
    .slice(0, limit)
    .map((card) => card.id);
}

/** One pair mixed up on one diagram, with the diagram to show it on. */
export type DiagramMixUp = DiagramConfusionPair & {
  diagram: OcclusionDiagram;
  /** What the deck page calls the diagram: its question, or "Diagram". */
  title: string;
};

/** Every diagram's mix-ups across a deck: most often first, then most recent. */
export function summariseDeckMixUps(
  cards: readonly MixUpCard[],
  events: readonly DiagramConfusionEvent[]
): DiagramMixUp[] {
  if (events.length === 0) return [];
  return groupDiagramCards(cards)
    .flatMap(({ diagram, cards: diagramCards }) => {
      const title = diagramCards[0]?.front.trim() || "Diagram";
      return summariseDiagramConfusions(diagram, diagramCards, events).map((pair) => ({ ...pair, diagram, title }));
    })
    .sort(
      (left, right) =>
        right.count - left.count ||
        (right.lastAt ?? 0) - (left.lastAt ?? 0) ||
        left.names[0].localeCompare(right.names[0])
    );
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** When a pair was last mixed up, counted in study days: "today", "yesterday", "3 days ago". */
export function describeLastMixUp(lastAt: number, now: number) {
  const days = Math.round(
    (getStudyDayStartFromKey(getStudyDayKey(now)) - getStudyDayStartFromKey(getStudyDayKey(lastAt))) / DAY_MS
  );
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

/**
 * The pair's two labels in the order the diagram numbers them, each with its
 * number, or null when either has since been removed from the diagram.
 */
export function getMixUpLabels(
  diagram: OcclusionDiagram,
  labelIds: readonly [string, string]
): [{ label: OcclusionLabel; index: number }, { label: OcclusionLabel; index: number }] | null {
  const found = diagram.labels.flatMap((label, index) => (labelIds.includes(label.id) ? [{ label, index }] : []));
  const [first, second] = found;
  return first && second ? [first, second] : null;
}

/**
 * The two labels side by side: the first in the colour a card asks in, the
 * other in the amber a study card outlines a mix-up in, so the picture says
 * the same thing the reveal said. Every other label is as the picture shows
 * it, for context. A covered one of the pair is hidden until it is tapped.
 *
 * Practice, not review: nothing drawn here reaches a schedule.
 */
export function getMixUpMasks(
  diagram: OcclusionDiagram,
  labelIds: readonly [string, string],
  covered: ReadonlySet<string> = new Set()
): OcclusionMask[] {
  const pair = getMixUpLabels(diagram, labelIds);
  return diagram.labels.map((label, index) => {
    if (!pair || (label.id !== pair[0].label.id && label.id !== pair[1].label.id)) {
      return { label, index, look: "other-shown" };
    }
    if (covered.has(label.id)) return { label, index, look: "target-hidden" };
    return { label, index, look: label.id === pair[0].label.id ? "target-revealed" : "other-confused" };
  });
}
