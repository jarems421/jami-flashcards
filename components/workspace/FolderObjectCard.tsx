import Link from "next/link";
import ObjectIcon from "./ObjectIcon";
import { getObjectColorPreset } from "./object-card-styles";

export type FolderObjectStat = {
  label: string;
  value: string | number;
};

type FolderObjectCardProps = {
  title: string;
  subtitle?: string;
  description?: string;
  color?: string | null;
  icon?: string | null;
  stats?: FolderObjectStat[];
  updatedLabel?: string;
  href?: string;
  onClick?: () => void;
  selected?: boolean;
  className?: string;
  compact?: boolean;
};

export default function FolderObjectCard({
  title,
  color,
  icon,
  href,
  onClick,
  selected = false,
  className = "",
  compact = false,
}: FolderObjectCardProps) {
  const preset = getObjectColorPreset(color);
  const content = (
    <div
      className={`group mx-auto flex h-full ${compact ? "min-h-[6.4rem] max-w-[5.8rem] px-1.5 py-2" : "min-h-[8.75rem] max-w-[7.25rem] px-2 py-2.5"} w-full cursor-pointer flex-col items-center rounded-[1.05rem] border text-center transition duration-fast active:scale-[0.985] ${
        selected
          ? "border-[var(--color-selected-border)] bg-[var(--color-selected-bg)] shadow-[0_14px_28px_rgba(6,8,18,0.16)]"
          : "border-transparent bg-transparent hover:-translate-y-0.5 hover:border-[var(--color-border)] hover:bg-[var(--color-glass-subtle)]"
      } ${className}`}
    >
      <div className={`relative mx-auto w-full ${compact ? "h-[4rem] max-w-[5rem]" : "h-[5.5rem] max-w-[6.7rem]"}`}>
        <div
          className={`absolute left-[13%] right-[10%] top-[13%] rounded-t-[0.62rem] border border-black/10 ${compact ? "h-[2rem]" : "h-[2.8rem]"}`}
          style={{
            backgroundColor: preset.paper,
          }}
        />
        <div
          className={`absolute left-[9%] top-[7%] w-[39%] rounded-t-[0.58rem] border border-black/10 ${compact ? "h-[1.15rem]" : "h-[1.55rem]"}`}
          style={{
            backgroundColor: preset.light,
          }}
        />
        <div
          className={`absolute inset-x-[3%] bottom-0 rounded-[0.68rem] border border-black/15 transition-transform duration-fast group-hover:-rotate-[0.35deg] ${compact ? "h-[2.9rem]" : "h-[4rem]"}`}
          style={{
            backgroundColor: preset.base,
            boxShadow: "0 8px 16px rgba(5, 8, 18, 0.22)",
          }}
        >
          <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center">
            <ObjectIcon icon={icon} className={`${compact ? "h-5 w-5" : "h-6 w-6"} text-white/88`} />
          </div>
        </div>
      </div>

      <div className={`${compact ? "mt-1" : "mt-2"} w-full min-w-0`}>
        <div className="truncate text-sm font-semibold text-[var(--color-text-primary)]" title={title}>
          {title}
        </div>
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block h-full">
        {content}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="block h-full w-full">
        {content}
      </button>
    );
  }

  return content;
}
