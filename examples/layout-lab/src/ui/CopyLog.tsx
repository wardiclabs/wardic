/**
 * The log panel. Copy-log copies the lab log (every kept run plus environment
 * metadata) as pretty-printed JSON. When the clipboard API is missing or rejects
 * (an insecure origin, a denied permission), the same JSON is shown in a
 * read-only textarea. Under `vite dev`, save-log also writes the log to
 * `examples/layout-lab/logs/` through the dev server, which has no size limit
 * the way a paste does.
 *
 * @module
 */
import { createSignal, type JSX, Show } from "solid-js"
import type { Lab } from "../lab/lab.ts"

/** Must match `SAVE_LOG_ROUTE` in `vite.config.ts` (not imported: it pulls in `node:fs`). */
const SAVE_LOG_ROUTE = "/__lab/save-log"

/** Props are static values; `frameStretchMs` is a tracked prop getter. */
export interface CopyLogProps {
  readonly lab: Lab
  /** The current frame-stretch value, recorded in the log. */
  readonly frameStretchMs: number
}

const plural = (n: number): string => `${n} run${n === 1 ? "" : "s"}`

/** Renders the log panel. */
export const CopyLog = (props: CopyLogProps): JSX.Element => {
  const [status, setStatus] = createSignal("")
  const [fallback, setFallback] = createSignal<string | undefined>(undefined)
  const [saving, setSaving] = createSignal(false)

  const snapshot = () => {
    const log = props.lab.log({ frameStretchMs: props.frameStretchMs })
    return { log, json: JSON.stringify(log, null, 2) }
  }

  const copy = (): void => {
    const { log, json } = snapshot()
    const showFallback = (): void => {
      setFallback(json)
      setStatus("Clipboard unavailable: select the JSON below.")
    }
    if (typeof navigator.clipboard?.writeText !== "function") {
      showFallback()
      return
    }
    navigator.clipboard.writeText(json).then(
      () => {
        setFallback(undefined)
        setStatus(`Copied ${plural(log.runs.length)}.`)
      },
      showFallback,
    )
  }

  const save = (): void => {
    const { log, json } = snapshot()
    setSaving(true)
    setStatus("Saving…")
    fetch(SAVE_LOG_ROUTE, { method: "POST", headers: { "content-type": "application/json" }, body: json })
      .then(async (response) => {
        const body = (await response.json()) as { path?: string; error?: string }
        if (!response.ok || body.path === undefined) throw new Error(body.error ?? `HTTP ${response.status}`)
        setStatus(`Saved ${plural(log.runs.length)} to ${body.path}`)
      })
      .catch((error: unknown) => setStatus(`Save failed: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => setSaving(false))
  }

  return (
    <section class="panel">
      <header class="panel-head">
        <h2>Log</h2>
        <div class="panel-actions">
          <Show when={import.meta.env.DEV}>
            <button type="button" class="btn small" onClick={save} disabled={saving()}>
              Save log to repo
            </button>
          </Show>
          <button type="button" class="btn small" onClick={copy}>
            Copy log JSON
          </button>
        </div>
      </header>
      <p class="panel-note" aria-live="polite">
        {status()}
      </p>
      <Show when={fallback()}>
        {(json) => <textarea class="log-fallback" readOnly value={json()} rows={10} />}
      </Show>
    </section>
  )
}
