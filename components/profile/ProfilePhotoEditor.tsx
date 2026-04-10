"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import {
  getProfilePhotoData,
  saveProfilePhotoData,
  uploadProfilePhoto,
  type ProfilePhoto,
} from "@/services/profile/photo";

type Props = {
  userId: string;
  displayName: string;
  fallbackPhotoURL?: string | null;
};

const CIRCLE_SIZE = 128;

export default function ProfilePhotoEditor({
  userId,
  displayName,
  fallbackPhotoURL,
}: Props) {
  const initial = displayName.charAt(0).toUpperCase();

  const [photo, setPhoto] = useState<ProfilePhoto | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const circleRef = useRef<HTMLDivElement>(null);

  // Load saved photo data
  useEffect(() => {
    void getProfilePhotoData(userId).then((data) => {
      if (data) {
        setPhoto(data);
        setPreviewUrl(data.url);
        setOffsetX(data.offsetX);
        setOffsetY(data.offsetY);
      }
    });
  }, [userId]);

  const currentUrl = previewUrl || fallbackPhotoURL || null;
  const hasCustomPhoto = !!photo?.url || !!previewUrl;

  const handleFileSelect = async (file: File) => {
    setError(null);
    setUploading(true);
    try {
      const url = await uploadProfilePhoto(userId, file);
      setPreviewUrl(url);
      setOffsetX(0);
      setOffsetY(0);
      setDirty(true);
      // Auto-save with default center position
      await saveProfilePhotoData(userId, { url, offsetX: 0, offsetY: 0 });
      setPhoto({ url, offsetX: 0, offsetY: 0 });
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFileSelect(file);
    e.target.value = "";
  };

  const handleSavePosition = async () => {
    if (!currentUrl) return;
    setSaving(true);
    setError(null);
    try {
      const data: ProfilePhoto = { url: currentUrl, offsetX, offsetY };
      await saveProfilePhotoData(userId, data);
      setPhoto(data);
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save position.");
    } finally {
      setSaving(false);
    }
  };

  // --- Drag-to-reposition ---
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!currentUrl) return;
      e.preventDefault();
      setDragging(true);
      setDragStart({ x: e.clientX, y: e.clientY });
      setDragOffset({ x: offsetX, y: offsetY });
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [currentUrl, offsetX, offsetY]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      const dx = ((e.clientX - dragStart.x) / CIRCLE_SIZE) * 200;
      const dy = ((e.clientY - dragStart.y) / CIRCLE_SIZE) * 200;
      setOffsetX(Math.max(-100, Math.min(100, dragOffset.x + dx)));
      setOffsetY(Math.max(-100, Math.min(100, dragOffset.y + dy)));
      setDirty(true);
    },
    [dragging, dragStart, dragOffset]
  );

  const handlePointerUp = useCallback(() => {
    setDragging(false);
  }, []);

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Circle preview */}
      <div
        ref={circleRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className={`relative flex items-center justify-center overflow-hidden rounded-full ${
          currentUrl ? "cursor-grab active:cursor-grabbing" : ""
        }`}
        style={{
          width: CIRCLE_SIZE,
          height: CIRCLE_SIZE,
          touchAction: "none",
        }}
      >
        {currentUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element -- Custom image cropping requires direct <img> usage for drag-to-reposition and cropping. Next/Image is not suitable here. */
          <img
            src={currentUrl}
            alt="Profile"
            draggable={false}
            className="pointer-events-none absolute min-h-full min-w-full object-cover select-none"
            style={{
              transform: `translate(${offsetX}%, ${offsetY}%)`,
            }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-warm-accent to-accent text-3xl font-bold text-surface-base shadow-[var(--shadow-accent)]">
            {initial}
          </div>
        )}
      </div>

      {hasCustomPhoto ? (
        <p className="text-xs text-text-muted">Drag the image to reposition</p>
      ) : null}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleInputChange}
      />

      <div className="flex gap-2">
        <Button
          variant="secondary"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? "Uploading..." : hasCustomPhoto ? "Change photo" : "Upload photo"}
        </Button>

        {dirty && hasCustomPhoto ? (
          <Button
            disabled={saving}
            onClick={() => void handleSavePosition()}
          >
            {saving ? "Saving..." : "Save position"}
          </Button>
        ) : null}
      </div>

      {error ? (
        <p className="text-xs text-rose-200">{error}</p>
      ) : null}
    </div>
  );
}
