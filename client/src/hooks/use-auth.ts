import { useEffect, useState } from "react";
import { User } from "firebase/auth";
import { onAuthChange, logout as firebaseLogout } from "@/lib/firebase";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthChange((firebaseUser) => {
      setUser(firebaseUser);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    logout: firebaseLogout,
    isLoggingOut: false,
    updateUsername: async () => {
      throw new Error("Not implemented yet");
    },
    isUpdatingUsername: false,
  };
}