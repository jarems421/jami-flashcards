import { type ButtonHTMLAttributes } from "react";

type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "surface"
  | "danger"
  | "warm";
type ButtonSize = "sm" | "md" | "lg" | "icon";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "border border-[var(--button-primary-border)] bg-[var(--button-primary-bg)] text-[var(--button-primary-text)] shadow-[var(--button-primary-shadow)] hover:-translate-y-[1px] hover:border-[var(--button-primary-border-hover)] hover:bg-[var(--button-primary-bg-hover)] hover:shadow-[var(--button-primary-shadow-hover)] active:translate-y-0 active:scale-[0.98] disabled:opacity-50",
  secondary:
    "border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] text-[var(--button-secondary-text)] shadow-[var(--button-secondary-shadow)] hover:-translate-y-[1px] hover:border-[var(--button-secondary-border-hover)] hover:bg-[var(--button-secondary-bg-hover)] hover:shadow-[var(--button-secondary-shadow-hover)] active:translate-y-0 active:scale-[0.98] disabled:opacity-50",
  ghost:
    "border border-transparent bg-transparent text-text-secondary hover:bg-[var(--button-ghost-bg-hover)] hover:text-text-primary active:scale-[0.98] disabled:opacity-50",
  surface:
    "border border-[var(--button-surface-border)] bg-[var(--button-surface-bg)] text-[var(--button-surface-text)] shadow-[var(--shadow-shell)] hover:-translate-y-[1px] hover:border-[var(--button-surface-border-hover)] hover:bg-[var(--button-surface-bg-hover)] hover:shadow-[var(--button-surface-shadow-hover)] active:translate-y-0 active:scale-[0.98] disabled:opacity-50",
  danger:
    "border border-transparent bg-error text-white shadow-[0_16px_30px_rgba(255,120,183,0.24)] hover:-translate-y-[1px] hover:brightness-110 active:translate-y-0 active:scale-[0.98] disabled:opacity-50",
  warm:
    "border border-[var(--button-warm-border)] bg-[var(--button-warm-bg)] text-[var(--button-warm-text)] shadow-[var(--button-warm-shadow)] hover:-translate-y-[1px] hover:border-[var(--button-warm-border-hover)] hover:bg-[var(--button-warm-bg-hover)] hover:shadow-[var(--button-warm-shadow-hover)] active:translate-y-0 active:scale-[0.98] disabled:opacity-50",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "min-h-[2.25rem] px-3 py-1 text-sm",
  md: "min-h-[2.75rem] px-4 py-2 text-sm",
  lg: "min-h-[3.25rem] px-5 py-3 text-base",
  icon: "h-10 w-10 justify-center p-0",
};

export default function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`relative inline-flex items-center justify-center overflow-hidden rounded-[2rem] font-medium tracking-[0.01em] transition duration-fast ease-spring ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
