import { forwardRef, type ButtonHTMLAttributes } from "react";

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
  primary: "app-button-primary active:translate-y-0 active:scale-[0.98]",
  secondary: "app-button-secondary active:translate-y-0 active:scale-[0.98]",
  ghost: "app-button-ghost active:scale-[0.98]",
  surface:
    "border border-[var(--button-surface-border)] bg-[var(--button-surface-bg)] text-[var(--button-surface-text)] shadow-[var(--shadow-shell)] hover:-translate-y-[1px] hover:border-[var(--button-surface-border-hover)] hover:bg-[var(--button-surface-bg-hover)] hover:shadow-[var(--button-surface-shadow-hover)] active:translate-y-0 active:scale-[0.98]",
  danger:
    "border border-transparent bg-error text-[var(--color-text-inverse)] shadow-[0_16px_30px_rgba(255,120,183,0.24)] hover:-translate-y-[1px] hover:brightness-110 active:translate-y-0 active:scale-[0.98]",
  warm: "app-button-warm active:translate-y-0 active:scale-[0.98]",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "min-h-[2.25rem] px-3 py-1 text-sm",
  md: "min-h-[2.75rem] px-4 py-2 text-sm",
  lg: "min-h-[3.25rem] px-5 py-3 text-base",
  icon: "h-10 w-10 justify-center p-0",
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    className = "",
    children,
    ...props
  },
  ref
) {
  return (
    <button
      ref={ref}
      className={`relative inline-flex items-center justify-center overflow-hidden rounded-[2rem] font-medium tracking-[0.01em] transition duration-fast ease-spring disabled:cursor-not-allowed disabled:!border-[var(--button-disabled-border)] disabled:!bg-[var(--button-disabled-bg)] disabled:!text-[var(--button-disabled-text)] disabled:!shadow-none disabled:saturate-[0.82] ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
});

export default Button;
