/** Platzhalter während eine Seite lädt — ruhiges Pulsieren statt Spinner. */
export function PageLoading({ label = "Wird geladen…" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-4 py-2">
      <span className="sr-only">{label}</span>
      <div aria-hidden className="h-3 w-24 animate-pulse rounded-full bg-accent-200/70 dark:bg-accent-800/60" />
      <div aria-hidden className="h-8 w-64 animate-pulse rounded-lg bg-stone-200 dark:bg-stone-800" />
      <div aria-hidden className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="card flex h-20 animate-pulse items-center gap-3 p-3">
            <div className="h-12 w-12 rounded-full bg-stone-200 dark:bg-stone-800" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-2/3 rounded bg-stone-200 dark:bg-stone-800" />
              <div className="h-3 w-1/3 rounded bg-stone-200 dark:bg-stone-800" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
