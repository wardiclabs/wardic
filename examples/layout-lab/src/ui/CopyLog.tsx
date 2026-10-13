/**
 * The log panel. Copy-log copies the lab log (every kept run and drag run, plus
 * environment metadata) as pretty-printed JSON. When the clipboard API is missing
 * or rejects (an insecure origin, a denied permission), the same JSON is shown in a
 * read-only textarea. Under `vite dev`, save-log also writes the log to
 * `examples/layout-lab/logs/` through the dev server, which has no size limit
 * the way a paste does.
 *
 * @module
 */
import { createSignal, type JSX, Show } from "solid-js"
import type { Lab, LabLog } from "../lab/lab.ts"

/** Must match `SAVE_LOG_ROUTE` in `vite.config.ts` (not imported: it pulls in `node:fs`). */
const SAVE_LOG_ROUTE = "/__lab/save-log"

/** Props are static values; `frameStretchMs` and `keepClockWarm` are tracked prop getters. */
export interface CopyLogProps {
  readonly lab: Lab
  /** The current frame-stretch value, recorded in the log. */
  readonly frameStretchMs: number
  /** Whether the Keep Clock warm background spring is on. */
  readonly keepClockWarm: boolean
}

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`

/** What a log holds, e.g. `12 runs`, or `12 runs and 3 drag runs and 2 at-rest runs` once there are drag or at-rest runs. */
const contents = (log: LabLog): string => {
  const extra = [
    ...(log.dragRuns.length === 0 ? [] : [plural(log.dragRuns.length, "drag run")]),
    ...(log.restRuns.length === 0 ? [] : [plural(log.restRuns.length, "at-rest run")]),
  ]
  return extra.length === 0 ? plural(log.runs.length, "run") : `${plural(log.runs.length, "run")} and ${extra.join(" and ")}`
}

/** Renders the log panel. */
export const CopyLog = (props: CopyLogProps): JSX.Element => {
  const [status, setStatus] = createSignal("")
  const [fallback, setFallback] = createSignal<string | undefined>(undefined)
  const [saving, setSaving] = createSignal(false)

  const snapshot = () => {
    const log = props.lab.log({ frameStretchMs: props.frameStretchMs, keepClockWarm: props.keepClockWarm })
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
        setStatus(`Copied ${contents(log)}.`)
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
        setStatus(`Saved ${contents(log)} to ${body.path}`)
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
