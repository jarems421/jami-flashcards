import "server-only";

function isEnabledFlag(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

export function isDemoModeEnabledServer() {
  return (
    isEnabledFlag(process.env.DEMO_MODE_ENABLED) ||
    isEnabledFlag(process.env.NEXT_PUBLIC_DEMO_MODE_ENABLED)
  );
}

export function getDemoUserId() {
  return process.env.DEMO_USER_ID?.trim() ?? "";
}

export function requireDemoUserId() {
  const demoUserId = getDemoUserId();
  if (!demoUserId) {
    throw new Error("Missing DEMO_USER_ID.");
  }

  return demoUserId;
}

export function getAcceptedDemoResetSecrets() {
  return [
    process.env.DEMO_RESET_SECRET?.trim() ?? "",
    process.env.CRON_SECRET?.trim() ?? "",
  ].filter(Boolean);
}

export function isDemoResetAuthorized(authorizationHeader: string | null) {
  const match = authorizationHeader?.match(/^Bearer\s+(\S+)$/);
  if (!match) {
    return false;
  }

  const provided = match[1];
  return getAcceptedDemoResetSecrets().some((expected) => expected === provided);
}
