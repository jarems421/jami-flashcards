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
};

export default function FolderObjectCard({
  title,
  color,
  icon,
  href,
  onClick,
  selected = false,
  className = "",
}: FolderObjectCardProps) {
  const preset = getObjectColorPreset(color);
  const content = (
    <div
      className={`group mx-auto flex h-full min-h-[8.6rem] w-full max-w-[9.5rem] flex-col items-center rounded-[1.1rem] border px-2 py-2.5 text-center transition duration-fast hover:-translate-y-0.5 ${
        selected
          ? "border-warm-border bg-warm-glow shadow-[0_18px_34px_rgba(6,8,18,0.18)]"
          : "border-transparent bg-transparent hover:border-[var(--color-border)] hover:bg-[var(--color-glass-subtle)]"
      } ${className}`}
    >
      <div className="relative mx-auto h-[5.15rem] w-full max-w-[8.35rem]">
        <div
          className="absolute left-[13%] right-[11%] top-[11%] h-[2.05rem] rounded-t-[0.7rem] border border-black/10"
          style={{
            background: `linear-gradient(180deg, ${preset.paper}, rgba(255,255,255,0.72))`,
            boxShadow: "0 7px 14px rgba(0,0,0,0.1)",
          }}
        />
        <div
          className="absolute left-[7%] right-[6%] top-[22%] h-[1.85rem] rounded-t-[0.7rem] border border-black/10"
          style={{
            background: `linear-gradient(180deg, rgba(255,255,255,0.86), ${preset.light})`,
          }}
        />
        <div
          className="absolute left-[10%] top-[5%] h-[1.22rem] w-[38%] rounded-t-[0.75rem] border border-black/10"
          style={{
            background: `linear-gradient(180deg, ${preset.light}, ${preset.base})`,
          }}
        />
        <div
          className="absolute inset-x-[2%] bottom-0 h-[3.75rem] rounded-[0.72rem] border border-black/10"
          style={{
            background: `linear-gradient(145deg, ${preset.light} 0%, ${preset.base} 52%, ${preset.dark} 100%)`,
            boxShadow: `0 10px 18px ${preset.shadow}, inset 0 1px 0 rgba(255,255,255,0.42), inset 0 -10px 16px rgba(0,0,0,0.08)`,
          }}
        >
          <div
            className="absolute inset-x-0 top-0 h-3 rounded-t-[0.72rem]"
            style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.28), transparent)" }}
          />
          <div className="absolute inset-x-0 top-[46%] flex -translate-y-1/2 justify-center">
            <ObjectIcon icon={icon} className="h-6 w-6 text-white/74 drop-shadow-[0_1px_1px_rgba(0,0,0,0.25)]" />
          </div>
        </div>
      </div>

      <div className="mt-2 min-w-0">
        <div className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{title}</div>
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
