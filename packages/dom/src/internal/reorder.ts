/**
 * The DOM's **Reorder group** controller (ADR-0020): the framework-free half of
 * `<Reorder>`, shared by every DOM binding. A binding adds only its reactivity, its
 * lifecycle and its elements.
 *
 * It owns core's `Reorder.Group` (the **Crossover** and the new order), reads the
 * group element's `direction` at each drag start, builds the group's **Auto-scroll**,
 * and routes each item's drag samples: the start opens the group's gesture, each move
 * runs the Crossover and Auto-scroll, the end (or the item's disposal mid-gesture)
 * closes both. The items' `touch-action` needs the axis before a touch starts, so after
 * every Measure pass the controller detects the axis from the items' boxes and reports
 * a change through `onAxis`; while the app sets the axis it detects nothing. Motion
 * detects on every item's every measurement (Group.tsx:121-133 at 16c6122).
 *
 * It also runs each item's **Keyboard reorder** (ADR-0037), on by default: a key from the item
 * itself that the page didn't take (Space or Enter lifts and drops, Escape cancels, the arrows,
 * Home and End move the lifted item) goes to core's `Reorder` model, its default prevented; each
 * step is an **Announcement** (a held arrow's thinned to the last), scrolls the item's new place
 * into view after the Measure pass that lays it out, and keeps focus on the item; the lifted node is
 * raised as a dragged one is, and the binding turns its `whileDrag` on. Focus leaving the item, a
 * press on it, or the app changing `values` drops it where it is; its unmount ends the lift unsaid.
 * `move` announces too. Nothing is announced without an `announce`.
 *
 * Observability: `wardic.reorder:` debug logs through the runtime, annotated: the
 * group's and Auto-scroll's events, and `axis` when the detected axis changes (cold
 * path: never per sample), plus one warning per controller for a remount (below).
 *
 * Tier 2 (ADR-0008): for DOM binding authors.
 */
import * as AutoScroll from "@wardic/core/AutoScroll"
import type * as Drag from "@wardic/core/Drag"
import type * as InputSource from "@wardic/core/InputSource"
import * as Reorder from "@wardic/core/Reorder"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import { constVoid } from "effect/Function"
import * as Match from "effect/Match"
import * as MutableRef from "effect/MutableRef"
import * as Option from "effect/Option"
import { documentOf, prepareAnnouncer } from "./announcer.ts"
import { type AutoScroller, makeAutoScroller } from "./auto-scroll.ts"
import { onPassEnd, type ProjectionNodeHandle, type ProjectionSystem } from "./projection.ts"
import { revealLayoutOf } from "./reveal.ts"
import type { Runner } from "./runner.ts"

/**
 * The group element's style: no scroll anchoring, so the browser doesn't shift the
 * page as items move (Motion's Group.tsx:187-195 at 16c6122). The user's style goes
 * over it.
 */
export const REORDER_GROUP_STYLE = Object.freeze({ "overflow-anchor": "none" } as const)

/**
 * What {@link makeReorderController} runs on: the runner it logs through, the projection system the
 * items are nodes of, and the Environment's `Announcer`. `ReorderController.make` takes them from
 * its context (#132's PR 3, ADR-0041).
 */
export interface ReorderControllerWiring {
  /** The runner the controller logs through. */
  readonly runtime: Pick<Runner<never>, "runFork">
  /** The projection system the items are nodes of. */
  readonly projection: Omit<ProjectionSystem, "dispose">
  /** Speak an **Announcement**: the Environment's `Announcer`. Left out, nothing is announced. */
  readonly announce?: ((message: string) => void) | undefined
}

