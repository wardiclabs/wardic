/**
 * The DOM's **Reorder group** controller (ADR-0020): the framework-free half of
 * `<Reorder>`, shared by every DOM binding. A binding adds only its reactivity, its
 * lifecycle and its elements.
 *
 * It owns core's `makeReorderGroup` (the **Crossover** and the new order), reads the
 * group element's `direction` at each drag start, builds the group's **Auto-scroll**,
 * and routes each item's drag samples: the start opens the group's gesture, each move
 * runs the Crossover and Auto-scroll, the end (or the item's disposal mid-gesture)
 * closes both. The items' `touch-action` needs the axis before a touch starts, so after
 * every Measure pass the controller detects the axis from the items' boxes and reports
 * a change through `onAxis`; while the app sets the axis it detects nothing. Motion
 * detects on every item's every measurement (Group.tsx:121-133 at 16c6122).
 *
 * Observability: `wardic.reorder:` debug logs through the runtime, annotated: the
 * group's and Auto-scroll's events, and `axis` when the detected axis changes (cold
 * path: never per sample), plus one warning per controller for a remount (below).
 *
 * Tier 2 (ADR-0008): for DOM binding authors.
 */
import { autoScrollAxis, type DragSample, makeReorderGroup, type Point, type ReorderAxis, type ReorderGroup } from "@wardic/core"
import * as Effect from "effect/Effect"
import { type AutoScroller, makeAutoScroller } from "./auto-scroll.ts"
import { onPassEnd, type ProjectionNodeHandle, type ProjectionRuntime, type ProjectionSystem } from "./projection.ts"

/**
 * The group element's style: no scroll anchoring, so the browser doesn't shift the
 * page as items move (Motion's Group.tsx:187-195 at 16c6122). The user's style goes
 * over it.
 */
export const REORDER_GROUP_STYLE = Object.freeze({ "overflow-anchor": "none" } as const)

/** {@link makeReorderController}'s options. */
export interface ReorderControllerOptions<V> {
  /** The runtime the controller logs through (the projection system's). */
  readonly runtime: ProjectionRuntime
  /** The projection system the items are nodes of. */
  readonly projection: ProjectionSystem
  /** The app's values, in order. */
  readonly values: () => ReadonlyArray<V>
  /** Receives a new order; the app sets `values` from it. */
  readonly onReorder: (values: Array<V>) => void
  /** The app's axis, overriding detection; `undefined` to detect. */
  readonly axis?: (() => ReorderAxis | undefined) | undefined
  /** Called when the detected axis changes (after a Measure pass, or {@link ReorderController.resolve}). */
  readonly onAxis?: ((axis: ReorderAxis) => void) | undefined
  /**
   * How the binding keys its items, for the warning logged once per controller when an
   * item registers with a value an item of this group unregistered in the same task
   * (the signature of a list keyed by index): "key items with `keyedWith`". Solid's is
   * `"<For>"`; by default "their value".
   */
  readonly keyedWith?: string | undefined
}

/** One item of a {@link ReorderController}: its binding feeds it the item's handle and drag samples. */
export interface ReorderItemDriver {
  /** Register the item's projection handle with the group; returns the unregister. */
  readonly register: (handle: ProjectionNodeHandle) => () => void
  /** The axis the item's drag takes, read at each gesture's start. */
  readonly dragAxis: () => ReorderAxis
  /** The item's drag samples, as the drag delivers them. */
  readonly onSample: (sample: DragSample) => void
  /** The item is going away: end a gesture still in progress. */
  readonly dispose: () => void
}

/** A **Reorder group** on the DOM (ADR-0020). */
export interface ReorderController<V> {
  /** Core's Reorder group (its `move(value, toIndex)` reorders in code). */
  readonly group: ReorderGroup<V>
  /** The app's axis, else the last detected one (`"y"` before the first). */
  readonly axis: () => ReorderAxis
  /** The group's element: its `direction`, and the scroller Auto-scroll looks for from it. */
  readonly attach: (element: Element) => void
  /** The driver for the item with `value`; `element` is its element, for Auto-scroll. */
  readonly item: (value: V, element: () => Element | undefined) => ReorderItemDriver
  /** Detect the axis now (after the app's axis is cleared). */
  readonly resolve: () => void
  /** The app's values changed: re-measure, so the items animate to their slots. */
  readonly valuesChanged: () => void
  /** Stop listening to Measure passes and end Auto-scroll. */
  readonly dispose: () => void
}

