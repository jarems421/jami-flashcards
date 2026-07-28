"use client";

import { Suspense, lazy } from "react";

/**
 * react-markdown pulls in the whole unified/remark/rehype stack plus KaTeX,
 * which is the largest client dependency in the app. The AI drawers are the
 * only surfaces that need it, and a student may never open one, so it is split
 * into its own chunk and fetched on first use.
 *
 * React.lazy rather than next/dynamic because next/dynamic owns its Suspense
 * boundary and its `loading` component cannot receive props. Here the fallback
 * needs the message text so it can show the reply as plain text instead of
 * flashing blank while the chunk arrives.
 */
const AiResponseRenderer = lazy(() => import("@/components/ai/AiResponseRenderer"));

export type AiResponseProps = {
  content: string;
  className?: string;
};

export default function AiResponse({ content, className = "" }: AiResponseProps) {
  return (
    <Suspense
      fallback={
        <div className={`ai-response whitespace-pre-wrap ${className}`}>{content}</div>
      }
    >
      <AiResponseRenderer content={content} className={className} />
    </Suspense>
  );
}
