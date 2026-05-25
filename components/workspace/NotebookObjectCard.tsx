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

const pageColorLabel: Record<string, string> = {
  white: "White page",
  black: "Black page",
  grey: "Grey page",
};

function NotebookCardInner({
  title,
  subtitle,
  typeLabel,
  folderName,
  color,
  icon,
  pageColor,
  pageCount,
  updatedLabel,
  compact,
}: NotebookObjectCardProps) {
  const preset = getObjectColorPreset(color);
  const safeColor = normalizeObjectColor(color);
  const pageTone =
    pageColor === "black"
      ? "bg-slate-950"
      : pageColor === "grey"
        ? "bg-slate-200"
        : "bg-white";

  return (
    <div
      className={cx(
        "group/notebook flex h-full flex-col rounded-[1.4rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4 text-left shadow-[var(--shadow-card)] transition duration-200 hover:-translate-y-1 hover:border-[var(--color-border-strong)] hover:bg-[var(--color-glass-medium)]",
        compact ? "min-h-[16rem]" : "min-h-[19rem]",
      )}
    >
      <div className="flex flex-1 items-center justify-center py-2">
        <div className={cx("relative", compact ? "h-32 w-28" : "h-40 w-36")}>
          <div
            className="absolute left-4 top-3 h-[92%] w-[88%] rounded-[1.05rem] bg-white/90 shadow-[0_12px_20px_rgba(15,23,42,0.18)]"
            aria-hidden="true"
          />
          <div
            className="absolute left-3 top-2 h-[92%] w-[88%] rounded-[1.05rem] border border-slate-900/10 bg-slate-100 shadow-[0_8px_0_rgba(15,23,42,0.08)]"
            aria-hidden="true"
          />
          <div
            className="absolute inset-y-0 left-0 top-0 h-full w-[88%] rounded-[1.05rem] border border-white/45 shadow-[0_16px_26px_rgba(15,23,42,0.22)] transition duration-200 group-hover/notebook:-rotate-1"
            style={{
              background: `linear-gradient(145deg, ${preset.light}, ${preset.base} 52%, ${preset.dark})`,
            }}
          >
            <div className="absolute inset-y-3 right-2 w-2 rounded-full bg-white/22" aria-hidden="true" />
            <div className="absolute inset-y-0 left-0 w-5 rounded-l-[1.05rem] bg-black/12" aria-hidden="true" />
            <div className="absolute -left-2 top-4 flex h-[74%] flex-col justify-between" aria-hidden="true">
              {Array.from({ length: compact ? 5 : 7 }).map((_, index) => (
                <span
                  key={`${safeColor}-ring-${index}`}
                  className="block h-3 w-5 rounded-full border-[2px] border-slate-900/55 bg-white/65 shadow-[0_1px_0_rgba(255,255,255,0.5)]"
                />
              ))}
            </div>
            <div className="absolute left-8 top-5 h-7 w-14 rounded-lg border border-slate-900/10 bg-white/88 shadow-inner" aria-hidden="true" />
            <div className="absolute bottom-5 left-8 flex h-11 w-11 items-center justify-center rounded-2xl bg-white/18 text-white/90 shadow-inner">
              <ObjectIcon icon={icon} className="h-7 w-7" />
            </div>
          </div>
          <div
            className={cx(
              "absolute bottom-1 right-1 h-5 w-14 rounded-full border border-slate-900/10 shadow-sm",
              pageTone,
            )}
            title={pageColor ? pageColorLabel[pageColor] : undefined}
            aria-hidden="true"
          />
        </div>
      </div>

      <div className="space-y-2">
        <div>
          <p className="line-clamp-2 text-base font-semibold text-[var(--color-text-primary)]">{title}</p>
          {subtitle ? (
            <p className="mt-1 line-clamp-2 text-sm text-[var(--color-text-muted)]">{subtitle}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2 text-[0.72rem] font-semibold text-[var(--color-text-muted)]">
          {typeLabel ? (
            <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-panel)] px-2.5 py-1">
              {typeLabel}
            </span>
          ) : null}
          {folderName ? (
            <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-panel)] px-2.5 py-1">
              {folderName}
            </span>
          ) : null}
          {typeof pageCount === "number" ? (
            <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-panel)] px-2.5 py-1">
              {pageCount} {pageCount === 1 ? "page" : "pages"}
            </span>
          ) : null}
        </div>
        {updatedLabel ? (
          <p className="text-xs font-medium text-[var(--color-text-muted)]">{updatedLabel}</p>
        ) : null}
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