/** Build a {@link ReorderController}: a **Reorder group** over `options.projection`'s nodes. */
export const makeReorderController = <V>(options: ReorderControllerOptions<V>): ReorderController<V> => {
  const { runtime } = options
  const debug = (event: string, annotations: Record<string, unknown>): void => {
    runtime.runFork(Effect.logDebug(`wardic.reorder: ${event}`).pipe(Effect.annotateLogs(annotations)))
  }
  let element: Element | undefined
  let autoScroller: AutoScroller | undefined
  const group = makeReorderGroup<V>({
    values: options.values,
    onReorder: options.onReorder,
    axis: options.axis,
    // Read once per drag start (Motion reads it on every sample, Group.tsx:142-147 at 16c6122).
    direction: () => (element !== undefined && getComputedStyle(element).direction === "rtl" ? "rtl" : "ltr"),
    debug,
  })

  let detected: ReorderAxis = "y"
  let reported: ReorderAxis | undefined
  const resolve = (): void => {
    if (options.axis?.() !== undefined) return
    detected = group.resolveAxis()
    if (detected === reported) return
    reported = detected
    debug("axis", { axis: detected })
    options.onAxis?.(detected)
  }
  // Every Measure pass measures every node, so its end is when the boxes are fresh.
  const stopPassEnd = onPassEnd(options.projection, resolve)

  // Values whose item unregistered in this task, and whether a remount was warned of.
  const unregisteredThisTask = new Set<V>()
  let remountReported = false

  const item = (value: V, itemElement: () => Element | undefined): ReorderItemDriver => {
    // The gesture's axis (core's, fixed at its start), for Auto-scroll's axis.
    let gestureAxis: ReorderAxis = "y"
    let inGesture = false
    const end = (): void => {
      inGesture = false
      group.dragEnd(value)
      autoScroller?.reset()
    }
    return {
      register: (handle) => {
        if (!remountReported && unregisteredThisTask.has(value)) {
          remountReported = true
          runtime.runFork(
            Effect.logWarning(
              `wardic.reorder: an item remounted with the same value in one task (key items with ${options.keyedWith ?? "their value"})`,
            ).pipe(Effect.annotateLogs({ value: String(value) })),
          )
        }
        const unregister = group.register(value, handle)
        return () => {
          unregister()
          if (unregisteredThisTask.size === 0) queueMicrotask(() => unregisteredThisTask.clear())
          unregisteredThisTask.add(value)
        }
      },
      dragAxis: () => group.resolveAxis(),
      onSample: (sample) => {
        if (sample.phase === "start") {
          inGesture = true
          gestureAxis = group.dragStart(value, sample.point, sample.timeStamp)
          return
        }
        if (sample.phase === "move") {
          const velocity = group.dragMove(value, sample.point, sample.timeStamp)
          if (autoScroller !== undefined) {
            const on = autoScrollAxis(gestureAxis, velocity)
            autoScroller.update(sample.point, on, velocity[on], itemElement())
          }
          return
        }
        end()
      },
      dispose: () => {
        if (inGesture) end()
      },
    }
  }

  return {
    group,
    axis: () => options.axis?.() ?? detected,
    attach: (el) => {
      element = el
      autoScroller = makeAutoScroller(el, debug)
    },
    item,
    resolve,
    valuesChanged: () => options.projection.notify(),
    dispose: () => {
      stopPassEnd()
      autoScroller?.reset()
    },
  }
}

const noop = (): void => {}

/**
 * A {@link ReorderController} for a server render (ADR-0021), where there's no projection
 * system to drive and nothing to reorder: every call does nothing, the axis is `"y"`, and
 * an item's driver is inert too. A binding's server path hands it to its group, so code
 * that reads `group`, `move` or `controller` at setup works there. Tier 2, for binding
 * authors.
 */
export const INERT_REORDER_CONTROLLER: ReorderController<never> = Object.freeze({
  group: Object.freeze({
    register: () => noop,
    resolveAxis: () => "y" as const,
    dragStart: () => "y" as const,
    dragMove: (_value: never, point: Point) => point,
    dragEnd: noop,
    move: noop,
  }),
  axis: () => "y" as const,
  attach: noop,
  item: () => ({ register: () => noop, dragAxis: () => "y" as const, onSample: noop, dispose: noop }),
  resolve: noop,
  valuesChanged: noop,
  dispose: noop,
})

