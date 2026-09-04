export type FeatureFlagKey =
  | "enableFolders"
  | "enableMasteryProgress"
  | "enableFlashcardAi"
  | "enableTutorPersonalisation";

const DEFAULT_FLAGS: Record<FeatureFlagKey, boolean> = {
  enableFolders: true,
  enableMasteryProgress: true,
  enableFlashcardAi: true,
  /*
   * On: the settings drawer, the folder document and the prompt precedence all
   * landed together, which was the condition for turning it on. A student who
   * can set a preference nothing reads is worse off than one never offered it,
   * and that is no longer the case.
   *
   * What is on is the manual half. Tutor proposes no preferences of its own
   * yet, so there is no Memory view and nothing is ever saved without the
   * student choosing it -- set `NEXT_PUBLIC_ENABLE_TUTOR_PERSONALISATION=false`
   * to take the whole surface back out.
   */
  enableTutorPersonalisation: true,
};

/**
 * Each override read as a direct property, which is the only form that works.
 *
 * These were looked up by name -- `process.env[ENV_KEYS[key]]` -- and that
 * cannot work in the browser. Next replaces `process.env.NEXT_PUBLIC_FOO` with
 * its value while bundling, and it can only do that where the property is
 * written out literally; a computed lookup has nothing to substitute, so
 * `process.env` is an empty object by the time it runs and every flag silently
 * fell back to its default.
 *
 * Nobody noticed because the three flags that existed all default to `true`,
 * so the fallback and the intended value agreed. The first flag to default
 * `false` was invisible in the browser however its variable was set -- the
 * button it gates simply never rendered.
 *
 * Server code was unaffected: `process.env` is real there, so route handlers
 * reading the same flags behaved as documented. That is the worse version of
 * this bug, not the better one -- an API that enforces a flag the UI cannot
 * see disagrees with itself.
 */
const ENV_VALUES: Record<FeatureFlagKey, string | undefined> = {
  enableFolders: process.env.NEXT_PUBLIC_ENABLE_FOLDERS,
  enableMasteryProgress: process.env.NEXT_PUBLIC_ENABLE_MASTERY_PROGRESS,
  enableFlashcardAi: process.env.NEXT_PUBLIC_ENABLE_FLASHCARD_AI,
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
  enableTutorPersonalisation: isFeatureEnabled("enableTutorPersonalisation"),
};
