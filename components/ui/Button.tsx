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
    "border border-white/20 bg-[linear-gradient(180deg,#ffc7ea_0%,#f2b5ff_38%,#b7a2ff_100%)] text-white shadow-[0_14px_26px_rgba(175,150,255,0.22)] hover:-translate-y-[1px] hover:brightness-105 hover:shadow-[0_18px_32px_rgba(175,150,255,0.28)] active:translate-y-0 active:scale-[0.98] disabled:opacity-50",
  secondary:
    "border border-white/14 bg-[linear-gradient(180deg,rgba(255,255,255,0.14),rgba(255,255,255,0.07))] text-white shadow-[0_10px_20px_rgba(11,4,32,0.12)] hover:-translate-y-[1px] hover:border-white/22 hover:bg-[linear-gradient(180deg,rgba(255,255,255,0.20),rgba(255,255,255,0.09))] hover:shadow-[0_14px_26px_rgba(11,4,32,0.18)] active:translate-y-0 active:scale-[0.98] disabled:opacity-50",
  ghost:
    "border border-transparent bg-transparent text-text-muted hover:bg-white/[0.08] hover:text-white active:scale-[0.98] disabled:opacity-50",
  surface:
    "border border-white/14 bg-[linear-gradient(180deg,rgba(31,21,56,0.92),rgba(22,14,40,0.92))] text-white shadow-[var(--shadow-shell)] hover:-translate-y-[1px] hover:border-white/18 hover:bg-[linear-gradient(180deg,rgba(37,25,66,0.95),rgba(26,18,48,0.95))] hover:shadow-[0_20px_38px_rgba(8,2,26,0.34)] active:translate-y-0 active:scale-[0.98] disabled:opacity-50",
  danger:
    "border border-transparent bg-error text-white shadow-[0_16px_30px_rgba(255,120,183,0.24)] hover:-translate-y-[1px] hover:brightness-110 active:translate-y-0 active:scale-[0.98] disabled:opacity-50",
  warm:
    "border border-white/24 bg-[linear-gradient(180deg,#fff8fd_0%,#ffe8f7_42%,#ffdff4_100%)] text-[#10091d] shadow-[0_12px_24px_rgba(255,214,246,0.18)] hover:-translate-y-[1px] hover:brightness-105 hover:shadow-[0_16px_30px_rgba(255,214,246,0.24)] active:translate-y-0 active:scale-[0.98] disabled:opacity-50",
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
