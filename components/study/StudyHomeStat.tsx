/** One figure from the study home summary row. */
export default function StudyHomeStat({
  value,
  label,
}: {
  value: number;
  label: string;
}) {
  return (
    <div className="min-w-[5.25rem]">
      <div className="text-xl font-semibold leading-none tabular-nums text-text-primary sm:text-2xl">
        {value}
      </div>
      <div className="mt-1.5 text-xs font-medium text-text-muted">{label}</div>
    </div>
  );
}
