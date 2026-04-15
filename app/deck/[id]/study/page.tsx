import { redirect } from "next/navigation";

type DeckStudyRedirectPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

function copySearchParams(searchParams: {
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

  return nextSearchParams;
}

export default async function DeckStudyRedirectPage({
  params,
  searchParams,
}: DeckStudyRedirectPageProps) {
  const { id } = await params;
  const resolvedSearchParams = await searchParams;
  const nextSearchParams = copySearchParams(resolvedSearchParams);
  nextSearchParams.set("mode", "custom");
  nextSearchParams.set("decks", id);

  redirect(`/dashboard/study?${nextSearchParams.toString()}`);
}
