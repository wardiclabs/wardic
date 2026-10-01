/**
 * `InputDomLive` — the browser realization of `InputSource`, mapping raw DOM
 * events onto the engine's environment-agnostic Like-event shapes
 * (`PointerLikeEvent`/`KeyboardLikeEvent`/`WheelLikeEvent`/`FocusLikeEvent`).
 *
 * Every accessor is built on the shared-source helpers (CONTEXT.md's **Shared
 * source** contract): per-target streams go through {@link makeSharedByTarget}
 * (one listener-set per element, ref-counted) and the document-level keyboard
 * goes through {@link makeSharedGlobal} (one keydown/keyup listener-pair for the
 * whole Environment). A consumer attaching `hover` + `press` + `drag` to one
 * element therefore shares a single pointer listener-set, not three.
 *
 * `pointer(target)` also carries every **Held pointer**'s events (ADR-0019): core's
 * `heldPointerSource` adds a page-wide set (the target's window, capture phase) inside
 * the target's `pointerdown` dispatch and removes it at the pointer's release, so a
 * drag or a press keeps its pointer anywhere on the page. It is part of the element's
 * one shared lookup, so every subscriber to the element shares it too. No pointer
 * capture: capturing at the down would retarget a click on a child `<button>` to the
 * element, and it allows one capturer per pointer, which nested draggables (#29) would
 * fight over.
 *
 * A scroll moves a Held pointer (ADR-0019, *Amendment (Reorder)*): while one is held,
 * the target's scroll feed reports the scroll of each of its scrollable ancestors and
 * of its window, and `heldPointerSource` turns each change into a move of the pointer
 * shifted by it. Two passive `scroll` listeners on the target's window come with the
 * hold and go at its release: one in the capture phase for element scrolls (they don't
 * bubble), one for the window's own. Nothing listens for scroll at rest. The feed also
 * keeps each held target's total shift, for the auto-scroller ({@link heldScrollShift}).
 *
 * `Layer.effect` runs `make` in the layer's own scope (it `Exclude`s `Scope`
 * from the requirements, effect 4's scoped-layer idiom — there is no separate
 * `Layer.scoped`), which the helpers' `RcMap`/`RcRef` need: the ref-counting
 * caches live for the layer's lifetime.
 *
 * Observability (CONTEXT.md observability convention): the shared helpers
 * already carry a `wardic.dom.shared.*` span + a debug-log on subscribe; the
 * per-event mapping path is deliberately unlogged — it is the hot path.
 */
import type {
  FocusLikeEvent,
  KeyboardLikeEvent,
  Point,
  PointerFeed,
  PointerLikeEvent,
  ScrollFeed,
  WheelLikeEvent,
} from "@wardic/core"
import { heldPointerSource, InputSource } from "@wardic/core"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import { scrollersOf } from "./measure.ts"
import { makeSharedByTarget, makeSharedGlobal } from "./shared.ts"

/** DOM `pointer*` type → the engine's portable phase. */
const POINTER_TYPE: Record<string, PointerLikeEvent["type"]> = {
  pointerdown: "down",
  pointermove: "move",
  pointerup: "up",
  pointercancel: "cancel",
  pointerenter: "enter",
  pointerleave: "leave",
}

const POINTER_EVENTS = Object.keys(POINTER_TYPE)

/**
 * The page-wide events while a pointer is held: its moves, release and cancel, and any
 * down, which ends a hold whose release was lost (ADR-0019, decision 7).
 */
const HELD_POINTER_EVENTS = ["pointermove", "pointerup", "pointercancel", "pointerdown"]

const toPointer = (type: PointerLikeEvent["type"], ev: PointerEvent): PointerLikeEvent => ({
  type,
  pointerId: ev.pointerId ?? 1,
  x: ev.clientX,
  y: ev.clientY,
  buttons: ev.buttons,
  timeStamp: ev.timeStamp,
  pointerType: ev.pointerType,
  button: ev.button,
  isPrimary: ev.isPrimary,
})

