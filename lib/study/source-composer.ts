export type SourceComposerKind = "text" | "link" | "upload";

export function getSourceTitleFromFileName(fileName: string) {
  return fileName.trim().replace(/\.[^.]+$/, "");
}

export function clearFilenameDerivedTitle(
  title: string,
  filenameDerivedTitle: string
) {
  return filenameDerivedTitle && title === filenameDerivedTitle ? "" : title;
}

export function buildSourceComposerContent(
  kind: SourceComposerKind,
  values: {
    contentText: string;
    externalUrl: string;
    fileName: string;
    fileType: string;
  }
) {
  return {
    contentText: kind === "text" ? values.contentText : undefined,
    externalUrl: kind === "link" ? values.externalUrl : undefined,
    fileName: kind === "upload" ? values.fileName : undefined,
    fileType: kind === "upload" ? values.fileType : undefined,
  };
}
