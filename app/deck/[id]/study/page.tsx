import { redirect } from "next/navigation";
import { buildDeckStudyRedirectHref } from "@/lib/app/routes";

type DeckStudyRedirectPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function DeckStudyRedirectPage({
  params,
  searchParams,
}: DeckStudyRedirectPageProps) {
  const { id } = await params;
  const resolvedSearchParams = await searchParams;
  redirect(buildDeckStudyRedirectHref(id, resolvedSearchParams));
}
