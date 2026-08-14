export const runtime = "nodejs";

export function POST() {
  // Paper generation is deliberately job-only: returning the raw generation
  // response here would expose the fixed hidden mark scheme to the browser.
  return Response.json(
    {
      error: "Create formal practice papers through the paper-job endpoint.",
      code: "job_required",
    },
    { status: 410 }
  );
}
