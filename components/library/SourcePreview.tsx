import Image from "next/image";
import type { Source } from "@/lib/practice/sources";
import {
  getSourceFileKind,
  getSourceFileTypeLabel,
} from "@/lib/practice/source-files";

type SourcePreviewProps = {
  source: Source;
  fileUrl?: string;
};

export default function SourcePreview({ source, fileUrl }: SourcePreviewProps) {
  if (source.contentText) {
    return (
      <div className="max-h-[28rem] overflow-y-auto whitespace-pre-wrap text-sm leading-6 text-text-secondary">
        {source.contentText}
      </div>
    );
  }

  if (source.type === "link" && source.externalUrl) {
    return (
      <div className="break-words text-sm leading-6 text-text-secondary">
        {source.externalUrl}
      </div>
    );
  }

  const fileKind = getSourceFileKind(source.fileType);
  if (fileKind === "image" && fileUrl) {
    return (
      <div className="flex max-h-[32rem] justify-center overflow-hidden rounded-[1rem] bg-black/15">
        <Image
          src={fileUrl}
          alt={source.title}
          width={1200}
          height={900}
          unoptimized
          className="max-h-[32rem] w-auto max-w-full object-contain"
        />
      </div>
    );
  }

  if (fileKind === "pdf" && fileUrl) {
    return (
      <iframe
        src={fileUrl}
        title={`${source.title} PDF preview`}
        className="h-[32rem] w-full rounded-[1rem] border-0 bg-white"
      />
    );
  }

  if (source.fileName) {
    return (
      <div className="flex min-h-32 flex-col items-center justify-center rounded-[1rem] text-center">
        <div className="text-sm font-semibold text-text-primary">
          {source.fileName}
        </div>
        <div className="mt-1 text-xs text-text-muted">
          {getSourceFileTypeLabel(source.fileType)}
        </div>
        <div className="mt-3 text-xs leading-5 text-text-muted">
          Open the original to view this document.
        </div>
      </div>
    );
  }

  return <div className="text-sm text-text-muted">No source content available.</div>;
}
