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
  pageStyle?: string;
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
  pageColor,
  pageStyle,
  pageCount,
  updatedLabel,
  compact,
}: NotebookObjectCardProps) {
  const preset = getObjectColorPreset(color);
  const safeColor = normalizeObjectColor(color);
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
        "group/notebook mx-auto flex h-full w-full max-w-[8.35rem] flex-col items-center rounded-[1.05rem] border border-transparent bg-transparent px-2 py-2.5 text-center transition duration-200 hover:-translate-y-0.5 hover:border-[var(--color-border)] hover:bg-[var(--color-glass-subtle)]",
        compact ? "min-h-[9.6rem]" : "min-h-[10.9rem]",
      )}
    >
      <div className="flex items-center justify-center">
        <div className={cx("relative", compact ? "h-24 w-[5.45rem]" : "h-28 w-[6.1rem]")}>
          <div
            className="absolute left-3 top-2 h-[92%] w-[84%] rounded-[0.85rem] shadow-[0_8px_14px_rgba(15,23,42,0.16)]"
            style={paperStyle}
            aria-hidden="true"
          />
          <div
            className="absolute left-2 top-1.5 h-[92%] w-[84%] rounded-[0.85rem] border border-slate-900/10 shadow-[0_5px_0_rgba(15,23,42,0.08)]"
            style={paperStyle}
            aria-hidden="true"
          />
          <div
            className="absolute inset-y-0 left-0 top-0 h-full w-[84%] rounded-[0.85rem] border border-white/45 shadow-[0_10px_18px_rgba(15,23,42,0.2)] transition duration-200 group-hover/notebook:-rotate-1"
            style={{
              background: `linear-gradient(145deg, ${preset.light}, ${preset.base} 52%, ${preset.dark})`,
            }}
          >
            <div className="absolute inset-y-3 right-1.5 w-1.5 rounded-full bg-white/22" aria-hidden="true" />
            <div className="absolute inset-y-0 left-0 w-4 rounded-l-[0.85rem] bg-black/12" aria-hidden="true" />
            <div className="absolute -left-1.5 top-3 flex h-[74%] flex-col justify-between" aria-hidden="true">
              {Array.from({ length: compact ? 5 : 6 }).map((_, index) => (
                <span
                  key={`${safeColor}-ring-${index}`}
                  className="block h-2 w-3.5 rounded-full border-[1.5px] border-slate-900/55 bg-white/65 shadow-[0_1px_0_rgba(255,255,255,0.5)]"
                />
              ))}
            </div>
            <ObjectIcon
              icon={icon}
              className="absolute left-[50%] top-[50%] h-6 w-6 -translate-x-[42%] -translate-y-1/2 text-white/78 drop-shadow-[0_1px_1px_rgba(0,0,0,0.25)]"
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
