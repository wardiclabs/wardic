/**
 * The frame-stretch control: a 0-200 ms slider. While it is above zero, every
 * post-paint callback busy-waits that long, so each painted frame (a flash frame
 * included) stays on screen for at least that long and can be seen by eye.
 *
 * The busy-wait runs synchronously in the ticker's post-paint subscriber, after
 * the frame was presented and before the next one can start. It never writes a
 * Solid signal; only user input does.
 *
 * @module
 */
import { type JSX, onCleanup } from "solid-js"
import type { PostPaintTicker } from "../probe/paint-sampler.ts"

/** The slider's upper bound, in ms. */
const MAX_STRETCH_MS = 200

/** Props are static values; `value` is a tracked prop getter. */
export interface FrameStretchProps {
  readonly ticker: PostPaintTicker
  /** The current stretch, in ms. */
  readonly value: number
  readonly onChange: (ms: number) => void
}

/** Renders the slider and installs the post-paint busy-wait. */
export const FrameStretch = (props: FrameStretchProps): JSX.Element => {
  // Read by the per-frame subscriber; kept in a plain variable so the hot path
  // never touches Solid's reactive graph.
  let stretchMs = props.value
  const unsubscribe = props.ticker.onPostPaint(() => {
    if (stretchMs <= 0) return
    const until = performance.now() + stretchMs
    while (performance.now() < until) {
      // Busy-wait: hold the main thread so this painted frame stays on screen.
    }
  })
  onCleanup(unsubscribe)

  const onInput: JSX.EventHandler<HTMLInputElement, InputEvent> = (event) => {
    const ms = Number(event.currentTarget.value)
    stretchMs = ms
    props.onChange(ms)
  }

  return (
    <section class="panel">
      <header class="panel-head">
        <h2>Frame stretch</h2>
        <output class="stretch-value">{props.value} ms</output>
      </header>
      <input
        class="stretch-slider"
        type="range"
        min="0"
        max={MAX_STRETCH_MS}
        step="1"
        value={props.value}
        onInput={onInput}
        aria-label="Frame stretch in milliseconds"
      />
      <p class="panel-note">Holds every painted frame on screen for at least this long, so a one-frame flash is visible.</p>
    </section>
  )
}
