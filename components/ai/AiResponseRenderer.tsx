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
import { sanitizeSvgDiagram } from "@/lib/practice/svg-diagram";

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
 * A figure the tutor drew.
 *
 * The tutor could already ask for a picture, and an image model is the wrong
 * one for anything a student has to read a value off: it returns a convincing
 * triangle whose marked 47 degrees measures sixty. That matters more here than
 * on a paper, because a student answering a paper is being tested and a student
 * reading the tutor is being taught.
 *
 * It arrives as a fenced `svg` block rather than raw markup, so this renderer
 * keeps the property its own comment claims: no HTML from the model is ever
 * rendered. What reaches the page is rebuilt by the sanitiser from an element
 * and attribute allowlist, and anything that does not survive is shown as the
 * code it was, which is ugly and honest.
 */
function DrawnFigure({ source }: { source: string }) {
  const drawn = sanitizeSvgDiagram(source);
  if (!drawn.ok) {
    return (
      <pre className="overflow-x-auto rounded-lg bg-[var(--color-glass-subtle)] p-3 text-xs text-text-muted">
        <code>{source}</code>
      </pre>
    );
  }
  return (
    <div
      role="img"
      className="my-3 overflow-x-auto rounded-lg bg-[var(--color-surface-page)] p-3 [&>svg]:mx-auto [&>svg]:h-auto [&>svg]:max-w-full"
      // Rebuilt above from an allowlist: no script, foreignObject, href or
      // event handler survives it.
      dangerouslySetInnerHTML={{ __html: drawn.svg }}
    />
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
          /*
           * Intercepted at the pre, not the code inside it: a figure returned
           * from the code component would be nested in the pre markdown puts
           * around it, inheriting its whitespace styling and putting flow
           * content where phrasing content belongs.
           */
          // `node` is react-markdown's own AST handle. Spreading it onto the
          // element renders node="[object Object]" into the markup of every
          // ordinary code block, so it is dropped rather than forwarded.
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          pre({ children, node, ...props }) {
            const child = Array.isArray(children) ? children[0] : children;
            const fenced = child as { props?: { className?: string; children?: unknown } } | undefined;
            if (/language-svg/.test(String(fenced?.props?.className ?? ""))) {
              return <DrawnFigure source={String(fenced?.props?.children ?? "").trim()} />;
            }
            return <pre {...props}>{children}</pre>;
          },
        }}
      >
        {normalizedContent}
      </ReactMarkdown>
    </div>
  );
}
