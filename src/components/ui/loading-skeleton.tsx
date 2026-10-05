export type LoadingSkeletonProps = {
  lines?: number;
  className?: string;
};

export function LoadingSkeleton({
  lines = 3,
  className,
}: LoadingSkeletonProps) {
  const safeLineCount = Math.max(1, Math.floor(lines));

  return (
    <div
      aria-busy="true"
      aria-label="正在加载"
      className={["animate-pulse space-y-3", className].filter(Boolean).join(" ")}
      role="status"
    >
      {Array.from({ length: safeLineCount }, (_, index) => (
        <div
          className="h-3 rounded-full bg-[var(--neutral-soft)] last:w-2/3"
          key={index}
        />
      ))}
      <span className="sr-only">正在加载</span>
    </div>
  );
}
