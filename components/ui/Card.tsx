import { type HTMLAttributes } from "react";

type CardProps = HTMLAttributes<HTMLDivElement>;

export default function Card({ className = "", children, ...props }: CardProps) {
  return (
    <div
      className={`rounded-xl border border-border bg-glass-subtle p-6 shadow-glass backdrop-blur-md ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
