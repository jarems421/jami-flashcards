/**
 * Which tier a student is entered for, and which papers that means.
 *
 * A tier is not recorded as a field on AQA's GCSE maths catalogue entries -- it
 * is in the component's name, "Paper 1 Foundation" against "Paper 1 Higher".
 * Nothing read it, so the tier question appeared empty and was skipped, and a
 * Higher student was then drawn questions from both tiers: a Foundation paper
 * cannot ask what they are being examined on, and the practice is wasted.
 *
 * So the names are read. A tier here carries the components it covers, because
 * restricting the papers is the whole point of asking -- a tier a student
 * picks and nothing filters on is worse than not asking at all.
 */
export type ExamCourseTier = {
  name: string;
  componentIds: string[];
};

/** The tier names a component title may end in, longest first so "Higher Tier" wins. */
const TIER_NAMES = ["Foundation Tier", "Higher Tier", "Foundation", "Higher"];

function tierInTitle(title: string): string | null {
  const match = TIER_NAMES.find((name) => new RegExp(String.raw`\b${name}\b`, "i").test(title));
  if (!match) return null;
  // "Foundation Tier" and "Foundation" are one tier, named the shorter way.
  return match.replace(/\s*Tier$/i, "");
}

export function examCourseTiers(
  components: ReadonlyArray<{ code: string; title: string }>,
  namedTiers: readonly string[] = []
): ExamCourseTier[] {
  const byTier = new Map<string, string[]>();
  for (const component of components) {
    const tier = tierInTitle(component.title);
    if (!tier) continue;
    byTier.set(tier, [...(byTier.get(tier) ?? []), component.code]);
  }
  if (byTier.size > 1) {
    return [...byTier]
      .map(([name, componentIds]) => ({ name, componentIds: [...componentIds].sort() }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  /*
   * A course whose components name no tier may still declare one. Those carry
   * no component mapping, so picking one narrows nothing and every paper stays
   * in play -- which is the honest behaviour when the catalogue cannot say
   * which papers belong to which tier.
   */
  return namedTiers
    .map((name) => ({ name, componentIds: [] }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
