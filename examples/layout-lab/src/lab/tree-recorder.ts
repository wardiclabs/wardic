/**
 * The projection tree, recorded (#384): the engine's `toJSON()` snapshot after each painted frame
 * while Wardic's Clock runs, which is whenever something animates, from a run, a drag, a release or a
 * board. Plain data, with nothing drawn while it records, so a run's frame checks are untouched: the
 * panel draws a recording once it's ended.
 *
 * - **A state per change:** consecutive frames whose tree reads the same make one state, with its
 *   first and last frame, so a recording holds one state per change and grows nothing at rest.
 * - **When one ends:** when the Clock stops, its last state is the tree at rest. It also ends after
 *   {@link QUIET_FRAMES} frames with no change, so a Clock kept warm (the lab's switch) still splits
 *   its runs. Only a recording in which something changed is kept.
 *
 * @module
 */
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import type { PostPaintTicker } from "../probe/paint-sampler.ts"
import type { Timeline } from "../probe/timeline.ts"

type Tree = ProjectionSystem.Tree

/** The Clock's span: open while Wardic's frame loop runs. */
const CLOCK_SPAN = "wardic.clock"
/** Frames with no change that end a recording while the Clock still runs. */
export const QUIET_FRAMES = 30
/** The most states one recording holds: a guard, far past any scene's. */
const MAX_STATES = 2000

/** One state of the tree: the frames it was painted in, and when the first was. */
export interface TreeState {
  readonly fromFrame: number
  readonly toFrame: number
  /** The first frame's post-paint time, in ms. */
  readonly at: number
  readonly snapshot: Tree
}

/** One recording: the tree's states, in order, the last at rest when the Clock stopped. */
export interface TreeRecording {
  readonly states: ReadonlyArray<TreeState>
}

/** The recorder. */
export interface TreeRecorder {
  /** Read the tree through `read` from now on (the provider's engine); the returned function stops. */
  readonly attach: (read: () => Tree) => () => void
  /** The tree now, if attached: the panel's at-rest snapshot. */
  readonly now: () => Tree | undefined
  /** The last recording kept. */
  readonly last: () => TreeRecording | undefined
  /** Called with each recording kept. */
  readonly subscribe: (cb: (recording: TreeRecording) => void) => () => void
}

/** What tells two trees apart: each node's links and flags, cheaper than its JSON each frame. */
const keyOf = (snapshot: Tree): string =>
  snapshot.nodes
    .map(
      (n) =>
        `${n.id}>${n.parent ?? ""}>${n.lead ?? ""}>${n.twin ?? ""}` +
        `${+n.layoutRoot}${+n.animating}${+n.dragging}${+n.releasing}${+n.leaving}`,
    )
    .join("|")

/** Builds the recorder on the lab's post-paint ticker. Call it once. */
export const makeTreeRecorder = (ticker: PostPaintTicker, timeline: Timeline): TreeRecorder => {
  let read: (() => Tree) | undefined
  // The recording in progress: its states, the last one's key, and the frames since it changed.
  let current: { states: Array<TreeState>; key: string; quiet: number } | undefined
  let last: TreeRecording | undefined
  const listeners = new Set<(recording: TreeRecording) => void>()

  const end = (): void => {
    const states = current?.states ?? []
    current = undefined
    if (states.length < 2) return
    last = { states }
    for (const cb of listeners) {
      try {
        cb(last)
      } catch (error) {
        console.error("layout-lab: a tree listener threw", error)
      }
    }
  }

  ticker.onPostPaint((t, frame) => {
    if (read === undefined) return
    const running = timeline.openCount(CLOCK_SPAN) > 0
    if (!running && current === undefined) return
    const snapshot = read()
    const key = keyOf(snapshot)
    if (current === undefined) current = { states: [], key: "", quiet: 0 }
    const states = current.states
    const lastState = states[states.length - 1]
    if (lastState !== undefined && key === current.key) {
      states[states.length - 1] = { ...lastState, toFrame: frame }
      current.quiet += 1
    } else if (states.length < MAX_STATES) {
      states.push({ fromFrame: frame, toFrame: frame, at: t, snapshot })
      current.key = key
      current.quiet = 0
    }
    if (!running || current.quiet >= QUIET_FRAMES) end()
  })

  return {
    attach: (from) => {
      read = from
      return () => {
        if (read === from) read = undefined
      }
    },
    now: () => read?.(),
    last: () => last,
    subscribe: (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
  }
}
