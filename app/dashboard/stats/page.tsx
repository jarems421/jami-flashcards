import { redirect } from "next/navigation";
import {
  buildProgressRedirectHref,
  type PageSearchParams,
} from "@/lib/app/progress-route";

export default async function StatsRedirectPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}) {
  redirect(buildProgressRedirectHref(await searchParams));
}
