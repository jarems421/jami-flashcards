import { redirect } from "next/navigation";
import { buildDeckStudyRedirectHref } from "@/lib/app/routes";

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
  redirect(buildDeckStudyRedirectHref(id, resolvedSearchParams));
}

