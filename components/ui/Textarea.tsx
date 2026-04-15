import { type TextareaHTMLAttributes, useId } from "react";

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
  containerClassName?: string;
};

export default function Textarea({
  label,
  className = "",
  containerClassName = "",
  id,
  rows = 6,
  ...props
}: TextareaProps) {
  const autoId = useId();
  const textareaId = id ?? autoId;

  return (
    <div className={containerClassName}>
      {label ? (
        <label
          htmlFor={textareaId}
          className="mb-2 block text-sm font-medium tracking-[0.01em] text-text-secondary"
        >
          {label}
        </label>
      ) : null}
      <textarea
        id={textareaId}
        rows={rows}
        className={`w-full rounded-[1.5rem] border-[1.5px] border-white/[0.14] bg-surface-panel-strong px-5 py-4 text-sm text-white placeholder:text-text-muted shadow-[0_14px_28px_rgba(8,2,24,0.28)] outline-none transition duration-fast hover:border-white/[0.20] focus:border-warm-accent focus:ring-4 focus:ring-accent/18 focus:shadow-[0_18px_36px_rgba(183,124,255,0.2)] ${className}`}
        {...props}
      />
    </div>
  );
}
