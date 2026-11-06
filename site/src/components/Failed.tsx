/**
 * What failed to render, said in its place (#618, S3): an `<Errored>` boundary's fallback, with the
 * error's message and a way to try again. The page's boundary keeps the sidebar; a demo's keeps the page.
 */
export function Failed(props: { readonly what: string; readonly error: unknown; readonly retry: () => void }) {
  return (
    <div class="failed" role="alert">
      <p>
        <strong>{props.what} failed to render.</strong> {props.error instanceof Error ? props.error.message : String(props.error)}
      </p>
      <button type="button" class="failed-retry" onClick={() => props.retry()}>
        Try again
      </button>
    </div>
  )
}
