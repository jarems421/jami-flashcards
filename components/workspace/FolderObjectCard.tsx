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
  subtitle,
  description,
  color,
  icon,
  stats = [],
  updatedLabel,
  href,
  onClick,
  selected = false,
  className = "",
}: FolderObjectCardProps) {
  const preset = getObjectColorPreset(color);
  const content = (
    <div
      className={`group flex h-full min-h-[15rem] flex-col rounded-[1.7rem] border p-4 text-left transition duration-fast hover:-translate-y-1 ${
        selected
          ? "border-warm-border bg-warm-glow shadow-[0_24px_54px_rgba(6,8,18,0.22)]"
          : "border-[var(--color-border)] bg-[var(--color-glass-subtle)] shadow-[var(--shadow-card)] hover:border-warm-border hover:bg-[var(--color-glass-medium)]"
      } ${className}`}
    >
      <div className="relative mx-auto mt-1 h-[8.1rem] w-full max-w-[15rem]">
        <div
          className="absolute left-[11%] right-[9%] top-[9%] h-[3.4rem] rounded-t-[1rem] border border-black/10"
          style={{
            background: `linear-gradient(180deg, ${preset.paper}, rgba(255,255,255,0.72))`,
            boxShadow: "0 10px 18px rgba(0,0,0,0.12)",
          }}
        />
        <div
          className="absolute left-[6%] right-[5%] top-[18%] h-[3.2rem] rounded-t-[1rem] border border-black/10"
          style={{
            background: `linear-gradient(180deg, rgba(255,255,255,0.86), ${preset.light})`,
          }}
        />
        <div
          className="absolute left-[9%] top-[3%] h-[2.1rem] w-[42%] rounded-t-[1.1rem] border border-black/10"
          style={{
            background: `linear-gradient(180deg, ${preset.light}, ${preset.base})`,
          }}
        />
        <div
          className="absolute inset-x-[1%] bottom-0 h-[6.25rem] rounded-[1.05rem] border border-black/10"
          style={{
            background: `linear-gradient(145deg, ${preset.light} 0%, ${preset.base} 52%, ${preset.dark} 100%)`,
            boxShadow: `0 18px 34px ${preset.shadow}, inset 0 1px 0 rgba(255,255,255,0.44), inset 0 -16px 28px rgba(0,0,0,0.08)`,
          }}
        >
          <div
            className="absolute inset-x-0 top-0 h-5 rounded-t-[1.05rem]"
            style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.28), transparent)" }}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-[1.15rem] border border-white/25 bg-white/18 text-white/86 shadow-[inset_0_1px_0_rgba(255,255,255,0.32)]">
              <ObjectIcon icon={icon} className="h-8 w-8" />
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-1 flex-col">
        <div className="min-w-0">
          <div className="truncate text-lg font-semibold text-[var(--color-text-primary)]">{title}</div>
          {subtitle ? <div className="mt-1 text-xs font-medium text-[var(--color-text-muted)]">{subtitle}</div> : null}
        </div>
        {description ? (
          <p className="mt-3 line-clamp-2 text-sm leading-6 text-[var(--color-text-secondary)]">{description}</p>
        ) : null}
        <div className="mt-auto pt-4">
          {stats.length > 0 ? (
            <div className="grid grid-cols-3 gap-2">
              {stats.slice(0, 3).map((stat) => (
                <div key={stat.label} className="rounded-[0.9rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-2.5 py-2">
                  <div className="truncate text-[0.6rem] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-muted)]">{stat.label}</div>
                  <div className="mt-1 truncate text-sm font-semibold text-[var(--color-text-primary)]">{stat.value}</div>
                </div>
              ))}
            </div>
          ) : null}
          {updatedLabel ? <div className="mt-3 text-xs text-[var(--color-text-muted)]">{updatedLabel}</div> : null}
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
