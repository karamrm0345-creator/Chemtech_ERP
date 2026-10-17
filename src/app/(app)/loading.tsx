export default function Loading() {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true" aria-label="Loading">
      <div className="h-7 w-64 rounded bg-line/70" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 rounded-lg bg-white shadow-card" />)}</div>
      <div className="h-80 rounded-lg bg-white shadow-card" />
    </div>
  );
}
