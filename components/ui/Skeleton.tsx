type SkeletonProps = {
  className?: string;
};

export default function Skeleton({ className = "" }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded-[1.2rem] bg-glass-medium ${className}`}
    />
  );
}
