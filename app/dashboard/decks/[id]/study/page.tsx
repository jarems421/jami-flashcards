import { redirect } from "next/navigation";

type DashboardDeckStudyRedirectPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function DashboardDeckStudyRedirectPage({
  params,
  searchParams,
}: DashboardDeckStudyRedirectPageProps) {
  const { id } = await params;
  const resolvedSearchParams = await searchParams;
  const nextSearchParams = new URLSearchParams();

  nextSearchParams.set("mode", "custom");
  nextSearchParams.set("decks", id);

  for (const [key, value] of Object.entries(resolvedSearchParams)) {
    if (Array.isArray(value)) {
      value.forEach((item) => nextSearchParams.append(key, item));
      continue;
    }

    if (typeof value === "string") {
      nextSearchParams.set(key, value);
    }
  }

  redirect(`/dashboard/study?${nextSearchParams.toString()}`);
}

