export function getNotebookInkViewportScale(input: {
  displayWidth: number;
  displayHeight: number;
  pageWidth: number;
  pageHeight: number;
}) {
  const pageWidth = Math.max(1, input.pageWidth);
  const pageHeight = Math.max(1, input.pageHeight);
  return {
    x: Math.max(0, input.displayWidth) / pageWidth,
    y: Math.max(0, input.displayHeight) / pageHeight,
  };
}
