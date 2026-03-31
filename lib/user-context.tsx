"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { User } from "firebase/auth";
import { listenToAuth } from "@/lib/auth-listener";

type UserContextValue = {
  user: User;
  /** Call to manually trigger a re-render in consuming components. */
  refreshKey: number;
  /** Increment refreshKey — wired to the pull-to-refresh / refresh button. */
  requestRefresh: () => void;
};

const UserContext = createContext<UserContextValue | null>(null);

export function useUser(): UserContextValue {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useUser() must be used inside <UserProvider>");
  return ctx;
}

export default function UserProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [checked, setChecked] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const unsubscribe = listenToAuth((nextUser) => {
      if (!nextUser) {
        router.replace("/");
        return;
      }
      setUser(nextUser);
      setChecked(true);
    });
    return () => unsubscribe();
  }, [router]);

  const requestRefresh = () => setRefreshKey((k) => k + 1);

  // Still resolving auth — show nothing yet.
  if (!checked || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-text-muted text-sm">
        Loading…
      </div>
    );
  }

  return (
    <UserContext.Provider value={{ user, refreshKey, requestRefresh }}>
      {children}
    </UserContext.Provider>
  );
}
