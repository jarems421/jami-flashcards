"use client";

import AiResponseRenderer from "@/components/ai/AiResponseRenderer";

type JamiResponseTextProps = {
  text: string;
  className?: string;
};

/**
 * Backwards-compatible wrapper around AiResponseRenderer.
 *
 * @deprecated Prefer using AiResponseRenderer directly for new surfaces.
 */
export default function JamiResponseText({
  text,
  className = "",
}: JamiResponseTextProps) {
  return <AiResponseRenderer content={text} className={className} />;
}

