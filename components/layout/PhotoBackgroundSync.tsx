"use client";

import { useEffect } from "react";
import { useUser } from "@/components/providers/UserProvider";
import { syncPhotoBackground } from "@/services/profile/photo-background";

/**
 * Brings this device's copy of the account's photo background up to date.
 *
 * Renders nothing. A failure -- usually being offline -- leaves the device
 * showing what it already had, which is the right thing to show.
 */
export default function PhotoBackgroundSync() {
  const { user } = useUser();

  useEffect(() => {
    void syncPhotoBackground(user.uid).catch(() => undefined);
  }, [user.uid]);

  return null;
}
