export function sanitizeDownloadFileName(value: string, fallback = "download") {
  const normalized = value
    .trim()
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

export function downloadTextFile(
  fileName: string,
  text: string,
  type = "text/plain;charset=utf-8",
) {
  const content = type.startsWith("text/csv") ? `\uFEFF${text}` : text;
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
