import { APP_BUILD } from "@/lib/app/app-build";

/*
 * Which build is deployed, for an installed app checking whether it is behind.
 * Asked on every launch and return, so it must never be answered from a cache.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { build: APP_BUILD },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
