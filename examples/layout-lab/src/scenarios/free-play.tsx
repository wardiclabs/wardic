/**
 * Free play: a sandbox that combines a trigger timing, a mutation and a notify
 * path.
 *
 * The watched element is a `wardic.div` with `layout`, absolutely positioned
 * inside the stage (top 24px, left 24px or 184px, 160px apart). Its size comes
 * from its content: an inner block of 64x64 or 112x112 (48px apart), so the box
 * stays inside the 320x160 stage in every state. Three selects, read when Run is
 * pressed, pick:
 *
 * - Timing: when the write runs (sync in the click, queueMicrotask, setTimeout(0),
 *   rAF, or double rAF).
 * - Mutation: move (toggle `left`), resize (toggle the inner block's size), or
 *   both.
 * - Notify path: `layoutDependency` bumps a counter bound to the box's
 *   `layoutDependency` along with the write. `content-only` writes the same
 *   geometry and leaves `layoutDependency` alone, so only Wardic's shared
 *   ResizeObserver can notice. A pure move leaves the box's size unchanged, so
 *   under `content-only` it is expected to be missed: the box jumps with no FLIP.
 *   Wardic still holds the box it last measured, so the next measured run FLIPs
 *   from that stale box, not from where the box was painted.
 *
 * Whatever the selection, `ctx.markTrigger('<timing>/<mutation>/<path>')` runs
 * immediately before the write, in the execution context the timing names.
 *
 * @module
 */
import { wardic } from "@wardic/solid"
import { batch, createSignal, type JSX, onCleanup } from "solid-js"
import { CONTROLS_STYLE, NOTE_STYLE, type Option, Select } from "./controls.tsx"
import type { ScenarioDef } from "./types.ts"

/** The scenario id, also the View root's `data-scenario` value. */
const ID = "free-play"

/** When the write runs, relative to the Run click. */
type Timing = "sync" | "microtask" | "timeout" | "raf" | "double-raf"

/** Which geometry the write changes. */
type Mutation = "move" | "resize" | "move+resize"

/** How Wardic is told about the write. */
type NotifyPath = "layoutDependency" | "content-only"

/** The timing choices, in the order the select lists them. */
const TIMINGS: ReadonlyArray<Option<Timing>> = [
  { value: "sync", label: "sync (in the click)" },
  { value: "microtask", label: "queueMicrotask" },
  { value: "timeout", label: "setTimeout(0)" },
  { value: "raf", label: "rAF" },
  { value: "double-raf", label: "double rAF" },
]

/** The mutation choices, in the order the select lists them. */
const MUTATIONS: ReadonlyArray<Option<Mutation>> = [
  { value: "move", label: "move" },
  { value: "resize", label: "resize" },
  { value: "move+resize", label: "move + resize" },
]

/** The notify-path choices, in the order the select lists them. */
const PATHS: ReadonlyArray<Option<NotifyPath>> = [
  { value: "layoutDependency", label: "layoutDependency" },
  { value: "content-only", label: "content-only (RO)" },
]

/** The View root: the controls, the stage, the Run button and a note, stacked. */
const ROOT_STYLE: JSX.CSSProperties = {
  display: "flex",
  "flex-direction": "column",
  "align-items": "flex-start",
  gap: "8px",
}

/** The box's absolute position for state A or B: top 24px, left 24px or 184px. */
const boxStyle = (atB: boolean): JSX.CSSProperties => ({
  position: "absolute",
  top: "24px",
  left: atB ? "184px" : "24px",
  // Size to content (the inner block) instead of the .box class's fixed 64x64.
  width: "auto",
  height: "auto",
})

/** The inner block that sets the box's size: 64x64 or 112x112. */
const contentStyle = (big: boolean): JSX.CSSProperties => {
  const size = `${big ? 112 : 64}px`
  return { width: size, height: size, flex: "none" }
}

/**
 * The scenario View. Run reads the three selects, cancels any write still pending
 * from an earlier Run, and schedules this write with the chosen timing. The write
 * callback marks the trigger, then applies the mutation (and bumps
 * `layoutDependency` on that path) in one batch.
 */
