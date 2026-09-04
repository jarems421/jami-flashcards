"use client";

import {
  forwardRef,
  useCallback,
  useId,
  useRef,
  type InputHTMLAttributes,
} from "react";
import SymbolKeyboard from "@/components/ui/SymbolKeyboard";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  containerClassName?: string;
  /**
   * Offer the symbol palette in the corner of this field.
   *
   * Opt-in rather than automatic: a name or a deck title has no use for one,
   * and a control that appears on every field in the product stops being
   * noticed on the fields that need it.
   */
  symbols?: boolean;
};

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    className = "",
    containerClassName = "",
    id,
    symbols = false,
    ...props
  },
  ref
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const fieldRef = useRef<HTMLInputElement>(null);

  // The palette needs the node, and so may whoever rendered this.
  const attachRef = useCallback(
    (node: HTMLInputElement | null) => {
      fieldRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref]
  );

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
      <div className="relative">
        <input
          id={inputId}
          ref={attachRef}
          className={`app-field w-full rounded-2xl px-5 py-[1rem] text-sm outline-none transition duration-fast ${
            symbols ? "pr-14" : ""
          } ${className}`}
          {...props}
        />
        {symbols ? (
          <SymbolKeyboard
            targetRef={fieldRef}
            className="absolute right-3 top-1/2 -translate-y-1/2"
          />
        ) : null}
      </div>
    </div>
  );
});

export default Input;
