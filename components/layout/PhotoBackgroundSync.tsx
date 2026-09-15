"use client";

import { useEffect } from "react";
import { useUser } from "@/components/providers/UserProvider";
import { syncAppearance } from "@/services/profile/appearance";
import { syncPhotoBackground } from "@/services/profile/photo-background";

/**
 * Brings this device's copy of the account's look up to date: its photo
 * background, and its theme, star sky and panel style.
 *
 * Renders nothing. A failure -- usually being offline -- leaves the device
 * showing what it already had, which is the right thing to show.
 */
export default function PhotoBackgroundSync() {
  const { user } = useUser();
  const createdAt = user.metadata.creationTime ? Date.parse(user.metadata.creationTime) : 0;

  useEffect(() => {
    void syncPhotoBackground(user.uid).catch(() => undefined);
    void syncAppearance(user.uid, createdAt).catch(() => undefined);
  }, [createdAt, user.uid]);

  return null;
}
