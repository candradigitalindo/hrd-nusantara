import { cn } from "@/lib/utils";

export const Skeleton = ({ className }: { className?: string }) => (
  <div className={cn("animate-pulse rounded-md bg-surface-2", className)} aria-hidden />
);

export const SkeletonBaris = ({ jumlah = 5 }: { jumlah?: number }) => (
  <div className="space-y-3 p-4">
    {Array.from({ length: jumlah }).map((_, i) => (
      <Skeleton key={i} className="h-12 w-full" />
    ))}
  </div>
);
