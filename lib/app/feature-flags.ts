export type FeatureFlagKey =
  | "enableTopics"
  | "enablePractise"
  | "enableTutorInPractice"
  | "enableMasteryProgress"
  | "enableToday"
  | "enableLibrary"
  | "enableAnywhere";

const DEFAULT_FLAGS: Record<FeatureFlagKey, boolean> = {
  enableTopics: true,
  enablePractise: true,
  enableTutorInPractice: true,
  enableMasteryProgress: true,
  enableToday: false,
  enableLibrary: true,
  enableAnywhere: false,
};

const ENV_KEYS: Record<FeatureFlagKey, string> = {
  enableTopics: "NEXT_PUBLIC_ENABLE_TOPICS",
  enablePractise: "NEXT_PUBLIC_ENABLE_PRACTISE",
  enableTutorInPractice: "NEXT_PUBLIC_ENABLE_TUTOR_IN_PRACTICE",
  enableMasteryProgress: "NEXT_PUBLIC_ENABLE_MASTERY_PROGRESS",
  enableToday: "NEXT_PUBLIC_ENABLE_TODAY",
  enableLibrary: "NEXT_PUBLIC_ENABLE_LIBRARY",
  enableAnywhere: "NEXT_PUBLIC_ENABLE_ANYWHERE",
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
  enableTopics: isFeatureEnabled("enableTopics"),
  enablePractise: isFeatureEnabled("enablePractise"),
  enableTutorInPractice: isFeatureEnabled("enableTutorInPractice"),
  enableMasteryProgress: isFeatureEnabled("enableMasteryProgress"),
  enableToday: isFeatureEnabled("enableToday"),
  enableLibrary: isFeatureEnabled("enableLibrary"),
  enableAnywhere: isFeatureEnabled("enableAnywhere"),
};
