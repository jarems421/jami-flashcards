import { type CardQualityWarning } from "@/lib/study/card-quality";

const warningClasses: Record<CardQualityWarning["tone"], string> = {
  warm: "border-amber-300/20 bg-amber-300/[0.08] text-amber-100",
  error: "border-rose-300/20 bg-rose-400/[0.10] text-rose-100",
  calm: "border-white/[0.10] bg-white/[0.04] text-text-muted",
};

export default function CardQualityWarnings({
  warnings,
}: {
  warnings: CardQualityWarning[];
}) {
  if (warnings.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {warnings.map((warning) => (
        <span
          key={warning.id}
          title={warning.detail}
          className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[0.68rem] font-medium ${warningClasses[warning.tone]}`}
        >
          {warning.label}
        </span>
      ))}
    </div>
  );
}
