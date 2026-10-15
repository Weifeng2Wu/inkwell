export function OpenCodePanelSkeleton() {
  return (
    <div className="flex flex-col bg-background h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="size-2 rounded-full bg-surface-tertiary animate-pulse" />
          <div className="h-4 w-24 rounded bg-surface-tertiary animate-pulse" />
        </div>
        <div className="h-6 w-12 rounded bg-surface-tertiary animate-pulse" />
      </div>
      <div className="flex-1 p-3 space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="space-y-2">
            <div
              className="h-4 rounded bg-surface-secondary animate-pulse"
              style={{ width: `${60 + i * 10}%` }}
            />
            <div
              className="h-4 rounded bg-surface-secondary animate-pulse"
              style={{ width: `${40 + i * 10}%` }}
            />
          </div>
        ))}
      </div>
      <div className="border-t border-border p-3">
        <div className="h-16 rounded-md bg-accent-hover border border-border animate-pulse" />
      </div>
    </div>
  );
}
