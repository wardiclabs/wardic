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
 * detects on every item's every measurement (Group.tsx:121-133 at 16c6122). When the app
 * clears its axis, no Measure pass comes with that: a binding reads `detect()`, the axis
 * from the boxes the items have now, in the computation that derives its axis, so whatever
 * reads the axis follows in the same update (#257's audit: an effect that detected and
 * reported it updated them a step late).
 *
 * It also runs each item's **Keyboard reorder** (ADR-0037), on by default: a key from the item
 * itself that the page didn't take (Space or Enter lifts and drops, Escape cancels, the arrows,
 * Home and End move the lifted item) goes to core's `Reorder` model, its default prevented; each
 * step is an **Announcement** (a held arrow's thinned to the last), scrolls the item's new place
 * into view after the Measure pass that lays it out, and keeps focus on the item; the lifted node is
 * raised as a dragged one is, and the binding turns its `whileDrag` on. Focus leaving the item, a
 * press on it, or the app changing `values` drops it where it is; its unmount ends the lift unsaid.
 *
 * Each **Reorder hold** (#348, ADR-0020 *Amendment (#348)*), an item in a user's hand from its drag's start or
 * its lift, is told at its start and, once, at its end, whatever ends it: after `onReorderEnd`, when
 * it moved. One at a time: a hold's start ends the open one first, and that item's later release
 * tells nothing more.
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
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as FiberHandle from "effect/FiberHandle"
import { constTrue, constVoid, identity } from "effect/Function"
import * as Match from "effect/Match"
import * as MutableRef from "effect/MutableRef"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Scope from "effect/Scope"
import * as Str from "effect/String"
import * as UndefinedOr from "effect/UndefinedOr"
import { documentOf, prepareAnnouncer } from "./announcer.ts"
import { type AutoScroller, makeAutoScroller } from "./auto-scroll.ts"
import type { ProjectionNodeHandle, ProjectionSystem } from "./projection.ts"
import { debugOf } from "./report.ts"
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
  /** The runner the controller logs through and waits in. */
  readonly runtime: Runner<never>
  /** The projection system the items are nodes of. */
  readonly projection: Omit<ProjectionSystem, "dispose" | "onPassEnd">
  /** Speak an **Announcement**: the Environment's `Announcer`. Left out, nothing is announced. */
  readonly announce?: ((message: string) => void) | undefined
  /** The engine's Measure-pass ends: its `PassEnds` service (internal/pass-ends.ts). */
  readonly onPassEnd: (listener: () => void) => () => void
}

/**
 * A user's reorder that changed the order, at its end: a pointer drag released, or a keyboard lift
 * dropped, with the item at another index than at its start. What an app saves: the whole order, or the
 * one item that moved and where.
 */
// #257 item 3.
export interface ReorderEnd<V> {
  /** The order at the end. */
  readonly values: Array<V>
  /** The item the user moved: the one dragged, or lifted. */
  readonly value: V
  /** Its index at the gesture's start. */
  readonly from: number
  /** Its index at the end. */
  readonly to: number
}

/** A **Reorder hold**'s start: the item taken in hand, by its drag's start or a keyboard lift, and its index then. */
// #348.
export interface ReorderHoldStart<V> {
  /** The item taken in hand. */
  readonly value: V
  /** Its index at the start. */
  readonly from: number
}

/**
 * How a **Reorder hold** ended: `"drop"`, released or dropped where it is (a pointer's release or
 * cancel, a drop key, focus leaving, a press, the app's `values`, another hold); `"cancel"`, Escape, the
 * order put back; `"unmount"`, its item went away.
 */
// #348.
export type ReorderHoldHow = "drop" | "cancel" | "unmount"

/**
 * A **Reorder hold**'s end, whatever ended it, once: the order then, the item, its index at the start
 * and now (`-1` once it's out of the values), and how. After `onReorderEnd`, in the same task, when the
 * order changed.
 */
// #348.
export interface ReorderHoldEnd<V> extends ReorderEnd<V> {
  /** How it ended. */
  readonly how: ReorderHoldHow
}

/** What a binding hands its group's controller. */
export interface ReorderControllerOptions<V> {
  /** The app's values, in order. */
  readonly values: () => ReadonlyArray<V>
  /** Receives a new order; the app sets `values` from it. */
  readonly onReorder: (values: Array<V>) => void
  /**
   * Hears a user's reorder that changed the order, at its end: once a gesture, not at each step, as
   * `onReorder` is. Not a keyboard cancel, which puts the order back, nor `move`.
   */
  // #257 item 3.
  readonly onReorderEnd?: ((end: ReorderEnd<V>) => void) | undefined
  /** Hears each **Reorder hold**'s start: a drag of an item past its threshold, or a keyboard lift. */
  // #348.
  readonly onHoldStart?: ((start: ReorderHoldStart<V>) => void) | undefined
  /** Hears each **Reorder hold**'s end, once, whatever ended it; after `onReorderEnd` when it moved. */
  // #348.
  readonly onHoldEnd?: ((end: ReorderHoldEnd<V>) => void) | undefined
  /** The app's axis, overriding detection; `None` to detect. */
  readonly axis?: (() => Option.Option<Reorder.Axis>) | undefined
  /** Called when the detected axis changes (after a Measure pass, or {@link ReorderController.resolve}). */
  readonly onAxis?: ((axis: Reorder.Axis) => void) | undefined
  /**
   * How the binding keys its items, for the warning logged once per controller when an
   * item registers with a value an item of this group unregistered in the same task
   * (the signature of a list keyed by index): "key items with `keyedWith`". Solid's is
   * `"<For>"`; by default "their value".
   */
  readonly keyedWith?: string | undefined
  /** Whether the items reorder by keyboard, read at each key; `false` turns it off. On when left out. */
  // ADR-0037.
  readonly keyboard?: (() => boolean) | undefined
  /** The group's announcements over the defaults, read at each announcement. */
  // ADR-0037.
  readonly announcements?: (() => Option.Option<Partial<Reorder.Announcements<V>>>) | undefined
}

/** One item of a {@link ReorderController}: its binding feeds it the item's handle, drag samples, keys, focus and presses. */
export interface ReorderItemDriver {
  /** Register the item's projection handle with the group; returns the unregister. */
  readonly register: (handle: ProjectionNodeHandle) => () => void
  /** The axis the item's drag takes, read at each gesture's start. */
  readonly dragAxis: () => Reorder.Axis
  /** The item's drag samples, as the drag delivers them. */
  readonly onSample: (sample: Drag.Sample) => void
  /** A key at the item or inside it, inside its dispatch: a keyboard reorder's. */
  // ADR-0037.
  readonly onKey: (event: InputSource.KeyboardLikeEvent) => void
  /** Focus left the item: a lift drops where it is, unless focus is back on the item. */
  // ADR-0037.
  readonly onBlur: () => void
  /** A press on the item: a lift drops where it is, before any drag. */
  // ADR-0037.
  readonly onPress: () => void
  /** The item is going away: end a gesture or a lift still in progress. */
  readonly dispose: () => void
}

/** How long a held arrow's announcements wait for the next repeat: only the last is spoken (ADR-0037, Q4). */
export const REPEAT_ANNOUNCE: Duration.Duration = Duration.millis(150)

/**
 * A Reorder item's default instructions on the web: core's keys, and focus mode. A
 * screen reader in browse mode (NVDA's, JAWS's) keeps Space and the arrows for itself until its user
 * switches to focus mode, and it doesn't switch by itself on a list item.
 */
// ADR-0037: the NVDA pass.
export const DEFAULT_REORDER_INSTRUCTIONS = `${Reorder.DEFAULT_INSTRUCTIONS} Some screen readers need focus mode for these keys.`

/** How an item is spoken: its `aria-label`, else its text with its whitespace collapsed, else its value. */
const labelOf = (element: Option.Option<Element>, value: unknown): string =>
  Option.getOrElse(
    Option.orElse(
      Option.flatMap(element, (el) => nonEmpty(Option.map(Option.fromNullOr(el.getAttribute("aria-label")), Str.trim))),
      () => Option.flatMap(element, (el) => nonEmpty(Option.map(Option.fromNullOr(el.textContent), (text) => text.replace(/\s+/g, " ").trim()))),
    ),
    () => String(value),
  )

/** A text, `None` when it's empty. */
const nonEmpty = (text: Option.Option<string>): Option.Option<string> => Option.filter(text, Str.isNonEmpty)

/** A **Reorder group** on the DOM. */
// ADR-0020.
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
  readonly item: (value: V, element: () => Option.Option<Element>, onLift?: (lifted: boolean) => void) => ReorderItemDriver
  /** Move `value` to `toIndex` in code (`Reorder.move`), and announce it. */
  // ADR-0037.
  readonly move: (value: V, toIndex: number) => void
  /**
   * The axis now: the app's, else detected from the items' boxes as they are, reporting nothing. A
   * binding derives its axis with it when the app's is cleared.
   */
  // #257's audit.
  readonly detect: () => Reorder.Axis
  /** The app's values changed: re-measure, so the items animate to their slots. */
  readonly valuesChanged: () => void
  /** Stops listening to measures and ends the auto-scroll. The Scope calls it. */
  readonly dispose: () => void
}

