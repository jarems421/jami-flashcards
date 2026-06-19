export function sortByCreatedAtNewest<T>(
  items: readonly T[],
  getCreatedAt: (item: T) => unknown
) {
  return [...items].sort((left, right) => {
    const leftCreatedAt = getCreatedAt(left);
    const rightCreatedAt = getCreatedAt(right);
    const leftTime =
      typeof leftCreatedAt === "number" &&
      Number.isFinite(leftCreatedAt) &&
      leftCreatedAt > 0
        ? leftCreatedAt
        : null;
    const rightTime =
      typeof rightCreatedAt === "number" &&
      Number.isFinite(rightCreatedAt) &&
      rightCreatedAt > 0
        ? rightCreatedAt
        : null;

    if (leftTime === null && rightTime === null) return 0;
    if (leftTime === null) return 1;
    if (rightTime === null) return -1;
    return rightTime - leftTime;
  });
}
