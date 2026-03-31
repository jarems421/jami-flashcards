export function formatTimeRemaining(deadline: number): string {
  const diffMs = deadline - Date.now();

  if (diffMs <= 0) {
    return "Expired";
  }

  const totalSeconds = Math.floor(diffMs / 1000);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const totalHours = Math.floor(totalMinutes / 60);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `${days}d ${hours}h left`;
  }

  if (totalHours > 0) {
    return `${totalHours}h ${minutes}m left`;
  }

  return `${Math.max(1, totalMinutes)}m left`;
}
