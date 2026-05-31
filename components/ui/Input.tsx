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
        className={`app-field w-full rounded-[1.6rem] px-5 py-[1rem] text-sm outline-none transition duration-fast ${className}`}
        {...props}
      />
    </div>
  );
});

export default Input;
