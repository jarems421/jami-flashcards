import { redirect } from "next/navigation";

type DeckStudyRedirectPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

function buildSearchString(searchParams: {
  [key: string]: string | string[] | undefined;
}) {
  const nextSearchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      value.forEach((item) => nextSearchParams.append(key, item));
      continue;
    }

    if (typeof value === "string") {
      nextSearchParams.set(key, value);
    }
  }

  const queryString = nextSearchParams.toString();
  return queryString ? `?${queryString}` : "";
}

export default async function DeckStudyRedirectPage({
  params,
  searchParams,
}: DeckStudyRedirectPageProps) {
  const { id } = await params;
  const resolvedSearchParams = await searchParams;
  redirect(
    `/dashboard/decks/${encodeURIComponent(id)}/study${buildSearchString(resolvedSearchParams)}`
  );
}
