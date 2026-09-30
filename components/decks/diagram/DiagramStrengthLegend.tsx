import { CARD_STRENGTH_TINT_CLASSES, type CardStrength } from "@/lib/study/card-strength";

const ORDER: Array<[CardStrength, string]> = [
  ["strong", "Strong"],
  ["building", "Building"],
  ["needs-focus", "Needs focus"],
  ["new", "Not studied yet"],
];

/** What the colours on a diagram mean, for the labels it actually has. */
export default function DiagramStrengthLegend({ strengths }: { strengths: ReadonlyMap<string, CardStrength> }) {
  const present = new Set(strengths.values());
  return (
    <ul aria-label="Colour key" className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-muted">
      {ORDER.filter(([strength]) => present.has(strength)).map(([strength, name]) => (
        <li key={strength} className="flex items-center gap-1.5">
          <span aria-hidden="true" className={`${CARD_STRENGTH_TINT_CLASSES[strength]} occlusion-tint-swatch h-2.5 w-2.5 rounded-sm`} />
          {name}
        </li>
      ))}
    </ul>
  );
}