/** {@link makeReorderController}'s options: what a binding hands its group. */
export interface ReorderControllerOptions<V> {
  /** The app's values, in order. */
  readonly values: () => ReadonlyArray<V>
  /** Receives a new order; the app sets `values` from it. */
  readonly onReorder: (values: Array<V>) => void
  /** The app's axis, overriding detection; `undefined` to detect. */
  readonly axis?: (() => Reorder.Axis | undefined) | undefined
  /** Called when the detected axis changes (after a Measure pass, or {@link ReorderController.resolve}). */
  readonly onAxis?: ((axis: Reorder.Axis) => void) | undefined
  /**
   * How the binding keys its items, for the warning logged once per controller when an
   * item registers with a value an item of this group unregistered in the same task
   * (the signature of a list keyed by index): "key items with `keyedWith`". Solid's is
   * `"<For>"`; by default "their value".
   */
  readonly keyedWith?: string | undefined
  /** Whether the items reorder by keyboard (ADR-0037), read at each key; `false` turns it off. On when left out. */
  readonly keyboard?: (() => boolean) | undefined
  /** The group's announcements over the defaults (ADR-0037), read at each announcement. */
  readonly announcements?: (() => Partial<Reorder.Announcements<V>> | undefined) | undefined
}

/** One item of a {@link ReorderController}: its binding feeds it the item's handle, drag samples, keys, focus and presses. */
export interface ReorderItemDriver {
  /** Register the item's projection handle with the group; returns the unregister. */
  readonly register: (handle: ProjectionNodeHandle) => () => void
  /** The axis the item's drag takes, read at each gesture's start. */
  readonly dragAxis: () => Reorder.Axis
  /** The item's drag samples, as the drag delivers them. */
  readonly onSample: (sample: Drag.Sample) => void
  /** A key at the item or inside it (ADR-0037), inside its dispatch: a keyboard reorder's. */
  readonly onKey: (event: InputSource.KeyboardLikeEvent) => void
  /** Focus left the item: a lift drops where it is, unless focus is back on the item (ADR-0037). */
  readonly onBlur: () => void
  /** A press on the item: a lift drops where it is, before any drag (ADR-0037). */
  readonly onPress: () => void
  /** The item is going away: end a gesture or a lift still in progress. */
  readonly dispose: () => void
}

/** How long a held arrow's announcements wait for the next repeat, in ms: only the last is spoken (ADR-0037, Q4). */
export const REPEAT_ANNOUNCE_MS = 150

/**
 * A Reorder item's default instructions on the web (ADR-0037, the NVDA pass): core's keys, and
 * focus mode. A screen reader in browse mode (NVDA's, JAWS's) keeps Space and the arrows for itself
 * until its user switches to focus mode, and it doesn't switch by itself on a list item.
 */
export const DEFAULT_REORDER_INSTRUCTIONS = `${Reorder.DEFAULT_INSTRUCTIONS} Some screen readers need focus mode for these keys.`

/** How an item is spoken: its `aria-label`, else its text with its whitespace collapsed, else its value. */
const labelOf = (element: Element | undefined, value: unknown): string => {
  const aria = element?.getAttribute("aria-label")?.trim()
  if (aria !== undefined && aria !== "") return aria
  const text = element?.textContent?.replace(/\s+/g, " ").trim()
  if (text !== undefined && text !== "") return text
  return String(value)
}

/** A **Reorder group** on the DOM (ADR-0020). */
export interface ReorderController<V> {
  /** Core's Reorder group (`Reorder.move(group, value, toIndex)` reorders in code). */
  readonly group: Reorder.Group<V>
  /** The app's axis, else the last detected one (`"y"` before the first). */
  readonly axis: () => Reorder.Axis
  /** The group's element: its `direction`, and the scroller Auto-scroll looks for from it. */
  readonly attach: (element: Element) => void
  /**
   * The driver for the item with `value`; `element` is its element (for Auto-scroll, its label, its
   * focus and its reveal), and `onLift` hears its keyboard lift start and end (the binding's `whileDrag`).
   */
  readonly item: (value: V, element: () => Element | undefined, onLift?: (lifted: boolean) => void) => ReorderItemDriver
  /** Move `value` to `toIndex` in code (`Reorder.move`), and announce it (ADR-0037). */
  readonly move: (value: V, toIndex: number) => void
  /** Detect the axis now (after the app's axis is cleared). */
  readonly resolve: () => void
  /** The app's values changed: re-measure, so the items animate to their slots. */
  readonly valuesChanged: () => void
  /** Stop listening to Measure passes and end Auto-scroll. */
  readonly dispose: () => void
}

