// Admin dashboard loading skeleton — shown while page data fetches.
// Keeps the sidebar visible; replaces the main content area with a neutral pulse.

export default function AdminLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-8 w-48 rounded-[var(--radius-card)] bg-border-subtle" />
      <div className="h-4 w-72 rounded-[var(--radius-card)] bg-border-subtle" />
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-28 rounded-[var(--radius-card)] bg-border-subtle"
          />
        ))}
      </div>
      <div className="h-64 rounded-[var(--radius-card)] bg-border-subtle" />
    </div>
  );
}
