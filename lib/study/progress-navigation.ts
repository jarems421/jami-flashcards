export type ProgressSection = "overview" | "decks" | "workspace";

export function getProgressSectionFromSearch(search: string): ProgressSection {
  const section = new URLSearchParams(search).get("section");
  if (section === "decks" || section === "workspace") return section;
  return "overview";
}

export function buildProgressSectionSearch(
  search: string,
  section: ProgressSection
): string {
  const params = new URLSearchParams(search);

  if (section === "overview") params.delete("section");
  else params.set("section", section);

  const next = params.toString();
  return next ? `?${next}` : "";
}
