"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { User } from "firebase/auth";

type UserContextValue = {
  user: User;
};

const UserContext = createContext<UserContextValue | null>(null);

export function useUser(): UserContextValue {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error("useUser() must be used inside <UserProvider>");
  }
  return context;
}

export default function UserProvider({
  children,
  user,
}: {
  children: ReactNode;
  user: User;
}) {
  return (
    <UserContext.Provider value={{ user }}>
      {children}
    </UserContext.Provider>
  );
}
