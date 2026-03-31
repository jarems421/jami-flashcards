"use client";

import { useEffect } from "react";

type AppErrorProps = {
  error: Error & { digest?: string };
  unstable_retry: () => void;
};

export default function AppError({ error, unstable_retry }: AppErrorProps) {
  useEffect(() => {
    console.error("Application error boundary caught an error", error);
  }, [error]);

  return (
    <main
      className="flex min-h-screen items-center justify-center px-6"
      data-app-surface="true"
    >
      <section className="w-full max-w-md rounded-xl border border-border bg-glass-subtle p-6 text-white shadow-glass backdrop-blur-md">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-text-secondary">
          We hit an unexpected error while loading this view.
        </p>
        <button
          type="button"
          onClick={unstable_retry}
          className="mt-4 rounded-md bg-white px-4 py-2 text-sm font-medium text-black transition duration-fast hover:bg-gray-200"
        >
          Try again
        </button>
      </section>
    </main>
  );
}
