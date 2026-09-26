/**
 * Copy-log: copies the lab log (every kept run plus environment metadata) as
 * pretty-printed JSON. When the clipboard API is missing or rejects (an insecure
 * origin, a denied permission), the same JSON is shown in a read-only textarea.
 *
 * @module
 */
import { createSignal, type JSX, Show } from "solid-js"
import type { Lab } from "../lab/lab.ts"

/** Props are static values; `frameStretchMs` is a tracked prop getter. */
export interface CopyLogProps {
  readonly lab: Lab
  /** The current frame-stretch value, recorded in the log. */
  readonly frameStretchMs: number
}

/** Renders the copy-log panel. */
export const CopyLog = (props: CopyLogProps): JSX.Element => {
  const [status, setStatus] = createSignal("")
  const [fallback, setFallback] = createSignal<string | undefined>(undefined)

  const copy = (): void => {
    const log = props.lab.log({ frameStretchMs: props.frameStretchMs })
    const json = JSON.stringify(log, null, 2)
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
        setStatus(`Copied ${log.runs.length} run${log.runs.length === 1 ? "" : "s"}.`)
      },
      showFallback,
    )
  }

  return (
    <section class="panel">
      <header class="panel-head">
        <h2>Log</h2>
        <button type="button" class="btn small" onClick={copy}>
          Copy log JSON
        </button>
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
