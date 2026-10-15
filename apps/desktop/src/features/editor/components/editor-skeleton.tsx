export function EditorSkeleton({ className = "" }: { className?: string }) {
  const rows = [70, 45, 60, 80, 35, 55, 40, 75].map((width) => ({
    id: `editor-skeleton-${width}`,
    width,
  }));

  return (
    <div className={`flex flex-col ${className}`}>
      <div className="flex-1 bg-background p-4 space-y-2">
        {rows.map(({ id, width }) => (
          <div key={id} className="flex gap-4">
            <div className="w-8 h-4 bg-surface-secondary animate-pulse" />
            <div
              className="flex-1 h-4 bg-surface-secondary animate-pulse"
              style={{ width: `${width}%` }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
