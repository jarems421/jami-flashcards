"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_TUTOR_ATTACHMENTS_PER_MESSAGE,
  type TutorAttachment,
} from "@/lib/ai/tutor-attachments";
import {
  discardTutorAttachment,
  uploadTutorAttachment,
} from "@/services/ai/tutor-attachments";

export type PendingTutorAttachment = {
  key: string;
  file: File;
  /** A local preview, for pictures. */
  previewUrl?: string;
  progress: number;
  status: "uploading" | "ready" | "failed";
  attachment?: TutorAttachment;
  error?: string;
};

/**
 * Files waiting to go with the next Tutor message.
 *
 * Each uploads as soon as it is added, so sending is not held up by the
 * upload; nothing reads it until the message is sent. A file taken off before
 * sending is deleted. Files already sent are remembered for this sitting, so
 * a picture shows from memory and saving one as a source needs no download.
 */
export function useTutorAttachments(userId: string) {
  const [pending, setPending] = useState<PendingTutorAttachment[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const pendingRef = useRef(pending);
  useEffect(() => {
    pendingRef.current = pending;
  });
  /** Sent files by storage path: the file itself and its preview. */
  const sentRef = useRef(new Map<string, { file: File; previewUrl?: string }>());

  const update = (key: string, change: Partial<PendingTutorAttachment>) =>
    setPending((current) => current.map((item) => (item.key === key ? { ...item, ...change } : item)));

  const add = useCallback(
    (files: readonly File[]) => {
      setNotice(null);
      const room = MAX_TUTOR_ATTACHMENTS_PER_MESSAGE - pendingRef.current.length;
      if (room <= 0) {
        setNotice(`Up to ${MAX_TUTOR_ATTACHMENTS_PER_MESSAGE} files per message.`);
        return;
      }
      if (files.length > room) setNotice(`Up to ${MAX_TUTOR_ATTACHMENTS_PER_MESSAGE} files per message.`);
      const added = files.slice(0, room).map((file) => ({
        key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        ...(file.type.startsWith("image/") ? { previewUrl: URL.createObjectURL(file) } : {}),
        progress: 0,
        status: "uploading" as const,
      }));
      setPending((current) => [...current, ...added]);
      added.forEach((item) => {
        void uploadTutorAttachment({
          userId,
          file: item.file,
          onProgress: (progress) => update(item.key, { progress }),
        })
          .then((attachment) => {
            // Taken off while it was uploading: the upload is not wanted.
            if (!pendingRef.current.some((entry) => entry.key === item.key)) {
              void discardTutorAttachment(attachment);
              return;
            }
            update(item.key, { status: "ready", attachment, progress: 1 });
          })
          .catch((error: unknown) =>
            update(item.key, {
              status: "failed",
              error: error instanceof Error ? error.message : "That file could not be added.",
            })
          );
      });
    },
    [userId]
  );

  const remove = useCallback((key: string) => {
    const item = pendingRef.current.find((entry) => entry.key === key);
    if (!item) return;
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    if (item.attachment) void discardTutorAttachment(item.attachment);
    setPending((current) => current.filter((entry) => entry.key !== key));
  }, []);

  /** Drops every waiting file, deleting the ones already uploaded. */
  const clear = useCallback(() => {
    pendingRef.current.forEach((item) => {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      if (item.attachment) void discardTutorAttachment(item.attachment);
    });
    setPending([]);
    setNotice(null);
  }, []);

  /** The uploaded files, handed to the message being sent and cleared from here. */
  const take = useCallback((): TutorAttachment[] => {
    const ready = pendingRef.current.filter((item) => item.status === "ready" && item.attachment);
    ready.forEach((item) => {
      sentRef.current.set(item.attachment!.storagePath, { file: item.file, previewUrl: item.previewUrl });
    });
    pendingRef.current
      .filter((item) => item.status === "failed" && item.previewUrl)
      .forEach((item) => URL.revokeObjectURL(item.previewUrl!));
    setPending([]);
    setNotice(null);
    return ready.map((item) => item.attachment!);
  }, []);

  const sentFile = useCallback((storagePath: string) => sentRef.current.get(storagePath)?.file, []);
  const sentPreviewUrl = useCallback(
    (storagePath: string) => sentRef.current.get(storagePath)?.previewUrl,
    []
  );

  // Previews are local memory; they go when the drawer does.
  useEffect(() => {
    const sent = sentRef.current;
    return () => {
      pendingRef.current.forEach((item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl));
      sent.forEach((entry) => entry.previewUrl && URL.revokeObjectURL(entry.previewUrl));
    };
  }, []);

  return {
    pending,
    notice,
    uploading: pending.some((item) => item.status === "uploading"),
    ready: pending.some((item) => item.status === "ready"),
    add,
    remove,
    clear,
    take,
    sentFile,
    sentPreviewUrl,
    dismissNotice: () => setNotice(null),
  };
}
