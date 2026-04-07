type ProgressBarSize = "sm" | "md";
type ProgressBarVariant = "accent" | "warm";

type ProgressBarProps = {
  progress: number;
  size?: ProgressBarSize;
  variant?: ProgressBarVariant;
  className?: string;
};

const sizeClasses: Record<ProgressBarSize, string> = {
  sm: "h-[6px]",
  md: "h-[10px]",
};

const fillClasses: Record<ProgressBarVariant, string> = {
  accent:
    "bg-gradient-to-r from-accent via-warm-accent to-success",
  warm:
    "bg-gradient-to-r from-warm-accent to-success",
};

export default function ProgressBar({
  progress,
  size = "md",
  variant = "accent",
  className = "",
}: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, progress));

  return (
    <div
      className={`rounded-full bg-glass-medium shadow-[inset_0_2px_4px_rgba(0,0,0,0.2)] ${sizeClasses[size]} ${className}`}
    >
      <div
        className={`rounded-full transition-all duration-slow ${sizeClasses[size]} ${fillClasses[variant]}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
