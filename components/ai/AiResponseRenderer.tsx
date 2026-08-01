"use client";

import type { AnchorHTMLAttributes, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import {
  normalizeLegacyJamiMathText,
  preprocessMathDelimiters,
} from "@/lib/study/math-text";

export type AiResponseRendererProps = {
  content: string;
  className?: string;
};

/**
 * Determine whether a URL is safe to render as a clickable link.
 * Only http: and https: (including protocol-relative and relative URLs that
 * resolve to http/https) are allowed. Dangerous schemes such as javascript:
 * are blocked.
 */
function isSafeUrl(href: string): boolean {
  try {
    const url = new URL(href, "http://example.com");
    const protocol = url.protocol.toLowerCase();
    return protocol === "http:" || protocol === "https:";
  } catch {
    // Invalid assistant-provided links are rendered as plain text.
    return false;
  }
}

function SafeLink({
  href,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>): ReactNode {
  if (!href || !isSafeUrl(href)) {
    return (
      <span
        className="cursor-not-allowed text-text-muted"
        tabIndex={-1}
        aria-disabled="true"
      >
        {children}
      </span>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="rounded-sm text-accent underline underline-offset-2 outline-color-transparent transition-colors hover:text-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
      {...props}
    >
      {children}
    </a>
  );
}

/**
 * Shared renderer for AI-generated responses.
 *
 * Renders Markdown (including GFM), inline/display math, and sanitises links.
 * Raw HTML from the model is never rendered; KaTeX is configured with trust
 * disabled. The component preserves Jami's existing \( ... \), \[ ... \],
 * $...$ and $$...$$ math delimiters.
 */
export default function AiResponseRenderer({
  content,
  className = "",
}: AiResponseRendererProps) {
  const normalizedContent = preprocessMathDelimiters(
    normalizeLegacyJamiMathText(content)
  );

  return (
    <div className={`ai-response ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          [rehypeKatex, { trust: false, strict: "ignore", throwOnError: false }],
        ]}
        components={{
          a: SafeLink,
        }}
      >
        {normalizedContent}
      </ReactMarkdown>
    </div>
  );
}
