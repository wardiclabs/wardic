/**
 * Scenario 6: an IntersectionObserver callback writes the `layoutDependency`
 * signal.
 *
 * The stage holds two absolutely positioned things that cannot move each other:
 * on the left a small fixed-size scroll container (96x128, `overflow: auto`) whose
 * 480px-tall content carries a sentinel 240px down, and on the right the watched
 * 64x64 `wardic.div` with `layout`, which is NOT inside the scroll container. Run
 * only scrolls the container (scrollTop 0 or 200), which flips whether the sentinel
 * intersects it. The app's IntersectionObserver (root = the scroll container) then
 * moves the box 96px sideways (left 136px or 232px) through the signal bound to its
 * `left` and `layoutDependency`, so repeated runs alternate. Scrolling the
 * container by hand takes the same path and starts a run too.
 *
 * @module
 */
import { wardic } from "@wardic/solid"
import { createSignal, type JSX, onCleanup, onMount } from "solid-js"
import type { ScenarioDef } from "./types.ts"

/** The scenario id, also the View root's `data-scenario` value. */
const ID = "io-callback"

/** The View root: the stage with the Run button under it. */
const ROOT_STYLE: JSX.CSSProperties = {
  display: "flex",
  "flex-direction": "column",
  "align-items": "flex-start",
  gap: "8px",
}

/** The scroll container: fixed 96x128 at the stage's left, scrollable on y. */
const SCROLLER_STYLE: JSX.CSSProperties = {
  position: "absolute",
  top: "16px",
  left: "16px",
  width: "96px",
  height: "128px",
  "overflow-x": "hidden",
  "overflow-y": "auto",
  border: "1px dashed var(--lab-border)",
  "border-radius": "4px",
}

/** The scroll content: 480px tall, the positioning context for the sentinel. */
const CONTENT_STYLE: JSX.CSSProperties = {
  position: "relative",
  height: "480px",
}

/**
 * The sentinel: 240px down the content. At scrollTop 0 the viewport shows content
 * 0-126px (out of view); at {@link SCROLL_IN} it shows 200-326px (in view).
 */
const SENTINEL_STYLE: JSX.CSSProperties = {
  position: "absolute",
  top: "240px",
  left: "8px",
  width: "48px",
  height: "32px",
  "border-radius": "4px",
  background: "var(--lab-box-alt)",
}

/** The scrollTop that brings the sentinel into the container's view. */
const SCROLL_IN = 200

/**
 * The box's absolute position for state A or B. Both keep the 64x64 box inside the
 * 320x160 stage and clear of the scroll container (left 136px or 232px, top 48px),
 * 96px apart.
 */
const boxStyle = (atB: boolean): JSX.CSSProperties => ({
  position: "absolute",
  top: "48px",
  left: atB ? "232px" : "136px",
})

/**
 * The scenario View. Run drops a `scroll` note and scrolls the container so the
 * sentinel's `isIntersecting` flips. The IntersectionObserver callback marks the
 * `io` trigger, then writes the box signal to match the state it observed. Run
 * stays disabled until the observer's initial delivery has recorded the start
 * state.
 */
const View: ScenarioDef["View"] = (props) => {
  const [atB, setAtB] = createSignal(false)
  const [ready, setReady] = createSignal(false)
  let scroller: HTMLDivElement | undefined
  let sentinel: HTMLDivElement | undefined
  let observer: IntersectionObserver | undefined

  // The sentinel's last delivered state. observe() always makes one delivery for
  // the starting state: it only records it and starts no run.
  let intersecting = false
  let initialDelivery = true

  onMount(() => {
    if (scroller === undefined || sentinel === undefined) return
    observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.at(-1)
        if (entry === undefined) return
        if (initialDelivery) {
          initialDelivery = false
          intersecting = entry.isIntersecting
          setReady(true)
          return
        }
        // No flip since the last delivery, so there is no move to make.
        if (entry.isIntersecting === intersecting) return
        intersecting = entry.isIntersecting
        props.ctx.markTrigger("io")
        setAtB(intersecting)
      },
      { root: scroller },
    )
    observer.observe(sentinel)
  })
  onCleanup(() => observer?.disconnect())

  const run = (): void => {
    if (scroller === undefined) return
    props.ctx.mark("scroll")
    scroller.scrollTop = intersecting ? 0 : SCROLL_IN
  }

  return (
    <div data-scenario={ID} style={ROOT_STYLE}>
      <div class="stage">
        <div ref={scroller} style={SCROLLER_STYLE}>
          <div style={CONTENT_STYLE}>
            <div ref={sentinel} style={SENTINEL_STYLE} />
          </div>
        </div>
        <wardic.div
          ref={(el) => props.ctx.watch(el)}
          class="box"
          layout
          layoutDependency={atB()}
          style={boxStyle(atB())}
        />
      </div>
      <button type="button" class="btn" data-action="run" disabled={!ready()} onClick={run}>
        Run
      </button>
    </div>
  )
}

/**
 * Scenario 6, IntersectionObserver callback: an IO whose root is a scroll container
 * inside the stage writes the `layoutDependency` signal when a scroll flips its
 * sentinel. Expected to be safe, holding 0: the notification is an ordinary task.
 */
export const s6: ScenarioDef = {
  id: ID,
  index: 6,
  title: "IntersectionObserver callback",
  mechanism:
    "An IntersectionObserver (root = a scroll container) writes the layoutDependency signal after the click scrolls its sentinel in or out.",
  prediction: "safe",
  expectedHeld: 0,
  rationale:
    "The browser computes intersections during the rendering update, then queues the IntersectionObserver " +
    "notification as a task. The callback's signal write, and the Measure pass its notify queues, therefore " +
    "happen in an ordinary task: the pass runs in a microtask at the end of it and flushes its seed (ADR-0018), " +
    "and the next frame's tick takes the first step, painted in that frame (ADR-0033), so the first painted frame " +
    "is already one step along (held 0, cold or warm).",
  View,
}