/** Build a {@link ReorderController}: a **Reorder group** over `wiring.projection`'s nodes. */
export const makeReorderController = <V>(wiring: ReorderControllerWiring, options: ReorderControllerOptions<V>): ReorderController<V> => {
  const { runtime, projection, announce } = wiring
  const debug = (event: string, annotations: Record<string, unknown>): void => {
    runtime.runFork(Effect.logDebug(`wardic.reorder: ${event}`).pipe(Effect.annotateLogs(annotations)))
  }
  let element: Element | undefined
  let autoScroller: AutoScroller | undefined
  // The order the group last asked for: a `values` change to anything else is the app's own (ADR-0037).
  let asked: ReadonlyArray<V> | undefined
  const group = Reorder.make<V>({
    values: options.values,
    onReorder: (values) => {
      asked = values
      options.onReorder(values)
    },
    axis: () => Option.flatMap(Option.fromUndefinedOr(options.axis), (axis) => Option.fromUndefinedOr(axis())),
    // Read once per drag start (Motion reads it on every sample, Group.tsx:142-147 at 16c6122).
    direction: () => (element !== undefined && getComputedStyle(element).direction === "rtl" ? "rtl" : "ltr"),
    debug,
  })

  let detected: Reorder.Axis = "y"
  let reported: Reorder.Axis | undefined
  const resolve = (): void => {
    if (options.axis?.() !== undefined) return
    detected = Reorder.resolveAxis(group)
    if (detected === reported) return
    reported = detected
    debug("axis", { axis: detected })
    options.onAxis?.(detected)
  }
  // --- The keyboard reorder (ADR-0037) ---------------------------------------
  /** The lifted item's element, its handle and its `onLift`, by value, while it's registered. */
  interface Keyed {
    readonly element: () => Element | undefined
    handle: ProjectionNodeHandle | undefined
    readonly onLift: (lifted: boolean) => void
  }
  const keyed = new Map<V, Keyed>()
  // The item whose new place the next Measure pass lays out, to scroll into view then.
  let reveal: V | undefined
  // A held arrow's latest announcement, waiting for the next repeat.
  let pendingAnnouncement: ReturnType<typeof setTimeout> | undefined

  const announceNow = (message: string): void => {
    if (pendingAnnouncement !== undefined) clearTimeout(pendingAnnouncement)
    pendingAnnouncement = undefined
    announce?.(message)
  }
  /** A held arrow's step: spoken once the repeats stop for {@link REPEAT_ANNOUNCE_MS}, only the last. */
  const announceLater = (message: string): void => {
    if (pendingAnnouncement !== undefined) clearTimeout(pendingAnnouncement)
    pendingAnnouncement = setTimeout(() => {
      pendingAnnouncement = undefined
      announce?.(message)
    }, REPEAT_ANNOUNCE_MS)
  }
  const wording = (): Reorder.Announcements<V> => ({ ...(Reorder.defaultAnnouncements as Reorder.Announcements<V>), ...options.announcements?.() })
  const say = (kind: keyof Reorder.Announcements<V>, value: V, placement: Reorder.Placement): string =>
    wording()[kind]({ value, label: labelOf(keyed.get(value)?.element(), value), position: placement.position, count: placement.count })

  /** Raise the lifted item (or lower it) and tell its binding (its `whileDrag`). */
  const setLifted = (value: V, lifted: boolean): void => {
    const k = keyed.get(value)
    k?.handle?.lift(lifted)
    k?.onLift(lifted)
  }
  /** Drop the lifted item where it is and announce it: a drop key, or an interruption. */
  const dropLifted = (): void =>
    Option.match(Reorder.liftedValue(group), {
      onNone: constVoid,
      onSome: (value) => {
        Option.match(Reorder.drop(group, value), { onNone: constVoid, onSome: (placement) => announceNow(say("drop", value, placement)) })
        setLifted(value, false)
      },
    })
  /** Focus back on the lifted item, if a reorder took it (moving a focused node can blur it), without scrolling. */
  const keepFocus = (value: V): void => {
    const el = keyed.get(value)?.element()
    if (el === undefined || el.ownerDocument.activeElement === el) return
    const focusable = el as HTMLElement
    focusable.focus({ preventScroll: true })
  }
  /** Whether focus is on `value`'s element. */
  const focused = (value: V): boolean => {
    const el = keyed.get(value)?.element()
    return el !== undefined && el.ownerDocument.activeElement === el
  }

  const onKeyOf = (value: V) => (event: InputSource.KeyboardLikeEvent): void => {
    if (event.type !== "down") return
    if (options.keyboard?.() === false) return
    // A key the page took, or one from inside the item (a text field), isn't the reorder's.
    if (event.handled) return
    if (Bool.not(event.fromTarget)) return
    // Keys during a pointer drag are left alone.
    if (Option.isSome(MutableRef.get(group.gesture))) return
    const lifted = Option.contains(Reorder.liftedValue(group), value)
    Option.match(Reorder.keyIntent(event.key), {
      onNone: constVoid,
      onSome: (intent) =>
        Match.value(intent).pipe(
          Match.tag("Toggle", () => {
            event.handle()
            if (event.repeat) return
            if (lifted) return dropLifted()
            // Lifting another item drops the one lifted first.
            dropLifted()
            Option.match(Reorder.lift(group, value), {
              onNone: constVoid,
              onSome: (placement) => {
                setLifted(value, true)
                announceNow(say("lift", value, placement))
              },
            })
          }),
          Match.tag("Cancel", () => {
            if (Bool.not(lifted)) return
            event.handle()
            Option.match(Reorder.cancel(group, value), {
              onNone: constVoid,
              onSome: (placement) => {
                setLifted(value, false)
                keepFocus(value)
                if (placement.moved) reveal = value
                announceNow(say("cancel", value, placement))
              },
            })
          }),
          Match.tagsExhaustive({
            Step: (step) => stepLifted(event, value, lifted, step),
            End: (end) => stepLifted(event, value, lifted, end),
          }),
        ),
    })
  }
  /** An arrow, Home or End: the lifted item's step, its announcement (a held arrow's thinned), its reveal. */
  const stepLifted = (event: InputSource.KeyboardLikeEvent, value: V, lifted: boolean, intent: Extract<Reorder.KeyIntent, { readonly _tag: "Step" | "End" }>): void => {
    // Not lifted, the arrows, Home and End keep their own work (scrolling the page).
    if (Bool.not(lifted)) return
    event.handle()
    Option.match(Reorder.step(group, value, intent), {
      onNone: constVoid,
      onSome: (placement) => {
        // A repeat before the last step's Measure pass moved nothing: nothing to say.
        if (placement.waiting) return
        if (placement.moved) {
          reveal = value
          keepFocus(value)
        }
        const message = say("step", value, placement)
        if (event.repeat) announceLater(message)
        else announceNow(message)
      },
    })
  }

  // Every Measure pass measures every node, so its end is when the boxes are fresh, and when a
  // stepped item's new place is laid out.
  const stopPassEnd = onPassEnd(projection, () => {
    resolve()
    const stepped = reveal
    reveal = undefined
    if (stepped === undefined) return
    const el = keyed.get(stepped)?.element()
    if (el !== undefined && el.isConnected) revealLayoutOf(el)
  })

  // Values whose item unregistered in this task, and whether a remount was warned of.
  const unregisteredThisTask = new Set<V>()
  let remountReported = false

  const item = (value: V, itemElement: () => Element | undefined, onLift: (lifted: boolean) => void = constVoid): ReorderItemDriver => {
    // The gesture's axis (core's, fixed at its start), for Auto-scroll's axis.
    let gestureAxis: Reorder.Axis = "y"
    let inGesture = false
    const k: Keyed = { element: itemElement, handle: undefined, onLift }
    keyed.set(value, k)
    const end = (): void => {
      inGesture = false
      Reorder.dragEnd(group, value)
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
        const unregister = Reorder.register(group, value, {
          layoutBox: () => Option.fromUndefinedOr(handle.layoutBox()),
          dragOffset: handle.dragOffset,
          layoutVersion: handle.layoutVersion,
        })
        k.handle = handle
        keyed.set(value, k)
        return () => {
          if (k.handle === handle) k.handle = undefined
          unregister()
          if (unregisteredThisTask.size === 0) queueMicrotask(() => unregisteredThisTask.clear())
          unregisteredThisTask.add(value)
        }
      },
      dragAxis: () => Reorder.resolveAxis(group),
      onSample: (sample) => {
        if (sample.phase === "start") {
          inGesture = true
          gestureAxis = Reorder.dragStart(group, value)
          return
        }
        if (sample.phase === "move") {
          const velocity = Reorder.dragMove(group, value, sample.velocity)
          if (autoScroller !== undefined) {
            const on = AutoScroll.axis(gestureAxis, velocity)
            autoScroller.update(sample.point, on, velocity[on], itemElement())
          }
          return
        }
        end()
      },
      onKey: onKeyOf(value),
      onBlur: () => {
        if (Bool.not(Option.contains(Reorder.liftedValue(group), value))) return
        // A reorder can blur the node it moves; focus was put back on it, so it's no interruption.
        if (focused(value)) return
        dropLifted()
      },
      onPress: () => {
        if (Option.contains(Reorder.liftedValue(group), value)) dropLifted()
      },
      dispose: () => {
        if (inGesture) end()
        // Unmounted while lifted: the lift ends, unsaid.
        if (Option.contains(Reorder.liftedValue(group), value)) Reorder.drop(group, value)
        if (keyed.get(value) === k) keyed.delete(value)
      },
    }
  }

  return {
    group,
    axis: () => options.axis?.() ?? detected,
    attach: (el) => {
      element = el
      autoScroller = makeAutoScroller(el, debug)
      // The live region has to be in the page before the first lift (ADR-0037, Q7).
      if (options.keyboard?.() !== false && announce !== undefined) prepareAnnouncer(documentOf(el))
    },
    item,
    move: (value, toIndex) =>
      Option.match(Reorder.move(group, value, toIndex), {
        onNone: constVoid,
        onSome: (placement) => {
          if (placement.moved) announceNow(say("move", value, placement))
        },
      }),
    resolve,
    valuesChanged: () => {
      // The app changed `values` itself while an item is lifted: it's dropped at its new place.
      if (Option.isSome(Reorder.liftedValue(group)) && options.values() !== asked) dropLifted()
      projection.notify()
    },
    dispose: () => {
      stopPassEnd()
      autoScroller?.reset()
      if (pendingAnnouncement !== undefined) clearTimeout(pendingAnnouncement)
    },
  }
}

const noop = (): void => {}

/**
 * A {@link ReorderController} for a server render (ADR-0021), where there's no projection
 * system to drive and nothing to reorder: its group has no values, so every operation on it
 * does nothing, the axis is `"y"`, and an item's driver is inert too. A binding's server path hands it to its group, so code
 * that reads `group`, `move` or `controller` at setup works there. Tier 2, for binding
 * authors.
 */
export const INERT_REORDER_CONTROLLER: ReorderController<never> = Object.freeze({
  // A group with no values: every operation on it finds nothing to do.
  group: Reorder.make<never>({ values: () => [], onReorder: noop }),
  axis: () => "y" as const,
  attach: noop,
  item: () => ({ register: () => noop, dragAxis: () => "y" as const, onSample: noop, onKey: noop, onBlur: noop, onPress: noop, dispose: noop }),
  move: noop,
  resolve: noop,
  valuesChanged: noop,
  dispose: noop,
})

