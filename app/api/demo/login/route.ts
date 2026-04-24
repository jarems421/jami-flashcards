import { isDemoModeEnabledServer } from "@/lib/demo/server";
import { issueDemoCustomToken } from "@/services/demo/admin";

export const runtime = "nodejs";

export async function POST() {
  if (!isDemoModeEnabledServer()) {
    return Response.json({ error: "Demo mode is disabled." }, { status: 503 });
  }

  try {
    const token = await issueDemoCustomToken();
    return Response.json({ token });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Failed to create the demo session.",
      },
      { status: 500 }
    );
  }
}
