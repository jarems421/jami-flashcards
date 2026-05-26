import Link from "next/link";
import ObjectIcon from "@/components/workspace/ObjectIcon";
import { getObjectColorPreset, normalizeObjectColor } from "@/components/workspace/object-card-styles";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export type NotebookObjectCardProps = {
  title: string;
  subtitle?: string;
  typeLabel?: string;
  folderName?: string;
  color?: string;
  icon?: string;
  pageColor?: string;
  pageCount?: number;
  updatedLabel?: string;
  href?: string;
  onClick?: () => void;
  className?: string;
  compact?: boolean;
};

function NotebookCardInner({
  title,
  typeLabel,
  color,
  icon,
  pageCount,
  updatedLabel,
  compact,
}: NotebookObjectCardProps) {
  const preset = getObjectColorPreset(color);
  const safeColor = normalizeObjectColor(color);

  return (
    <div
      className={cx(
        "group/notebook flex h-full flex-col items-center rounded-[1.25rem] border border-transparent bg-transparent px-3 py-3 text-center transition duration-200 hover:-translate-y-0.5 hover:border-[var(--color-border)] hover:bg-[var(--color-glass-subtle)]",
        compact ? "min-h-[11.5rem]" : "min-h-[12.75rem]",
      )}
    >
      <div className="flex items-center justify-center">
        <div className={cx("relative", compact ? "h-28 w-24" : "h-32 w-28")}>
          <div
            className="absolute left-3 top-2 h-[92%] w-[88%] rounded-[0.85rem] bg-white/90 shadow-[0_8px_14px_rgba(15,23,42,0.16)]"
            aria-hidden="true"
          />
          <div
            className="absolute left-2 top-1.5 h-[92%] w-[88%] rounded-[0.85rem] border border-slate-900/10 bg-slate-100 shadow-[0_5px_0_rgba(15,23,42,0.08)]"
            aria-hidden="true"
          />
          <div
            className="absolute inset-y-0 left-0 top-0 h-full w-[88%] rounded-[0.85rem] border border-white/45 shadow-[0_10px_18px_rgba(15,23,42,0.2)] transition duration-200 group-hover/notebook:-rotate-1"
            style={{
              background: `linear-gradient(145deg, ${preset.light}, ${preset.base} 52%, ${preset.dark})`,
            }}
          >
            <div className="absolute inset-y-3 right-2 w-2 rounded-full bg-white/22" aria-hidden="true" />
            <div className="absolute inset-y-0 left-0 w-4 rounded-l-[0.85rem] bg-black/12" aria-hidden="true" />
            <div className="absolute -left-1.5 top-3 flex h-[74%] flex-col justify-between" aria-hidden="true">
              {Array.from({ length: compact ? 5 : 6 }).map((_, index) => (
                <span
                  key={`${safeColor}-ring-${index}`}
                  className="block h-2.5 w-4 rounded-full border-[1.5px] border-slate-900/55 bg-white/65 shadow-[0_1px_0_rgba(255,255,255,0.5)]"
                />
              ))}
            </div>
            <div className="absolute left-6 top-4 h-5 w-11 rounded-md border border-slate-900/10 bg-white/82 shadow-inner" aria-hidden="true" />
            <ObjectIcon
              icon={icon}
              className="absolute left-7 top-[46%] h-6 w-6 text-white/78 drop-shadow-[0_1px_1px_rgba(0,0,0,0.25)]"
            />
          </div>
        </div>
      </div>

      <div className="mt-3 w-full space-y-1">
        <div>
          <p className="line-clamp-2 text-sm font-semibold leading-5 text-[var(--color-text-primary)]">{title}</p>
        </div>
        <p className="truncate text-xs font-medium text-[var(--color-text-muted)]">
          {updatedLabel ??
            (typeof pageCount === "number"
              ? `${pageCount} ${pageCount === 1 ? "page" : "pages"}`
              : typeLabel)}
        </p>
      </div>
    </div>
  );
}

export function NotebookObjectCard(props: NotebookObjectCardProps) {
  if (props.href) {
    return (
      <Link href={props.href} className={cx("block h-full", props.className)}>
        <NotebookCardInner {...props} />
      </Link>
    );
  }

  if (props.onClick) {
    return (
      <button type="button" onClick={props.onClick} className={cx("block h-full w-full", props.className)}>
        <NotebookCardInner {...props} />
      </button>
    );
  }

  return (
    <div className={cx("h-full", props.className)}>
      <NotebookCardInner {...props} />
    </div>
  );
}
