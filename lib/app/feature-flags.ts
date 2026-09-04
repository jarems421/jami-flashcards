export type FeatureFlagKey =
  | "enableFolders"
  | "enableMasteryProgress"
  | "enableFlashcardAi"
  | "enableStudyModes"
  | "enableTutorPersonalisation";

const DEFAULT_FLAGS: Record<FeatureFlagKey, boolean> = {
  enableFolders: true,
  enableMasteryProgress: true,
  enableFlashcardAi: true,
  // Both features landed with their complete UI, persistence and prompt paths.
  // A direct public environment override can still remove either surface.
  enableStudyModes: true,
  enableTutorPersonalisation: true,
};

/**
 * Public client variables must be referenced directly for Next to replace
 * them in the browser bundle. A computed `process.env[key]` lookup silently
 * falls back to the defaults on the client.
 */
const ENV_VALUES: Record<FeatureFlagKey, string | undefined> = {
  enableFolders: process.env.NEXT_PUBLIC_ENABLE_FOLDERS,
  enableMasteryProgress: process.env.NEXT_PUBLIC_ENABLE_MASTERY_PROGRESS,
  enableFlashcardAi: process.env.NEXT_PUBLIC_ENABLE_FLASHCARD_AI,
  enableStudyModes: process.env.NEXT_PUBLIC_ENABLE_STUDY_MODES,
  enableTutorPersonalisation:
    process.env.NEXT_PUBLIC_ENABLE_TUTOR_PERSONALISATION,
};

function parseFlagValue(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

export function isFeatureEnabled(key: FeatureFlagKey) {
  return parseFlagValue(ENV_VALUES[key], DEFAULT_FLAGS[key]);
}

export const featureFlags: Record<FeatureFlagKey, boolean> = {
  enableFolders: isFeatureEnabled("enableFolders"),
  enableMasteryProgress: isFeatureEnabled("enableMasteryProgress"),
  enableFlashcardAi: isFeatureEnabled("enableFlashcardAi"),
  enableStudyModes: isFeatureEnabled("enableStudyModes"),
  enableTutorPersonalisation: isFeatureEnabled("enableTutorPersonalisation"),
};
