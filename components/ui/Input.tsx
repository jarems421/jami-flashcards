import { forwardRef, type InputHTMLAttributes, useId } from "react";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  containerClassName?: string;
};

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    className = "",
    containerClassName = "",
    id,
    ...props
  },
  ref
) {
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
        ref={ref}
        className={`w-full rounded-[1.6rem] border-[1.5px] border-white/[0.12] bg-surface-panel-strong px-5 py-[1rem] text-sm text-white placeholder:text-text-muted shadow-[0_10px_22px_rgba(8,2,24,0.18)] outline-none transition duration-fast hover:border-white/[0.18] focus:border-warm-accent/80 focus:ring-4 focus:ring-accent/14 ${className}`}
        {...props}
      />
    </div>
  );
});

export default Input;
