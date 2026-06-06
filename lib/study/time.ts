export function formatTimeRemaining(deadline: number): string {
  if (deadline <= 0) {
    return "No deadline";
  }

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

export type DeadlineTone = "neutral" | "urgent" | "overdue";

export function getDeadlineDisplay(
  deadline: number,
  now = Date.now()
): { label: string; tone: DeadlineTone } {
  if (deadline <= 0) {
    return { label: "No deadline", tone: "neutral" };
  }

  if (deadline < now) {
    return { label: "Overdue", tone: "overdue" };
  }

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayAfterTomorrow = new Date(tomorrow);
  dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);

  if (deadline < tomorrow.getTime()) {
    return { label: "Due today", tone: "urgent" };
  }

  if (deadline < dayAfterTomorrow.getTime()) {
    return { label: "Due tomorrow", tone: "urgent" };
  }

  return {
    label: `Due ${new Intl.DateTimeFormat("en", {
      day: "numeric",
      month: "short",
    }).format(deadline)}`,
    tone: "neutral",
  };
}
