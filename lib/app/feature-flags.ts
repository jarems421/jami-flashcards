export type FeatureFlagKey =
  | "enableFolders"
  | "enableMasteryProgress"
  | "enableFlashcardAi"
  | "enableStudyModes";

const DEFAULT_FLAGS: Record<FeatureFlagKey, boolean> = {
  enableFolders: true,
  enableMasteryProgress: true,
  enableFlashcardAi: true,
  // On by default now the modes have been through the browser. Classic is
  // unaffected either way: the flag only decides whether the other modes are
  // offered at all, and setting NEXT_PUBLIC_ENABLE_STUDY_MODES=false hides them
  // again without touching the code.
  enableStudyModes: true,
};

const ENV_KEYS: Record<FeatureFlagKey, string> = {
  enableFolders: "NEXT_PUBLIC_ENABLE_FOLDERS",
  enableMasteryProgress: "NEXT_PUBLIC_ENABLE_MASTERY_PROGRESS",
  enableFlashcardAi: "NEXT_PUBLIC_ENABLE_FLASHCARD_AI",
  enableStudyModes: "NEXT_PUBLIC_ENABLE_STUDY_MODES",
};

function parseFlagValue(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

export function isFeatureEnabled(key: FeatureFlagKey) {
  return parseFlagValue(process.env[ENV_KEYS[key]], DEFAULT_FLAGS[key]);
}

export const featureFlags: Record<FeatureFlagKey, boolean> = {
  enableFolders: isFeatureEnabled("enableFolders"),
  enableMasteryProgress: isFeatureEnabled("enableMasteryProgress"),
  enableFlashcardAi: isFeatureEnabled("enableFlashcardAi"),
  enableStudyModes: isFeatureEnabled("enableStudyModes"),
};
