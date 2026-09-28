"use client";

import { useId, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Input } from "@/components/ui";

type PasswordFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: string;
  /** Sits at the end of the label row, such as a "Forgot password?" link. */
  labelAction?: ReactNode;
};

/**
 * A password input with its label row and a Show / Hide toggle.
 *
 * The toggle is named by its visible word and nothing else. Anything carrying
 * "password" in an `aria-label` would be a second match for a lookup by the
 * field's own label, which is how both assistive tech and the browser tests
 * find this input.
 */
export default function PasswordField({
  label,
  labelAction,
  id,
  ...props
}: PasswordFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const [visible, setVisible] = useState(false);

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <label
          htmlFor={inputId}
          className="block text-sm font-medium tracking-[0.01em] text-text-secondary"
        >
          {label}
        </label>
        {labelAction}
      </div>
      <div className="relative">
        <Input
          {...props}
          id={inputId}
          type={visible ? "text" : "password"}
          className="pr-20"
        />
        <button
          type="button"
          aria-controls={inputId}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-sm px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-text-muted transition duration-fast hover:bg-[var(--button-ghost-bg-hover)] hover:text-text-primary"
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
    </div>
  );
}
