"use client";

import {
  isStudyMode,
  SMART_STUDY_MODE_POLICY,
  type StudyModePolicy,
} from "@/lib/study/study-modes";

export const STUDY_MODE_PREFERENCE_PREFIX = "jami:study-mode:";

/**
 * Classic, until a student says otherwise.
 *
 * Smart Mix is the better way to study and the picker says so, but it is not
 * the default: turning on a feature must not quietly convert somebody's whole
 * Daily Review into a typing test overnight. They choose once, it is remembered,
 * and nothing changes for anyone who never opens the picker.
 */
export const DEFAULT_STUDY_MODE_POLICY: StudyModePolicy = {
  kind: "fixed",
  mode: "classic",
};

function storageKey(userId: string) {
  return `${STUDY_MODE_PREFERENCE_PREFIX}${userId}`;
}

export function parseStudyModePolicy(value: string | null): StudyModePolicy {
  if (!value) return DEFAULT_STUDY_MODE_POLICY;
  if (value === "smart") return SMART_STUDY_MODE_POLICY;
  return isStudyMode(value)
    ? { kind: "fixed", mode: value }
    : DEFAULT_STUDY_MODE_POLICY;
}

export function serializeStudyModePolicy(policy: StudyModePolicy) {
  return policy.kind === "smart" ? "smart" : policy.mode;
}

export function readStudyModePolicy(userId: string): StudyModePolicy {
  if (typeof window === "undefined") return DEFAULT_STUDY_MODE_POLICY;
  try {
    return parseStudyModePolicy(window.localStorage.getItem(storageKey(userId)));
  } catch {
    // Storage can be unavailable in privacy modes. Classic is always safe.
    return DEFAULT_STUDY_MODE_POLICY;
  }
}

export function saveStudyModePolicy(userId: string, policy: StudyModePolicy) {
  try {
    window.localStorage.setItem(
      storageKey(userId),
      serializeStudyModePolicy(policy)
    );
  } catch {
    // A remembered convenience, not something worth failing a session over.
  }
}
