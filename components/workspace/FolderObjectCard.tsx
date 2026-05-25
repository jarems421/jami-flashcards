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
      className={`group flex h-full min-h-[10rem] flex-col items-center rounded-[1.35rem] border px-3 py-3 text-center transition duration-fast hover:-translate-y-0.5 ${
        selected
          ? "border-warm-border bg-warm-glow shadow-[0_18px_34px_rgba(6,8,18,0.18)]"
          : "border-transparent bg-transparent hover:border-[var(--color-border)] hover:bg-[var(--color-glass-subtle)]"
      } ${className}`}
    >
      <div className="relative mx-auto h-[6.15rem] w-full max-w-[10.75rem]">
        <div
          className="absolute left-[12%] right-[10%] top-[10%] h-[2.55rem] rounded-t-[0.85rem] border border-black/10"
          style={{
            background: `linear-gradient(180deg, ${preset.paper}, rgba(255,255,255,0.72))`,
            boxShadow: "0 7px 14px rgba(0,0,0,0.1)",
          }}
        />
        <div
          className="absolute left-[6%] right-[5%] top-[20%] h-[2.35rem] rounded-t-[0.85rem] border border-black/10"
          style={{
            background: `linear-gradient(180deg, rgba(255,255,255,0.86), ${preset.light})`,
          }}
        />
        <div
          className="absolute left-[9%] top-[4%] h-[1.55rem] w-[42%] rounded-t-[0.9rem] border border-black/10"
          style={{
            background: `linear-gradient(180deg, ${preset.light}, ${preset.base})`,
          }}
        />
        <div
          className="absolute inset-x-[1%] bottom-0 h-[4.65rem] rounded-[0.9rem] border border-black/10"
          style={{
            background: `linear-gradient(145deg, ${preset.light} 0%, ${preset.base} 52%, ${preset.dark} 100%)`,
            boxShadow: `0 12px 22px ${preset.shadow}, inset 0 1px 0 rgba(255,255,255,0.42), inset 0 -12px 20px rgba(0,0,0,0.08)`,
          }}
        >
          <div
            className="absolute inset-x-0 top-0 h-4 rounded-t-[0.9rem]"
            style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.28), transparent)" }}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex h-9 w-9 items-center justify-center rounded-[0.8rem] border border-white/22 bg-white/16 text-white/82 shadow-[inset_0_1px_0_rgba(255,255,255,0.28)]">
              <ObjectIcon icon={icon} className="h-5 w-5" />
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 min-w-0">
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
