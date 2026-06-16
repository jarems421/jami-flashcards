import { getTagKey, normalizeCardTags } from "@/lib/study/cards";

export function getTagFilterAfterRename(targetTag: string) {
  return normalizeCardTags([targetTag])[0] ?? targetTag.trim();
}

export function shouldClearTagFilterAfterRemoval(currentTagFilter: string, removedTag: string) {
  return Boolean(currentTagFilter) && getTagKey(currentTagFilter) === getTagKey(removedTag);
}
