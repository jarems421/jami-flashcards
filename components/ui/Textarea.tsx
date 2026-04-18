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
        className={`w-full rounded-[1.5rem] border-[1.5px] border-white/[0.12] bg-surface-panel-strong px-5 py-4 text-sm text-white placeholder:text-text-muted shadow-[0_10px_22px_rgba(8,2,24,0.18)] outline-none transition duration-fast hover:border-white/[0.18] focus:border-warm-accent/80 focus:ring-4 focus:ring-accent/14 ${className}`}
        {...props}
      />
    </div>
  );
}
