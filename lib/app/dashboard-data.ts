export type DashboardDataRequestOutcome = "applied" | "failed" | "stale";

type DashboardDataRequestOptions<T> = {
  load: () => Promise<T>;
  isCurrent: () => boolean;
  apply: (data: T) => void;
  onError: (error: unknown) => void;
  onSettled: () => void;
};

export async function runDashboardDataRequest<T>({
  load,
  isCurrent,
  apply,
  onError,
  onSettled,
}: DashboardDataRequestOptions<T>): Promise<DashboardDataRequestOutcome> {
  try {
    const data = await load();
    if (!isCurrent()) return "stale";

    apply(data);
    return "applied";
  } catch (error) {
    if (!isCurrent()) return "stale";

    onError(error);
    return "failed";
  } finally {
    if (isCurrent()) {
      onSettled();
    }
  }
}
