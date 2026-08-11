import { forwardRef, type SelectHTMLAttributes, useId } from "react";

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  containerClassName?: string;
};

/**
 * A dropdown that matches the rest of the fields.
 *
 * Every select in the app was being hand-built from a bare `<select>` and
 * whatever padding the page happened to reach for, so a form's dropdown never
 * quite lined up with the text field beside it. Sharing `Input`'s shape and
 * label puts them on the same line and the same height.
 *
 * The chevron is drawn here rather than left to the platform, because the
 * native one is drawn in the operating system's colour and disappears on the
 * darker themes.
 */
const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, className = "", containerClassName = "", id, children, ...props },
  ref
) {
  const autoId = useId();
  const selectId = id ?? autoId;

  return (
    <div className={containerClassName}>
      {label ? (
        <label
          htmlFor={selectId}
          className="mb-2 block text-sm font-medium tracking-[0.01em] text-text-secondary"
        >
          {label}
        </label>
      ) : null}
      <div className="relative">
        <select
          id={selectId}
          ref={ref}
          className={`app-field w-full appearance-none rounded-2xl py-[1rem] pl-5 pr-11 text-sm outline-none transition duration-fast ${className}`}
          {...props}
        >
          {children}
        </select>
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          fill="none"
          className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
        >
          <path
            d="m4 6.5 4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
});

export default Select;
