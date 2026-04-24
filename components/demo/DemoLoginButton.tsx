"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { signInToDemoAccount } from "@/services/demo/client";

type Props = {
  redirectTo?: string;
  label?: string;
  variant?: "primary" | "secondary" | "warm" | "surface";
  className?: string;
};

export default function DemoLoginButton({
  redirectTo = "/dashboard",
  label = "Try shared study session",
  variant = "warm",
  className,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setLoading(true);
    setError(null);

    try {
      await signInToDemoAccount();
      router.push(redirectTo);
    } catch (nextError) {
      console.error(nextError);
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Failed to start the demo account."
      );
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant={variant}
        size="lg"
        onClick={() => void handleClick()}
        disabled={loading}
        className={className}
      >
        {loading ? "Starting demo..." : label}
      </Button>
      {error ? <p className="text-sm text-rose-200">{error}</p> : null}
    </div>
  );
}
