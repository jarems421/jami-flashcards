"use client";

import { auth } from "@/services/firebase";
import { onAuthStateChanged, User } from "firebase/auth";

export const listenToAuth = (
  callback: (user: User | null) => void | Promise<void>
) => {
  return onAuthStateChanged(auth, (user) => {
    // Fire-and-forget async callback, while still surfacing errors.
    void Promise.resolve(callback(user)).catch((e) => {
      console.error("Auth listener callback failed:", e);
    });
  });
};