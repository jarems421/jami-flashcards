import "server-only";

export function assistantAssetError(error: string, status: number, code: string) {
  return Response.json({ error, code }, { status });
}
