import { forwardRef, type TextareaHTMLAttributes, useId } from "react";

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
  containerClassName?: string;
};

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({
  label,
  className = "",
  containerClassName = "",
  id,
  rows = 6,
  ...props
}, ref) {
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
        ref={ref}
        id={textareaId}
        rows={rows}
        className={`app-field w-full rounded-[1.5rem] px-5 py-4 text-sm outline-none transition duration-fast ${className}`}
        {...props}
      />
    </div>
  );
});

export default Textarea;
