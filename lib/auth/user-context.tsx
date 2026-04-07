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

type UserContextValue = {
  user: User;
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

  useEffect(() => {
    const unsubscribe = listenToAuth((nextUser) => {
      setUser(nextUser);
      setChecked(true);
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
    <UserContext.Provider value={{ user }}>
      {children}
    </UserContext.Provider>
  );
}

