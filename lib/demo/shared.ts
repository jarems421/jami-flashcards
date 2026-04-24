export type DemoViewerMode = "private" | "demo-readonly" | "demo-test";

export const DEMO_RESET_COPY = "Shared demo data resets every hour.";
export const DEMO_ACCOUNT_COPY =
  "You're in the shared Jami demo. Study progress is allowed, but editing, profile changes, and notifications are disabled.";

export function isDemoViewerMode(value: string | null | undefined): value is DemoViewerMode {
  return value === "private" || value === "demo-readonly" || value === "demo-test";
}
