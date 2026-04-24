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
import { listenToAuth } from "@/lib/auth/auth-listener";
import type { DemoViewerMode } from "@/lib/demo/shared";

type UserContextValue = {
  user: User;
  demoMode: Exclude<DemoViewerMode, "demo-readonly">;
  isDemoUser: boolean;
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
  const [demoMode, setDemoMode] = useState<Exclude<DemoViewerMode, "demo-readonly">>("private");

  useEffect(() => {
    const unsubscribe = listenToAuth((nextUser) => {
      if (!nextUser) {
        setUser(null);
        setDemoMode("private");
        setChecked(true);
        return;
      }

      void nextUser
        .getIdTokenResult()
        .then((tokenResult) => {
          setUser(nextUser);
          setDemoMode(tokenResult.claims.demo === true ? "demo-test" : "private");
          setChecked(true);
        })
        .catch((error) => {
          console.error(error);
          setUser(nextUser);
          setDemoMode("private");
          setChecked(true);
        });
    });
    return () => unsubscribe();
  }, [router]);

  useEffect(() => {
    if (checked && !user) {
      router.replace("/");
    }
  }, [checked, user, router]);

  // Still resolving auth - show nothing yet.
  if (!checked || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-white/10 border-t-accent" />
      </div>
    );
  }

  return (
    <UserContext.Provider value={{ user, demoMode, isDemoUser: demoMode === "demo-test" }}>
      {children}
    </UserContext.Provider>
  );
}
