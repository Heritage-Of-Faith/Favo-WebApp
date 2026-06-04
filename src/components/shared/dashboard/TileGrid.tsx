// TileGrid — task N9.
// Responsive CSS-grid for dashboard tiles: 4 columns → 2 → 1 as width shrinks.
// Server-safe. Uses auto-fit/minmax so it collapses without breakpoints.

export interface TileGridProps {
  children: React.ReactNode;
  /** Minimum tile width before wrapping (px). Default 220. */
  minTile?: number;
  className?: string;
}

export default function TileGrid({ children, minTile = 220, className }: TileGridProps) {
  return (
    <div
      className={className}
      style={{
        display: "grid",
        gap: "var(--spacing-m)",
        gridTemplateColumns: `repeat(auto-fit, minmax(min(${minTile}px, 100%), 1fr))`,
      }}
    >
      {children}
    </div>
  );
}
