"use client";

import { useEffect } from "react";

/**
 * The last resort, for an error in the root layout itself, which app/error.tsx
 * sits inside and so cannot catch.
 *
 * It replaces the whole document, so it brings its own <html> and <body>, and
 * none of the app's stylesheet, fonts or theme reach it. It keeps to the
 * system's own colours, light or dark, rather than depend on anything that may
 * be what failed.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("Root error boundary caught an error", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "1.5rem",
          boxSizing: "border-box",
          colorScheme: "light dark",
          background: "Canvas",
          color: "CanvasText",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <title>Something went wrong · Jami</title>
        <main style={{ maxWidth: "26rem" }}>
          <h1 style={{ margin: 0, fontSize: "1.25rem" }}>Something went wrong</h1>
          <p style={{ margin: "0.5rem 0 1rem", lineHeight: 1.5, opacity: 0.8 }}>
            Jami hit an unexpected error while opening. Try again, or reload the page.
          </p>
          <button type="button" onClick={() => retry()} style={{ font: "inherit", padding: "0.5rem 1rem" }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
