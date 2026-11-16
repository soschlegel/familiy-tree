export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-3 py-12 muted">
      <span
        aria-hidden
        className="h-4 w-4 animate-spin rounded-full border-2 border-stone-300 border-t-stone-600 dark:border-stone-700 dark:border-t-stone-300"
      />
      Wird geladen…
    </div>
  );
}