/** Build a {@link ReorderController}: a **Reorder group** over `wiring.projection`'s nodes. */
export const makeReorderController = <V>(wiring: ReorderControllerWiring, options: ReorderControllerOptions<V>): ReorderController<V> => {
  const { runtime, projection, announce } = wiring
  const debug = debugOf(runtime, "wardic.reorder")
  // Speak an Announcement, or nothing without an `announce`.
  const speak = UndefinedOr.match(announce, { onUndefined: () => constVoid, onDefined: identity })
  const keyboardOn = (): boolean => UndefinedOr.match(options.keyboard, { onUndefined: constTrue, onDefined: (on) => on() })
  // The group's element and its Auto-scroll, once it's attached.
  const element = MutableRef.make(Option.none<Element>())
  const autoScroller = MutableRef.make(Option.none<AutoScroller>())
  const resetAutoScroll = (): void => {
    const scroller = MutableRef.get(autoScroller)
    if (Option.isSome(scroller)) scroller.value.reset()
  }
  // The order the group last asked for: a `values` change to anything else is the app's own (ADR-0037).
  let asked: ReadonlyArray<V> | undefined
  /** The app's axis, if it sets one. */
  const appAxis = (): Option.Option<Reorder.Axis> => Option.flatMap(Option.fromUndefinedOr(options.axis), (axis) => axis())
  const group = Reorder.make<V>({
    values: options.values,
    onReorder: (values) => {
      asked = values
      options.onReorder(values)
    },
    axis: () => appAxis(),
    // Read once per drag start (Motion reads it on every sample, Group.tsx:142-147 at 16c6122).
    direction: () =>
      Bool.match(Option.exists(MutableRef.get(element), (el) => getComputedStyle(el).direction === "rtl"), {
        onTrue: () => "rtl" as const,
        onFalse: () => "ltr" as const,
      }),
    debug,
  })

  let detected: Reorder.Axis = "y"
  let reported: Reorder.Axis | undefined
  const resolve = (): void => {
    if (Option.isSome(appAxis())) return
    detected = Reorder.resolveAxis(group)
    if (detected === reported) return
    reported = detected
    debug("axis", { axis: detected })
    if (Predicate.isNotUndefined(options.onAxis)) options.onAxis(detected)
  }
  // --- The keyboard reorder (ADR-0037) ---------------------------------------
  /** The lifted item's element, its handle and its `onLift`, by value, while it's registered. */
  interface Keyed {
    readonly element: () => Option.Option<Element>
    handle: Option.Option<ProjectionNodeHandle>
    readonly onLift: (lifted: boolean) => void
  }
  const keyed = new Map<V, Keyed>()
  const elementOf = (value: V): Option.Option<Element> => Option.flatMap(Option.fromUndefinedOr(keyed.get(value)), (k) => k.element())
  // The item whose new place the next Measure pass lays out, to scroll into view then.
  const reveal = MutableRef.make(Option.none<V>())
  // A held arrow's latest announcement, waiting for the next repeat (ADR-0025, *Amendment (#69)*): a
  // fiber in the Scope the controller was built in, which closes it after `dispose`.
  const pending = runtime.runSync(FiberHandle.make<void, never>().pipe(Scope.provide(runtime.scope)))

  const announceNow = (message: string): void => {
    runtime.runFork(FiberHandle.clear(pending))
    speak(message)
  }
  /** A held arrow's step: spoken once the repeats stop for {@link REPEAT_ANNOUNCE}, only the last. */
  const announceLater = (message: string): void => {
    FiberHandle.setUnsafe(pending, runtime.runFork(Effect.sleep(REPEAT_ANNOUNCE).pipe(Effect.andThen(Effect.sync(() => speak(message))))))
  }
  const wording = (): Reorder.Announcements<V> => ({
    ...(Reorder.defaultAnnouncements as Reorder.Announcements<V>),
    ...Option.getOrUndefined(Option.flatMap(Option.fromUndefinedOr(options.announcements), (announcements) => announcements())),
  })
  const say = (kind: keyof Reorder.Announcements<V>, value: V, placement: Reorder.Placement): string =>
    wording()[kind]({ value, label: labelOf(elementOf(value), value), position: placement.position, count: placement.count })

  /** Raise the lifted item (or lower it) and tell its binding (its `whileDrag`). */
  const setLifted = (value: V, lifted: boolean): void => {
    const k = keyed.get(value)
    if (Predicate.isUndefined(k)) return
    if (Option.isSome(k.handle)) k.handle.value.lift(lifted)
    k.onLift(lifted)
  }
  /** `value`'s index in the app's values now. */
  const indexOf = (value: V): number => options.values().indexOf(value)
  /** The end of a user's reorder of `value`, begun at `from`: told when it moved (#257 item 3). */
  const ended = (value: V, from: number): void => {
    const to = indexOf(value)
    if (to === from) return
    UndefinedOr.map(options.onReorderEnd, (tell) => tell({ values: [...options.values()], value, from, to }))
  }
  // --- Holds (#348) ------------------------------------------------------------
  /** The open **Reorder hold**: the item in hand, how it was taken, and its index then. One at a time. */
  let held: Option.Option<{ readonly value: V; readonly from: number; readonly by: "drag" | "lift" }> = Option.none()
  /** Whether `value`'s drag is the open hold: a drag a later hold took over tells nothing more. */
  const holdsDrag = (value: V): boolean => Option.exists(held, (h) => h.by === "drag" && h.value === value)
  const holdStart = (value: V, from: number, by: "drag" | "lift"): void => {
    held = Option.some({ value, from, by })
    UndefinedOr.map(options.onHoldStart, (tell) => tell({ value, from }))
  }
  /** End `value`'s hold, `how`: told once, and only for the open one. */
  const holdEnd = (value: V, how: ReorderHoldHow): void =>
    Option.match(Option.filter(held, (h) => h.value === value), {
      onNone: constVoid,
      onSome: (h) => {
        held = Option.none()
        UndefinedOr.map(options.onHoldEnd, (tell) => tell({ values: [...options.values()], value, from: h.from, to: indexOf(value), how }))
      },
    })

  /** The lifted item's index at its lift. */
  let liftedFrom = -1
  /** Drop the lifted item where it is and announce it: a drop key, or an interruption. */
  const dropLifted = (): void =>
    Option.match(Reorder.liftedValue(group), {
      onNone: constVoid,
      onSome: (value) => {
        Option.match(Reorder.drop(group, value), { onNone: constVoid, onSome: (placement) => announceNow(say("drop", value, placement)) })
        setLifted(value, false)
        ended(value, liftedFrom)
        holdEnd(value, "drop")
      },
    })
  /**
   * A drag's start ends the open hold first (#348, one at a time): a lift is dropped where it is,
   * and another item's drag ends, told as if released, its own release telling nothing more.
   */
  const endHeld = (): void =>
    Option.match(held, {
      onNone: constVoid,
      onSome: (h) => {
        if (h.by === "lift") return dropLifted()
        ended(h.value, h.from)
        holdEnd(h.value, "drop")
      },
    })
  /** Focus back on the lifted item, if a reorder took it (moving a focused node can blur it), without scrolling. */
  const keepFocus = (value: V): void =>
    Option.match(Option.filter(elementOf(value), (el) => el.ownerDocument.activeElement !== el), {
      onNone: constVoid,
      onSome: (el) => (el as HTMLElement).focus({ preventScroll: true }),
    })
  /** Whether focus is on `value`'s element. */
  const focused = (value: V): boolean => Option.exists(elementOf(value), (el) => el.ownerDocument.activeElement === el)

  const onKeyOf = (value: V) => (event: InputSource.KeyboardLikeEvent): void => {
    if (event.type !== "down") return
    if (Bool.not(keyboardOn())) return
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
                liftedFrom = indexOf(value)
                // The values the lift began with are the group's own: a binding re-reading them,
                // the same, mid-lift (a memo whose sources changed) isn't the app changing them (#348).
                asked = options.values()
                setLifted(value, true)
                announceNow(say("lift", value, placement))
                holdStart(value, liftedFrom, "lift")
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
                if (placement.moved) MutableRef.set(reveal, Option.some(value))
                announceNow(say("cancel", value, placement))
                holdEnd(value, "cancel")
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
          MutableRef.set(reveal, Option.some(value))
          keepFocus(value)
        }
        const message = say("step", value, placement)
        Bool.match(event.repeat, { onTrue: () => announceLater(message), onFalse: () => announceNow(message) })
      },
    })
  }

  // Every Measure pass measures every node, so its end is when the boxes are fresh, and when a
  // stepped item's new place is laid out.
  const stopPassEnd = wiring.onPassEnd(() => {
    resolve()
    const stepped = MutableRef.get(reveal)
    MutableRef.set(reveal, Option.none())
    const el = Option.filter(Option.flatMap(stepped, elementOf), (e) => e.isConnected)
    if (Option.isSome(el)) revealLayoutOf(el.value)
  })

  const keyedWith = UndefinedOr.match(options.keyedWith, { onUndefined: () => "their value", onDefined: identity })
  // Values whose item unregistered in this task, and whether a remount was warned of.
  const unregisteredThisTask = new Set<V>()
  let remountReported = false

  const item = (value: V, itemElement: () => Option.Option<Element>, onLift: (lifted: boolean) => void = constVoid): ReorderItemDriver => {
    // The gesture's axis (core's, fixed at its start), for Auto-scroll's axis.
    let gestureAxis: Reorder.Axis = "y"
    let inGesture = false
    // Its index at the drag's start, for its `onReorderEnd` (#257 item 3).
    let draggedFrom = -1
    const k: Keyed = { element: itemElement, handle: Option.none(), onLift }
    keyed.set(value, k)
    const end = (): void => {
      inGesture = false
      Reorder.dragEnd(group, value)
      resetAutoScroll()
    }
    return {
      register: (handle) => {
        if (!remountReported && unregisteredThisTask.has(value)) {
          remountReported = true
          runtime.runFork(
            Effect.logWarning(
              `wardic.reorder: an item remounted with the same value in one task (key items with ${keyedWith})`,
            ).pipe(Effect.annotateLogs({ value: String(value) })),
          )
        }
        const unregister = Reorder.register(group, value, {
          layoutBox: handle.layoutBox,
          dragOffset: handle.dragOffset,
          layoutVersion: handle.layoutVersion,
        })
        k.handle = Option.some(handle)
        keyed.set(value, k)
        return () => {
          if (Option.contains(k.handle, handle)) k.handle = Option.none()
          unregister()
          if (unregisteredThisTask.size === 0) queueMicrotask(() => unregisteredThisTask.clear())
          unregisteredThisTask.add(value)
        }
      },
      dragAxis: () => Reorder.resolveAxis(group),
      onSample: (sample) => {
        if (sample.phase === "start") {
          endHeld()
          inGesture = true
          draggedFrom = indexOf(value)
          gestureAxis = Reorder.dragStart(group, value)
          holdStart(value, draggedFrom, "drag")
          return
        }
        if (sample.phase === "move") {
          const velocity = Reorder.dragMove(group, value, sample.velocity)
          const scroller = MutableRef.get(autoScroller)
          if (Option.isSome(scroller)) {
            const on = AutoScroll.axis(gestureAxis, velocity)
            scroller.value.update(sample.point, on, velocity[on], Option.getOrUndefined(k.element()))
          }
          return
        }
        end()
        // A drag a later hold took over ended then.
        if (Bool.not(holdsDrag(value))) return
        ended(value, draggedFrom)
        holdEnd(value, "drop")
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
        holdEnd(value, "unmount")
        if (keyed.get(value) === k) keyed.delete(value)
      },
    }
  }

  return {
    group,
    axis: () => Option.getOrElse(appAxis(), () => detected),
    attach: (el) => {
      MutableRef.set(element, Option.some(el))
      MutableRef.set(autoScroller, Option.some(makeAutoScroller(el, debug)))
      // The live region has to be in the page before the first lift (ADR-0037, Q7).
      if (keyboardOn() && Predicate.isNotUndefined(announce)) prepareAnnouncer(documentOf(el))
    },
    item,
    move: (value, toIndex) =>
      Option.match(Reorder.move(group, value, toIndex), {
        onNone: constVoid,
        onSome: (placement) => {
          if (placement.moved) announceNow(say("move", value, placement))
        },
      }),
    detect: () => Reorder.resolveAxis(group),
    valuesChanged: () => {
      // The app changed `values` itself while an item is lifted: it's dropped at its new place.
      if (Option.isSome(Reorder.liftedValue(group)) && options.values() !== asked) dropLifted()
      projection.notify()
    },
    dispose: () => {
      stopPassEnd()
      resetAutoScroll()
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
  detect: () => "y" as const,
  valuesChanged: noop,
  dispose: noop,
})

