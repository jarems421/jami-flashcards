import { type InputHTMLAttributes } from "react";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
};

export default function Input({ label, className = "", id, ...props }: InputProps) {
  return (
    <div>
      {label ? (
        <label htmlFor={id} className="mb-1 block text-sm text-text-secondary">
          {label}
        </label>
      ) : null}
      <input
        id={id}
        className={`w-full rounded-md border border-border bg-glass-medium px-3 py-2 text-sm text-white placeholder:text-text-muted outline-none transition duration-fast focus:border-accent ${className}`}
        {...props}
      />
    </div>
  );
}
