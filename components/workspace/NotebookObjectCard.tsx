"use client";

import Link from "next/link";
import ObjectIcon from "@/components/workspace/ObjectIcon";
import { getObjectColorPreset } from "@/components/workspace/object-card-styles";

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
  pageStyle?: string;
  pageCount?: number;
  updatedLabel?: string;
  href?: string;
  onClick?: () => void;
  onRename?: () => void;
  onArchive?: () => void;
  className?: string;
  compact?: boolean;
};

function NotebookCardInner({
  title,
  typeLabel,
  color,
  icon,
  pageColor,
  pageStyle,
  pageCount,
  updatedLabel,
  compact,
}: NotebookObjectCardProps) {
  const preset = getObjectColorPreset(color);
  const paperFill = pageColor === "black" ? "#0b1020" : "#f8fafc";
  const paperLine =
    pageColor === "black" ? "rgba(248,250,252,0.18)" : "rgba(15,23,42,0.13)";
  const paperStyle =
    pageStyle === "lined"
      ? {
          backgroundColor: paperFill,
          backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent 10px, ${paperLine} 11px)`,
        }
      : pageStyle === "grid"
        ? {
            backgroundColor: paperFill,
            backgroundImage: `repeating-linear-gradient(to right, ${paperLine} 0 1px, transparent 1px 11px), repeating-linear-gradient(to bottom, ${paperLine} 0 1px, transparent 1px 11px)`,
          }
        : pageStyle === "dot"
          ? {
              backgroundColor: paperFill,
              backgroundImage: `radial-gradient(circle, ${paperLine} 1px, transparent 1px)`,
              backgroundSize: "9px 9px",
            }
          : { backgroundColor: paperFill };

  return (
    <div
      className={cx(
        "group/notebook mx-auto flex h-full w-full max-w-[8.35rem] cursor-pointer flex-col items-center rounded-[1.05rem] border border-transparent bg-transparent px-2 py-2.5 text-center transition duration-200 hover:-translate-y-0.5 hover:border-[var(--color-border)] hover:bg-[var(--color-glass-subtle)] active:scale-[0.985]",
        compact ? "min-h-[9.6rem]" : "min-h-[10.9rem]",
      )}
    >
      <div className="flex items-center justify-center">
        <div className={cx("relative", compact ? "h-24 w-[5.45rem]" : "h-28 w-[6.1rem]")}>
          <div
            className="absolute left-3 top-1.5 h-[94%] w-[82%] rounded-[0.62rem] border border-slate-900/10"
            style={paperStyle}
            aria-hidden="true"
          />
          <div
            className="absolute left-2 top-2 h-[92%] w-[82%] rounded-[0.62rem] border border-slate-900/10 bg-white/80"
            aria-hidden="true"
          />
          <div
            className="absolute inset-y-0 left-0 h-full w-[82%] rounded-[0.66rem] border border-black/15 shadow-[0_9px_18px_rgba(15,23,42,0.18)] transition duration-200 group-hover/notebook:-rotate-[0.65deg]"
            style={{
              backgroundColor: preset.base,
            }}
          >
            <div className="absolute inset-y-0 left-0 w-3 rounded-l-[0.66rem] border-r border-black/15 bg-black/10" aria-hidden="true" />
            <div className="absolute inset-y-2 right-1.5 w-px bg-white/28" aria-hidden="true" />
            <ObjectIcon
              icon={icon}
              className="absolute left-[53%] top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 text-white/88"
            />
          </div>
        </div>
      </div>

      <div className="mt-3 w-full space-y-1">
        <div>
          <p className="line-clamp-2 text-sm font-semibold leading-5 text-[var(--color-text-primary)]" title={title}>{title}</p>
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
  const card = props.href ? (
    <Link
      href={props.href}
      prefetch={false}
      className={cx("block h-full", props.className)}
    >
      <NotebookCardInner {...props} />
    </Link>
  ) : props.onClick ? (
    <button type="button" onClick={props.onClick} className={cx("block h-full w-full", props.className)}>
      <NotebookCardInner {...props} />
    </button>
  ) : (
    <div className={cx("h-full", props.className)}>
      <NotebookCardInner {...props} />
    </div>
  );

  if (!props.onRename && !props.onArchive) return card;
  return (
    <div className="relative h-full">
      {card}
      <details className="group/actions absolute right-1 top-1 z-20">
        <summary
          aria-label={`Notebook actions for ${props.title}`}
          title="Notebook actions"
          className="grid h-8 w-8 cursor-pointer list-none place-items-center rounded-full border border-[var(--button-secondary-border)] bg-[var(--color-surface-panel-strong)] text-sm font-bold tracking-[0.08em] text-text-secondary shadow-sm transition hover:text-text-primary [&::-webkit-details-marker]:hidden"
        >
          ···
        </summary>
        <div className="absolute right-0 top-9 grid min-w-36 gap-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-panel-strong)] p-1.5 text-left shadow-[0_16px_38px_rgba(0,0,0,0.28)]">
          {props.onRename ? (
            <button
              type="button"
              className="rounded-lg px-3 py-2 text-left text-sm font-medium text-text-secondary transition hover:bg-[var(--color-glass-subtle)] hover:text-text-primary"
              onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                props.onRename?.();
              }}
            >
              Rename
            </button>
          ) : null}
          {props.onArchive ? (
            <button
              type="button"
              className="rounded-lg px-3 py-2 text-left text-sm font-medium text-danger-text transition hover:bg-error-muted"
              onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                props.onArchive?.();
              }}
            >
              Archive
            </button>
          ) : null}
        </div>
      </details>
    </div>
  );
}
