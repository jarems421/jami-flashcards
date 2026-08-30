/**
 * Put Psychopathology back as Paper 1 Section D.
 *
 * The researched profile named Psychopathology as the fourth topic and was
 * correct. `repair-psychology-profile.mjs` overwrote it with "Approaches in
 * Psychology", stating as its reason: "Paper 1 covers Approaches in Psychology;
 * Psychopathology is the AS paper." That is the wrong way round. AQA A-level
 * Psychology 7182/1 Paper 1 is Social influence, Memory, Attachment and
 * Psychopathology; Approaches in Psychology is Paper 2. A correct field was
 * replaced by an incorrect one, with a confident justification attached, and
 * every paper generated since has been built on Paper 2 content.
 *
 * The tariffs are untouched. They were read off the real June 2022 paper, whose
 * Section D is Psychopathology, so 6+3+2+1+4+8 was always the right shape for
 * the right topic.
 *
 * Confidence drops to medium and the version is restamped. This profile shipped
 * a wrong section while reading verified / high confidence / no issues, which is
 * the part worth distrusting: the numbers were checked against a source and the
 * topic was not.
 */
import { readFileSync } from "node:fs";
const raw = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
for (const line of raw.split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (!m || process.env[m[1]]) continue;
  process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const lib = await import("../../services/ai/exam-format-library.server.ts");
const { getAdminDb } = await import("../../services/firebase/admin.ts");

const PROFILE_ID = "aqa-a-level-psychology-7182-1";
const OLD_VERSION = "2026-verified-from-jun22";
const NEW_VERSION = "2026-jun22-section-d-corrected";

const existing = await lib.getExamFormatProfileVersion(PROFILE_ID, OLD_VERSION);
if (!existing) throw new Error("Profile version not found; nothing corrected.");

const swap = (value) =>
  String(value).replace(/Approaches in Psychology/g, "Psychopathology");

const corrected = {
  ...existing,
  version: NEW_VERSION,
  confidence: "medium",
  sections: existing.sections.map((section) =>
    section.id === "D" ? { ...section, title: "Psychopathology" } : section
  ),
  topicExpectations: existing.topicExpectations.map(swap),
  formatSummary: swap(existing.formatSummary),
  knownIssues: [
    ...(existing.knownIssues ?? []),
    "Section D was stored as Approaches in Psychology, which is Paper 2 content. Corrected to Psychopathology 30 August 2026. The section titles have not been checked against a current specification by a person.",
  ],
};

const db = getAdminDb();
await db
  .collection("examFormatProfiles").doc(PROFILE_ID)
  .collection("versions").doc(NEW_VERSION)
  .set({ ...corrected, retrievedAt: Date.now(), updatedAt: Date.now() }, { merge: false });

// Retire the version that carried Paper 2 content so nothing selects it again.
await db
  .collection("examFormatProfiles").doc(PROFILE_ID)
  .collection("versions").doc(OLD_VERSION)
  .set({ status: "retired", updatedAt: Date.now() }, { merge: true });

console.log(JSON.stringify({
  corrected: NEW_VERSION,
  retired: OLD_VERSION,
  sections: corrected.sections.map((s) => `${s.id} ${s.title} ${s.marks}`),
}, null, 2));
