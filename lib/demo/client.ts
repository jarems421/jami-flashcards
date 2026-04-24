export function isDemoModeEnabledClient() {
  return process.env.NEXT_PUBLIC_DEMO_MODE_ENABLED === "true";
}
