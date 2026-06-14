export type PageSearchParams = Record<
  string,
  string | string[] | undefined
>;

export function buildProgressRedirectHref(searchParams: PageSearchParams) {
  const next = new URLSearchParams();

  Object.entries(searchParams).forEach(([key, value]) => {
    if (key === "section" || value === undefined) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => next.append(key, item));
      return;
    }

    next.set(key, value);
  });

  const query = next.toString();
  return `/dashboard/progress${query ? `?${query}` : ""}`;
}
