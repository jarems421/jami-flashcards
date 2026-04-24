import { isDemoModeEnabledServer, isDemoResetAuthorized } from "@/lib/demo/server";
import { resetDemoWorkspace } from "@/services/demo/admin";

export const runtime = "nodejs";

async function handleReset(request: Request) {
  if (!isDemoModeEnabledServer()) {
    return Response.json({ error: "Demo mode is disabled." }, { status: 503 });
  }

  if (!isDemoResetAuthorized(request.headers.get("authorization"))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await resetDemoWorkspace();
    return Response.json(result);
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Failed to reset demo data.",
      },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  return handleReset(request);
}

export async function POST(request: Request) {
  return handleReset(request);
}