/**
 * A {@link PointerFeed} of `types` on `target`: each DOM event emitted as its
 * Like-event with the DOM event as `raw`; the returned function removes the listeners.
 */
const feedOf = (target: EventTarget, types: ReadonlyArray<string>, options?: AddEventListenerOptions): PointerFeed =>
(emit) => {
  const listener = (ev: Event): void => emit(toPointer(POINTER_TYPE[ev.type]!, ev as PointerEvent), ev)
  for (const type of types) target.addEventListener(type, listener, options)
  return () => {
    for (const type of types) target.removeEventListener(type, listener, options)
  }
}

/** The window an element's page-wide events reach: its own document's (an iframe's element has its own). */
const windowOf = (target: unknown): Window =>
  (target as { readonly ownerDocument?: { readonly defaultView?: Window | null } | null } | undefined)?.ownerDocument
    ?.defaultView ?? window

/** Whether `target` is an element (by `nodeType`, so an iframe's elements count too). */
const isElement = (target: unknown): target is Element =>
  typeof target === "object" && target !== null && (target as { readonly nodeType?: number }).nodeType === 1

const CAPTURE_PASSIVE: AddEventListenerOptions = { capture: true, passive: true }
const PASSIVE: AddEventListenerOptions = { passive: true }
const ZERO: Point = { x: 0, y: 0 }

/** Each held target's scroll since its hold began, while it's held (Q1: one per hold). */
const heldShifts = new WeakMap<object, { x: number; y: number }>()

/**
 * The scroll since `target`'s current hold began, summed over its window and its
 * scrollable ancestors: a held drag's point minus this is the pointer's viewport
 * position. `{ x: 0, y: 0 }` when nothing is held on it.
 *
 * @internal for the auto-scroller.
 */
export const heldScrollShift = (target: unknown): Point =>
  (typeof target === "object" && target !== null ? heldShifts.get(target) : undefined) ?? ZERO

/**
 * The {@link ScrollFeed} of a pointer target: its scrollable ancestors' scroll
 * (`scrollLeft`/`scrollTop`) and its window's (`scrollX`/`scrollY`), stopping at a
 * `position: fixed` element (no scroll outside it moves the target). On subscribe it
 * reports each one's current position, then listens on the target's window: a
 * capture-phase listener for element scrolls (only the tracked ancestors report) and
 * one for the window's own scroll (the document's scroll event reaches the capture
 * listener too, so only this one reports it).
 */
const scrollFeedOf = (target: unknown): ScrollFeed => (emit) => {
  const win = windowOf(target)
  const doc = win.document
  const last = new Map<EventTarget, { x: number; y: number }>()
  const shift = { x: 0, y: 0 }
  const key = typeof target === "object" && target !== null ? target : undefined
  if (key !== undefined) heldShifts.set(key, shift)
  const report = (source: EventTarget, x: number, y: number, timeStamp: number): void => {
    const prev = last.get(source)
    if (prev === undefined) last.set(source, { x, y })
    else {
      shift.x += x - prev.x
      shift.y += y - prev.y
      prev.x = x
      prev.y = y
    }
    emit(source, { x, y }, timeStamp)
  }
  // The positions at subscribe are the baselines (no event, so no time). Inside a
  // `position: fixed` element only the scrollers up to it move the target, and the
  // page doesn't.
  const scrollers = isElement(target) ? scrollersOf(target) : { ancestors: [], page: true }
  for (const el of scrollers.ancestors) report(el, el.scrollLeft, el.scrollTop, 0)
  if (scrollers.page) report(win, win.scrollX, win.scrollY, 0)
  const onElement = (ev: Event): void => {
    const el = ev.target as Element
    if (el === (doc as unknown) || !last.has(el)) return
    report(el, el.scrollLeft, el.scrollTop, ev.timeStamp)
  }
  const onWindow = (ev: Event): void => {
    if ((ev.target !== doc && ev.target !== win) || !last.has(win)) return
    report(win, win.scrollX, win.scrollY, ev.timeStamp)
  }
  win.addEventListener("scroll", onElement, CAPTURE_PASSIVE)
  win.addEventListener("scroll", onWindow, PASSIVE)
  return () => {
    win.removeEventListener("scroll", onElement, CAPTURE_PASSIVE)
    win.removeEventListener("scroll", onWindow, PASSIVE)
    if (key !== undefined && heldShifts.get(key) === shift) heldShifts.delete(key)
  }
}

