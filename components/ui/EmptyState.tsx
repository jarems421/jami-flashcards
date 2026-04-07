import { type ReactNode } from "react";
import Card from "./Card";

type EmptyStateProps = {
  emoji: string;
  title: string;
  description?: string;
  action?: ReactNode;
};

export default function EmptyState({
  emoji,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <Card tone="warm" padding="lg" className="animate-fade-in text-center">
      <div className="text-4xl">{emoji}</div>
      <h3 className="mt-3 text-base font-semibold">{title}</h3>
      {description ? (
        <p className="mt-2 text-sm leading-6 text-text-secondary">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </Card>
  );
}
