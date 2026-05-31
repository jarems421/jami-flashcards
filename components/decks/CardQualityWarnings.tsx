import { type CardQualityWarning } from "@/lib/study/card-quality";

const warningClasses: Record<CardQualityWarning["tone"], string> = {
  warm: "app-warning",
  error: "app-danger",
  calm: "app-chip",
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