const View: ScenarioDef["View"] = (props) => {
  const [timing, setTiming] = createSignal<Timing>("sync")
  const [mutation, setMutation] = createSignal<Mutation>("move")
  const [path, setPath] = createSignal<NotifyPath>("layoutDependency")
  const [atB, setAtB] = createSignal(false)
  const [big, setBig] = createSignal(false)
  // Bound to layoutDependency. Only the layoutDependency path bumps it.
  const [dep, setDep] = createSignal(0)

  // The pending scheduled write, if any. A queued microtask cannot be cancelled,
  // so it checks `generation` instead: cancelling bumps it.
  let timer: ReturnType<typeof setTimeout> | undefined
  let rafId: number | undefined
  let generation = 0

  /** Cancels the pending timer, rAF or microtask write, if any. */
  const cancelPending = (): void => {
    generation++
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    if (rafId !== undefined) cancelAnimationFrame(rafId)
    rafId = undefined
  }
  onCleanup(cancelPending)

  /** Applies `m` in one batch, bumping `layoutDependency` only on that path. */
  const write = (m: Mutation, p: NotifyPath): void => {
    batch(() => {
      if (m !== "resize") setAtB((b) => !b)
      if (m !== "move") setBig((b) => !b)
      if (p === "layoutDependency") setDep((d) => d + 1)
    })
  }

  const run = (): void => {
    const t = timing()
    const m = mutation()
    const p = path()
    const label = `${t}/${m}/${p}`
    /** Marks the trigger and writes, in whatever context the timing runs it. */
    const fire = (): void => {
      props.ctx.markTrigger(label)
      write(m, p)
    }
    cancelPending()
    if (t === "sync") {
      fire()
      return
    }
    props.ctx.mark(`schedule ${t}`)
    switch (t) {
      case "microtask": {
        const scheduled = generation
        queueMicrotask(() => {
          if (scheduled === generation) fire()
        })
        break
      }
      case "timeout":
        timer = setTimeout(() => {
          timer = undefined
          fire()
        }, 0)
        break
      case "raf":
        rafId = requestAnimationFrame(() => {
          rafId = undefined
          fire()
        })
        break
      case "double-raf":
        rafId = requestAnimationFrame(() => {
          rafId = requestAnimationFrame(() => {
            rafId = undefined
            fire()
          })
        })
        break
    }
  }

  return (
    <div data-scenario={ID} style={ROOT_STYLE}>
      <div style={CONTROLS_STYLE}>
        <Select
          label="Timing"
          name="free-play-timing"
          options={TIMINGS}
          value={timing()}
          onChange={(v) => setTiming(v)}
        />
        <Select
          label="Mutation"
          name="free-play-mutation"
          options={MUTATIONS}
          value={mutation()}
          onChange={(v) => setMutation(v)}
        />
        <Select label="Notify path" name="free-play-path" options={PATHS} value={path()} onChange={(v) => setPath(v)} />
      </div>
      <div class="stage">
        <wardic.div
          ref={(el) => props.ctx.watch(el)}
          class="box"
          layout
          layoutDependency={dep()}
          style={boxStyle(atB())}
        >
          <div style={contentStyle(big())} />
        </wardic.div>
      </div>
      <button type="button" class="btn" data-action="run" onClick={run}>
        Run
      </button>
      <p style={NOTE_STYLE}>
        content-only + move: a pure move leaves the box's size unchanged, so ResizeObserver never fires and Wardic is
        expected to miss it (the box jumps, no FLIP). The next measured run then FLIPs from the stale box Wardic last
        measured.
      </p>
    </div>
  )
}

/**
 * Free play: a sandbox where Run schedules a move, resize or both with the
 * selected timing and notify path. Its outcome depends on the selection, so the
 * prediction is unknown.
 */
export const freePlay: ScenarioDef = {
  id: ID,
  index: 0,
  title: "Free play",
  mechanism: "Run schedules the selected mutation with the selected timing and notify path.",
  prediction: "unknown",
  rationale:
    "It depends on the selection. A sync, queueMicrotask or setTimeout(0) write happens in an ordinary task (or a " +
    "microtask of one), so its Measure pass runs at the end of that task and the first painted frame is already " +
    "one step along (held 0). A rAF or double-rAF write runs in a rAF callback: after the frame's tick, or in " +
    "a frame with none, the frame paints the origin and the FLIP moves on the next (held 1), while a callback that " +
    "runs before the Clock's tick behaves like a task (held 0). The content-only path waits for the engine's " +
    "ResizeObserver, which delivers after the frame's tick (held 1), and a pure move never changes the box's " +
    "size, so the observer never reports it and Wardic misses it.",
  View,
}
