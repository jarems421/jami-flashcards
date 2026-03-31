function getErrorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") {
      return code;
    }
  }

  return undefined;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown health check error";
}

export async function GET() {
  const timestamp = new Date().toISOString();

  try {
    const { db, validateFirebaseConfig, getFirebaseEnvIssues } = await import("@/services/firebase");
    const { doc, getDoc } = await import("firebase/firestore");
    const configIssues = getFirebaseEnvIssues();

    if (configIssues.length > 0) {
      return Response.json(
        {
          ok: false,
          timestamp,
          firestore: "unconfigured",
          details: configIssues,
        },
        { status: 503 }
      );
    }

    validateFirebaseConfig();
  await getDoc(doc(db, "health", "ping"));

    return Response.json({
      ok: true,
      timestamp,
      firestore: "reachable",
    });
  } catch (error) {
    const code = getErrorCode(error);

    if (code === "permission-denied") {
      return Response.json({
        ok: true,
        timestamp,
        firestore: "reachable",
        details: "permission-denied",
      });
    }

    return Response.json(
      {
        ok: false,
        timestamp,
        firestore: "unreachable",
        details: getErrorMessage(error),
      },
      { status: 500 }
    );
  }
}
