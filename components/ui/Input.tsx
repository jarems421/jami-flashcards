import { type InputHTMLAttributes, useId } from "react";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  containerClassName?: string;
};

export default function Input({
  label,
  className = "",
  containerClassName = "",
  id,
  ...props
}: InputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;

  return (
    <div className={containerClassName}>
      {label ? (
        <label
          htmlFor={inputId}
          className="mb-2 block text-sm font-medium tracking-[0.01em] text-text-secondary"
        >
          {label}
        </label>
      ) : null}
      <input
        id={inputId}
        className={`w-full rounded-[2rem] border-[1.5px] border-white/[0.14] bg-surface-panel-strong px-5 py-[1rem] text-sm text-white placeholder:text-text-muted shadow-[0_14px_28px_rgba(8,2,24,0.28)] outline-none transition duration-fast hover:border-white/[0.20] focus:border-warm-accent focus:ring-4 focus:ring-accent/18 focus:shadow-[0_18px_36px_rgba(183,124,255,0.2)] ${className}`}
        {...props}
      />
    </div>
  );
}
