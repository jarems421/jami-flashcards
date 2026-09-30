import { markTypedAnswer } from "@/lib/study/answer-marking";
import {
  getOcclusionLabel,
  type CardOcclusion,
  type OcclusionDiagram,
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

export type DiagramConfusionEvent = { cardId: string; confusedWithLabelId: string };

export type DiagramConfusionPair = {
  labelIds: [string, string];
  names: [string, string];
  count: number;
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
  const counts = new Map<string, { labelIds: [string, string]; count: number }>();
  for (const event of events) {
    const asked = askedLabelByCard.get(event.cardId);
    const given = event.confusedWithLabelId;
    if (!asked || asked === given || !names.has(asked) || !names.has(given)) continue;
    const labelIds = [asked, given].sort() as [string, string];
    const key = labelIds.join(" ");
    const entry = counts.get(key) ?? { labelIds, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  return [...counts.values()]
    .map(({ labelIds, count }) => ({
      labelIds,
      names: [names.get(labelIds[0])!, names.get(labelIds[1])!] as [string, string],
      count,
    }))
    .sort((left, right) => right.count - left.count || left.names[0].localeCompare(right.names[0]));
}
