/**
 * The Keep Clock warm panel (issue #14). While it is on, a small dot in the panel
 * runs a slow `createWard` spring that never settles, so the shared Clock is already
 * ticking when a scenario runs: every run is then a warm start, the way it is in an
 * app where something else is animating. Each run records which kind it was in
 * `clock` (`cold` / `warm`), so the panel is only a way to produce warm runs on
 * purpose.
 *
 * The spring (stiffness 4, damping 1) takes about 8 s to settle and is retargeted
 * every 2 s, so it is always moving. The dot lives in its own fixed-size track, so
 * it reflows nothing in any scenario's stage.
 *
 * @module
 */
import { type JSX, wardic } from "#binding"
import { createSignal, onCleanup, Show } from "solid-js"

/** How often the background spring is retargeted, in ms: well inside its settle time. */
const RETARGET_MS = 2000

/** Props are static values; `value` is a tracked prop getter. */
export interface KeepClockWarmProps {
  /** Whether the background spring is running. */
  readonly value: boolean
  readonly onChange: (on: boolean) => void
}

export const KeepClockWarm = (props: KeepClockWarmProps): JSX.Element => (
  <section class="panel">
    <header class="panel-head">
      <h2>Keep Clock warm</h2>
      <input
        type="checkbox"
        checked={props.value}
        onChange={(event) => props.onChange(event.currentTarget.checked)}
        aria-label="Keep the Clock warm with a background spring"
      />
    </header>
    <div class="warm-track">
      <Show when={props.value}>
        <WarmDot />
      </Show>
    </div>
    <p class="panel-note">
      Runs a slow background spring so every scenario starts warm. Each run's <code>held</code> shows{" "}
      <code>cold</code> or <code>warm</code>.
    </p>
  </section>
)

/** The background spring: retargeted between the track's ends every {@link RETARGET_MS}. */
const WarmDot = (): JSX.Element => {
  const [far, setFar] = createSignal(true)
  const timer = setInterval(() => setFar((f) => !f), RETARGET_MS)
  onCleanup(() => clearInterval(timer))
  return <wardic.div class="warm-dot" animate={{ x: far() ? 160 : 0 }} transition={{ stiffness: 4, damping: 1 }} />
}