const toFocus = (type: FocusLikeEvent["type"]) =>
  (ev: FocusEvent): FocusLikeEvent => ({ type, timeStamp: ev.timeStamp })

const toWheel = (ev: WheelEvent): WheelLikeEvent => ({
  deltaX: ev.deltaX,
  deltaY: ev.deltaY,
  deltaZ: ev.deltaZ,
  timeStamp: ev.timeStamp,
})

const toKeyboard = (type: KeyboardLikeEvent["type"]) =>
  (ev: KeyboardEvent): KeyboardLikeEvent => ({
    type,
    key: ev.key,
    code: ev.code,
    repeat: ev.repeat,
    timeStamp: ev.timeStamp,
  })

/**
 * One `fromEventListener` per DOM event type, mapped to a Like-event, except
 * `pointer`, whose target, page-wide and scroll feeds go through core's
 * `heldPointerSource` (one ordered callback). The shared helpers want `Effect<Stream<A>, never, Scope>`;
 * these are plain `Stream`s, so each `lookup` simply succeeds with the stream.
 */
const make = Effect.gen(function* () {
  const pointer = yield* makeSharedByTarget((target) =>
    Effect.succeed(
      heldPointerSource({
        target: feedOf(target as EventTarget, POINTER_EVENTS),
        global: feedOf(windowOf(target), HELD_POINTER_EVENTS, CAPTURE_PASSIVE),
        scroll: scrollFeedOf(target),
      }),
    )
  )

  const focus = yield* makeSharedByTarget((target) =>
    Effect.succeed(
      Stream.merge(
        Stream.fromEventListener<FocusEvent>(target as Stream.EventListener<FocusEvent>, "focus").pipe(
          Stream.map(toFocus("focus")),
        ),
        Stream.fromEventListener<FocusEvent>(target as Stream.EventListener<FocusEvent>, "blur").pipe(
          Stream.map(toFocus("blur")),
        ),
      ),
    )
  )

  const wheel = yield* makeSharedByTarget((target) =>
    Effect.succeed(
      Stream.fromEventListener<WheelEvent>(target as Stream.EventListener<WheelEvent>, "wheel", {
        passive: true,
      }).pipe(Stream.map(toWheel)),
    )
  )

  const keyboardStream = yield* makeSharedGlobal(
    Effect.succeed(
      Stream.merge(
        Stream.fromEventListener<KeyboardEvent>(document as unknown as Stream.EventListener<KeyboardEvent>, "keydown")
          .pipe(Stream.map(toKeyboard("down"))),
        Stream.fromEventListener<KeyboardEvent>(document as unknown as Stream.EventListener<KeyboardEvent>, "keyup")
          .pipe(Stream.map(toKeyboard("up"))),
      ),
    ),
  )

  return InputSource.of({
    pointer,
    focus,
    wheel,
    keyboard: () => keyboardStream,
  })
})

/**
 * `InputSource` Layer backed by DOM event listeners. Built with `Layer.effect`
 * so `make` runs in the layer's scope and the shared helpers' `RcMap`/`RcRef`
 * caches live for the layer's lifetime.
 */
export const InputDomLive: Layer.Layer<InputSource> = Layer.effect(InputSource)(make)
