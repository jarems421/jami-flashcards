"use client";

import {
  forwardRef,
  useCallback,
  useId,
  useRef,
  type TextareaHTMLAttributes,
} from "react";
import SymbolKeyboard from "@/components/ui/SymbolKeyboard";

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
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

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({
  label,
  className = "",
  containerClassName = "",
  id,
  rows = 6,
  symbols = false,
  ...props
}, ref) {
  const autoId = useId();
  const textareaId = id ?? autoId;
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  // The palette needs the node, and so may whoever rendered this.
  const attachRef = useCallback(
    (node: HTMLTextAreaElement | null) => {
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
          htmlFor={textareaId}
          className="mb-2 block text-sm font-medium tracking-[0.01em] text-text-secondary"
        >
          {label}
        </label>
      ) : null}
      <div className="relative">
        <textarea
          ref={attachRef}
          id={textareaId}
          rows={rows}
          className={`app-field w-full rounded-xl px-5 py-4 text-sm outline-none transition duration-fast ${
            symbols ? "pb-12" : ""
          } ${className}`}
          {...props}
        />
        {symbols ? (
          // Bottom right, where a paragraph is least likely to reach.
          <SymbolKeyboard targetRef={fieldRef} className="absolute bottom-3 right-3" />
        ) : null}
      </div>
    </div>
  );
});

export default Textarea;
