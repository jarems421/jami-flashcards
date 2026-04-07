import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-white">
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p className="text-sm text-text-secondary">The page you requested does not exist.</p>
      <Link
        href="/"
        className="rounded-xl bg-glass-medium px-4 py-2 text-sm transition duration-fast hover:bg-glass-strong"
      >
        Back to home
      </Link>
    </main>
  );
}
