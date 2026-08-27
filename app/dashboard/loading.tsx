/**
 * Streaming boundary for the student dashboard.
 *
 * Same reasoning as app/admin/loading.tsx: without a boundary anywhere in the
 * tree, Next has to finish every query in the page before it can flush any
 * markup, so the sidebar the layout already knows how to draw waits on data it
 * does not need. This lets the chrome paint first and the page stream in.
 *
 * Neutral tokens (bg-wash / border-line) so it reads correctly in both themes,
 * and the same max-width and rhythm as the real pages so the swap is still.
 */
export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-5xl animate-pulse" aria-hidden>
      <div className="h-9 w-64 rounded bg-wash" />
      <div className="mt-3 h-4 w-full max-w-md rounded bg-wash" />
      <div className="mt-8 grid gap-10 md:grid-cols-12">
        <div className="space-y-3 md:col-span-7">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 rounded-md border border-line" />
          ))}
        </div>
        <div className="space-y-2 md:col-span-5">
          <div className="h-3 w-28 rounded bg-wash" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-11 rounded-md border border-line" />
          ))}
        </div>
      </div>
      <span className="sr-only">Loading</span>
    </div>
  );
}
