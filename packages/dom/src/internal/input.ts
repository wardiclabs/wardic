/**
 * `InputDomLive` — the browser realization of `InputSource`, mapping raw DOM
 * events onto the engine's environment-agnostic Like-event shapes
 * (`PointerLikeEvent`/`KeyboardLikeEvent`/`FocusLikeEvent`).
 *
 * Every accessor is an **Input feed** (#318), shared per target by core's `InputFeed.byTarget`
 * (CONTEXT.md's **Shared source** contract: one listener-set per element, ref-counted, with no
 * `PubSub` or fiber). A consumer attaching `hover` + `press` + `drag` to one element therefore
 * shares a single pointer listener-set, not three.
 *
 * `keyboard(target)` (ADR-0037) listens on the target's window, in the bubble phase, for
 * the keys at the target or inside it: there it runs after the page's own handlers (the
 * element's, and Solid's delegated ones on the document), so `handled` (`defaultPrevented`) says
 * whether one took the key, and a consumer can still `handle()` it (`preventDefault()`). Its events
 * reach their consumers inside the dispatch (ADR-0032), the targets a key passed through innermost
 * first (#439): one listener per window walks its path.
 * Keys are in core's names (`keyOf`), not the browser's.
 *
 * `pointer(target)` also carries every **Held pointer**'s events (ADR-0019): core's
 * `InputSource.heldPointer` adds a page-wide set (the target's window, capture phase) inside
 * the target's `pointerdown` dispatch and removes it at the pointer's release, so a
 * drag or a press keeps its pointer anywhere on the page. It is part of the element's
 * one shared lookup, so every subscriber to the element shares it too. No pointer
 * capture: capturing at the down would retarget a click on a child `<button>` to the
 * element, and it allows one capturer per pointer, which nested draggables (#29) would
 * fight over.
 *
 * `adoptPointer(target, raw)` (#431, **Drag controls**) hands a pointer that went down elsewhere,
 * a handle or a track, to `target`: its `PointerEvent` (a `pointerdown`, or any other with a button
 * pressed) is delivered on `adoptablePointer(target)` as an adopted down, inside the call, and held
 * from there as the target's own downs are. Only a target given Drag controls reads that feed (#507):
 * its adopted feed is one more listener in a shared lookup, not a DOM listener, and `pointer(target)`,
 * every other target's, subscribes none.
 *
 * A scroll moves a Held pointer (ADR-0019, *Amendment (Reorder)*): while one is held,
 * the target's scroll feed reports the scroll of each of its scrollable ancestors and
 * of its window, and `InputSource.heldPointer` turns each change into a move of the pointer
 * shifted by it. Two passive `scroll` listeners on the target's window come with the
 * hold and go at its release: one in the capture phase for element scrolls (they don't
 * bubble), one for the window's own. Nothing listens for scroll at rest. The feed also
 * keeps each held target's total shift, for the auto-scroller ({@link heldScrollShift}).
 *
 * Observability (CONTEXT.md observability convention): a consumer (a recognizer) carries the
 * subscribe span and log; the per-event mapping path is deliberately unlogged — it is the hot
 * path.
 */
import * as InputFeed from "@wardic/core/InputFeed"
import * as InputSource from "@wardic/core/InputSource"
import type * as Point from "@wardic/core/Point"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import { constTrue, constVoid, identity } from "effect/Function"
import * as Iter from "effect/Iterable"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import { scrollersOf } from "./scrollers.ts"
import { requireGlobal } from "./require-global.ts"

/** DOM `pointer*` type → the engine's portable phase. */
const POINTER_TYPE: Record<string, InputSource.PointerLikeEvent["type"]> = {
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

/** A `PointerEvent.pointerType` as core's pointer kind: the DOM's three, else `"other"`. */
// A **Pointer kind** (ADR-0036, *Amendment (#189)*). Built once, read per input event: `Match.value`
// would build its matcher again each event, 69 ns against 10 (#618, H1).
export const kindOf: (pointerType: string) => InputSource.PointerKind = /*#__PURE__*/ Match.type<string>().pipe(
  Match.when("mouse", (): InputSource.PointerKind => "mouse"),
  Match.when("pen", (): InputSource.PointerKind => "pen"),
  Match.when("touch", (): InputSource.PointerKind => "touch"),
  Match.orElse((): InputSource.PointerKind => "other"),
)

/**
 * A `PointerEvent.button` in core's names: 0 the main button, 1 the middle, 2 the secondary, -1 none, as
 * on a move, and the rest, back, forward, a pen's eraser, other.
 */
// ADR-0036, *Amendment (#189)*. Built once, as `kindOf` (#618, H1).
export const buttonOf: (button: number) => InputSource.PointerButton = /*#__PURE__*/ Match.type<number>().pipe(
  Match.when(0, (): InputSource.PointerButton => "main"),
  Match.when(1, (): InputSource.PointerButton => "middle"),
  Match.when(2, (): InputSource.PointerButton => "secondary"),
  Match.when(-1, (): InputSource.PointerButton => "none"),
  Match.orElse((): InputSource.PointerButton => "other"),
)

/** Where a pointer event landed, as its feed says: on the feed's target, or elsewhere. */
export type Where = "target" | "elsewhere"

/** A feed's answer as a {@link Where}: per input event, a statement. */
const whereOf = (onTarget: boolean): Where => {
  if (onTarget) return "target"
  return "elsewhere"
}

/**
 * A DOM `PointerEvent` as core's pointer event: at its point in the viewport, with no scroll counted
 * (`InputSource.heldPointer` counts it), and where it landed as its feed says: on the feed's target, or
 * elsewhere.
 */
// ADR-0036, *Amendment (#189)*; #257. `where`, not a trailing boolean (#618, F7).
export const toPointer = (type: InputSource.PointerLikeEvent["type"], ev: PointerEvent, where: Where = "target"): InputSource.PointerLikeEvent => ({
  type,
  pointerId: UndefinedOr.match(ev.pointerId as number | undefined, { onUndefined: () => 1, onDefined: identity }),
  x: ev.clientX,
  y: ev.clientY,
  pressed: ev.buttons !== 0,
  timeStamp: ev.timeStamp,
  kind: kindOf(ev.pointerType),
  button: buttonOf(ev.button),
  primary: ev.isPrimary,
  scroll: InputSource.NO_SCROLL,
  onTarget: where === "target",
  // The DOM's own event, for an app's gesture callback (#273).
  raw: ev,
})

/**
 * A {@link PointerFeed} of `types` on `target`: each DOM event emitted as its
 * Like-event with the DOM event as `raw`; the returned function removes the listeners.
 * `onTargetOf` says whether an event landed on the element the stream is for (#257): the
 * target's own feed's always do; the page-wide feed's say.
 */
const feedOf = (
  target: EventTarget,
  types: ReadonlyArray<string>,
  options?: AddEventListenerOptions,
  onTargetOf: (ev: Event) => boolean = constTrue,
): InputSource.PointerFeed =>
(emit) => {
  const listener = (ev: Event): void => emit(toPointer(UndefinedOr.getOrThrow(POINTER_TYPE[ev.type]), ev as PointerEvent, whereOf(onTargetOf(ev))), ev)
  Arr.forEach(types, (type) => target.addEventListener(type, listener, options))
  return () => Arr.forEach(types, (type) => target.removeEventListener(type, listener, options))
}

/** Whether a page-wide event landed on `target` or inside it (#257, Motion's `isNodeOrChild`). */
const landedOn = (target: unknown) => (ev: Event): boolean =>
  Bool.and(isNode(target), isNode(ev.target)) && (target as Node).contains(ev.target as Node)

/** Whether `value` is a DOM node (by `nodeType`, so an iframe's nodes count too). */
const isNode = (value: unknown): boolean => Predicate.isObjectOrArray(value) && Predicate.isNumber((value as { readonly nodeType?: unknown }).nodeType)

/** The window an element's page-wide events reach: its own document's (an iframe's element has its own), else the page's. */
const windowOf = (target: unknown): Window =>
  Option.getOrElse(
    Option.flatMap(
      Option.flatMap(asKey(target), (key) => Option.fromNullishOr((key as { readonly ownerDocument?: Document | null }).ownerDocument)),
      (doc) => Option.fromNullishOr(doc.defaultView),
    ),
    () => window,
  )

/** `target` as a WeakMap key: an object, not a primitive. */
const asKey = (target: unknown): Option.Option<object> => Option.liftPredicate(target, Predicate.isObjectOrArray)

/** Whether `target` is an element (by `nodeType`, so an iframe's elements count too). */
const isElement = (target: unknown): target is Element =>
  Predicate.isObjectOrArray(target) && (target as { readonly nodeType?: number }).nodeType === 1

/** Each target's adopted-down listeners (#431), while its pointer feed is subscribed: one map an Environment. */
type Adopters = WeakMap<object, Set<(event: InputSource.PointerLikeEvent, raw: unknown) => void>>

/** The downs adopted for `target` (#431): `heldPointer`'s `adopted` feed. */
const adoptedFeedOf = (adopters: Adopters, target: unknown): InputSource.PointerFeed => (emit) => {
  const key = asKey(target)
  if (Option.isNone(key)) return constVoid
  const listeners = Option.getOrElse(Option.fromUndefinedOr(adopters.get(key.value)), () => new Set<(event: InputSource.PointerLikeEvent, raw: unknown) => void>())
  listeners.add(emit)
  adopters.set(key.value, listeners)
  return () => {
    listeners.delete(emit)
    if (listeners.size === 0) adopters.delete(key.value)
  }
}

/** Whether `raw` is a `PointerEvent` with a button pressed: one a target can adopt (#431). */
const isPressedPointer = (raw: unknown): raw is PointerEvent =>
  Bool.and(Predicate.hasProperty(raw, "pointerId"), Predicate.hasProperty(raw, "buttons")) && (raw as PointerEvent).buttons !== 0

/**
 * Hand `raw` to `target`'s pointer feed as an adopted down (#431): at its viewport point, on the target
 * if it landed there. `undefined`, delivering nothing, for what isn't a pressed pointer's event.
 */
const adoptPointerIn = (adopters: Adopters) => (target: unknown, raw: unknown): Option.Option<InputSource.PointerLikeEvent> => {
  if (isPressedPointer(raw)) return Option.some(adopt(adopters, target, raw))
  return Option.none()
}

/** {@link adoptPointerIn} of a pressed pointer's event. */
const adopt = (adopters: Adopters, target: unknown, raw: PointerEvent): InputSource.PointerLikeEvent => {
  const down = toPointer("down", raw, whereOf(landedOn(target)(raw)))
  Option.match(Option.flatMap(asKey(target), (key) => Option.fromUndefinedOr(adopters.get(key))), {
    onNone: constVoid,
    onSome: (listeners) => Arr.forEach(Arr.fromIterable(listeners), (emit) => emit(down, raw)),
  })
  return { ...down, adopted: true }
}

const CAPTURE_PASSIVE: AddEventListenerOptions = { capture: true, passive: true }
const PASSIVE: AddEventListenerOptions = { passive: true }
const ZERO: Point.Point = { x: 0, y: 0 }

/** Each held target's scroll since its hold began, while it's held (Q1: one per hold). */
// Module state (#460, Q7): each held target's scroll since its hold began, held weakly by the target,
// which one Environment holds at a time; the auto-scroller reads it beside the input.
const heldShifts = new WeakMap<object, { x: number; y: number }>()

/**
 * The scroll since `target`'s current hold began, summed over its window and its
 * scrollable ancestors: a held drag's point minus this is the pointer's viewport
 * position. `{ x: 0, y: 0 }` when nothing is held on it.
 *
 * @internal for the auto-scroller.
 */
export const heldScrollShift = (target: unknown): Point.Point =>
  Option.getOrElse(Option.flatMap(asKey(target), (key) => Option.fromUndefinedOr(heldShifts.get(key))), () => ZERO)

/**
 * The {@link ScrollFeed} of a pointer target: its scrollable ancestors' scroll
 * (`scrollLeft`/`scrollTop`) and its window's (`scrollX`/`scrollY`), stopping at a
 * `position: fixed` element (no scroll outside it moves the target). On subscribe it
 * reports each one's current position, then listens on the target's window: a
 * capture-phase listener for element scrolls (only the tracked ancestors report) and
 * one for the window's own scroll (the document's scroll event reaches the capture
 * listener too, so only this one reports it).
 */
const scrollFeedOf = (target: unknown): InputSource.ScrollFeed => (emit) => {
  const win = windowOf(target)
  const doc = win.document
  const last = new Map<EventTarget, { x: number; y: number }>()
  const shift = { x: 0, y: 0 }
  const key = asKey(target)
  if (Option.isSome(key)) heldShifts.set(key.value, shift)
  const report = (source: EventTarget, x: number, y: number, timeStamp: number): void => {
    Option.match(Option.fromUndefinedOr(last.get(source)), {
      onNone: () => {
        last.set(source, { x, y })
      },
      onSome: (prev) => {
        shift.x += x - prev.x
        shift.y += y - prev.y
        prev.x = x
        prev.y = y
      },
    })
    emit(source, { x, y }, timeStamp)
  }
  // The positions at subscribe are the baselines (no event, so no time). Inside a
  // `position: fixed` element only the scrollers up to it move the target, and the
  // page doesn't.
  const scrollers = Option.match(Option.liftPredicate(target, isElement), {
    onNone: () => ({ ancestors: [], page: true }),
    onSome: scrollersOf,
  })
  Arr.forEach(scrollers.ancestors, (el) => report(el, el.scrollLeft, el.scrollTop, 0))
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
    if (Option.isSome(key) && heldShifts.get(key.value) === shift) heldShifts.delete(key.value)
  }
}

/**
 * Whether a focus shows (#273, Motion's `whileFocus`): its target matches `:focus-visible`, which a
 * keyboard's focus does and a pointer's click on most elements doesn't. A browser that doesn't know the
 * selector shows every focus, as Motion reads it.
 */
const focusVisible = (target: EventTarget | null): boolean => {
  if (Bool.not(Predicate.hasProperty(target, "matches"))) return true
  try {
    return (target as Element).matches(":focus-visible")
  } catch {
    return true
  }
}

/** A `KeyboardEvent.key` in core's names: the keys core acts on, else `"other"`. */
// ADR-0037. Built once, as `kindOf` (#618, H1).
export const keyOf: (key: string) => InputSource.Key = /*#__PURE__*/ Match.type<string>().pipe(
  Match.when(" ", (): InputSource.Key => "space"),
  Match.when("Enter", (): InputSource.Key => "enter"),
  Match.when("Escape", (): InputSource.Key => "escape"),
  Match.when("ArrowLeft", (): InputSource.Key => "left"),
  Match.when("ArrowRight", (): InputSource.Key => "right"),
  Match.when("ArrowUp", (): InputSource.Key => "up"),
  Match.when("ArrowDown", (): InputSource.Key => "down"),
  Match.when("Home", (): InputSource.Key => "home"),
  Match.when("End", (): InputSource.Key => "end"),
  Match.orElse((): InputSource.Key => "other"),
)

/** The `<input>` types that act on a key themselves (#427): every other type is typed into. */
const ACTING_INPUTS: ReadonlySet<string> = new Set(["button", "submit", "reset", "image", "checkbox", "radio", "color", "file", "range"])

/** Elements that act on Enter and Space themselves (#427): a button's click, a disclosure's toggle, a list's opening. */
const ACTING_ELEMENTS: ReadonlySet<string> = new Set(["BUTTON", "SUMMARY", "SELECT"])

/** What an element does with Enter and Space itself (#427), as a pair: an editable region types both. */
interface KeyActions {
  readonly enter: InputSource.KeyAction
  readonly space: InputSource.KeyAction
}
const TYPES_BOTH: KeyActions = { enter: "type", space: "type" }
const ACTS_ON_BOTH: KeyActions = { enter: "activate", space: "activate" }
/** A text field: Space is typed, Enter submits its form. */
const TEXT_FIELD: KeyActions = { enter: "activate", space: "type" }
/** A link: Enter follows it, Space scrolls the page. */
const LINK: KeyActions = { enter: "activate", space: "none" }
const ACTS_ON_NEITHER: KeyActions = { enter: "none", space: "none" }

/** What `el` does with Enter and Space itself (#427), from what it is. */
const keyActionsOf = (el: Element): KeyActions => {
  if (Bool.or((el as HTMLElement).isContentEditable === true, el.tagName === "TEXTAREA")) return TYPES_BOTH
  if (el.tagName === "INPUT") return Bool.match(ACTING_INPUTS.has((el as HTMLInputElement).type), { onTrue: () => ACTS_ON_BOTH, onFalse: () => TEXT_FIELD })
  if (ACTING_ELEMENTS.has(el.tagName)) return ACTS_ON_BOTH
  if (Bool.and(el.tagName === "A", el.hasAttribute("href"))) return LINK
  return ACTS_ON_NEITHER
}

/**
 * What a key's own target does with it (#427, core's `KeyAction`): Enter's and Space's, from the
 * element they came from; nothing for any other key, which no **Keyboard press** reads.
 */
// Per key event: statements, no matcher or Option built each time (#618, H1).
const keyActionOf = (key: InputSource.Key, at: EventTarget | null): InputSource.KeyAction => {
  if (Bool.and(key !== "enter", key !== "space")) return "none"
  if (isElement(at)) {
    const actions = keyActionsOf(at)
    if (key === "enter") return actions.enter
    return actions.space
  }
  return "none"
}

/** The HTML elements that take the keyboard's focus of themselves (#427): a link only with its `href`. */
const FOCUSABLE_ELEMENTS: ReadonlySet<string> = new Set(["BUTTON", "INPUT", "SELECT", "TEXTAREA", "SUMMARY", "IFRAME"])

/** Whether `el` takes focus of itself: a control, a link, an editable region, or one given a `tabindex`. */
const takesFocus = (el: HTMLElement): boolean =>
  Bool.some([
    FOCUSABLE_ELEMENTS.has(el.tagName),
    Bool.and(Bool.or(el.tagName === "A", el.tagName === "AREA"), el.hasAttribute("href")),
    el.isContentEditable,
    el.hasAttribute("tabindex"),
  ])

/**
 * Makes a pressable element focusable, as Motion's press does: an HTML element that doesn't take focus
 * of itself, with no `tabindex`, gets `tabindex="0"`, so a key can press it. An SVG element, or one
 * already focusable, is left as it is. Called at mount, on the client.
 */
// #427: a **Keyboard press**.
export const makeFocusable = (target: unknown): void => {
  if (Bool.not(Predicate.hasProperty(target, "isContentEditable"))) return
  const el = target as HTMLElement
  if (takesFocus(el)) return
  el.tabIndex = 0
}

/** A key as the engine's portable event: core's key name, and the page's `preventDefault` as `handled`/`handle()`. */
const toKeyboard = (type: InputSource.KeyboardLikeEvent["type"], ev: KeyboardEvent, target: unknown): InputSource.KeyboardLikeEvent => {
  const key = keyOf(ev.key)
  return {
    type,
    key,
    repeat: ev.repeat,
    timeStamp: ev.timeStamp,
    fromTarget: ev.target === target,
    handled: ev.defaultPrevented,
    handle: () => ev.preventDefault(),
    action: keyActionOf(key, ev.target),
    raw: ev,
  }
}

/** A `keydown` or `keyup` as the engine's portable phase. */
const keyTypeOf = (ev: Event): InputSource.KeyboardLikeEvent["type"] =>
  Bool.match(ev.type === "keydown", { onTrue: () => "down" as const, onFalse: () => "up" as const })

/**
 * A window's targets for one kind of event (#439, #460): each target's deliveries, and the one listener
 * that hands the events to them.
 */
interface PathWindow<E> {
  readonly targets: Map<EventTarget, Set<(ev: E) => void>>
  readonly listener: (ev: Event) => void
}

/**
 * A kind of event a window hands to the targets on its path (#439, #460): its types, whether its
 * listener runs in the capture phase, and the windows listening for it.
 */
interface PathKind<E> {
  readonly types: ReadonlyArray<string>
  readonly capture: boolean
  readonly windows: WeakMap<Window, PathWindow<E>>
}

/** Keys (#439): in the bubble phase, so after the page's own handlers, where a key's `handle()` still counts. */
const KEYS: PathKind<KeyboardEvent> = { types: ["keydown", "keyup"], capture: false, windows: new WeakMap() }

/**
 * Focus changes (#460): `focusin` and `focusout`, which a target's own focus and blur and those inside
 * it both fire, in the capture phase, so no page handler stops them first. One listener a window
 * where each target added four of its own.
 */
const FOCUS: PathKind<FocusEvent> = { types: ["focusin", "focusout"], capture: true, windows: new WeakMap() }

/**
 * `win`'s targets for `kind`, its listener added with the first (#439): an event goes to the targets it
 * passed through innermost first, its path's order, as a pointer's down bubbles, so a press inside
 * marks a key in core's **Press claims** before its ancestors read it. A listener for each target would
 * run in the order the targets came.
 */
const pathWindowOf = <E>(kind: PathKind<E>, win: Window): PathWindow<E> =>
  UndefinedOr.match(kind.windows.get(win), {
    onDefined: identity,
    onUndefined: () => {
      const targets = new Map<EventTarget, Set<(ev: E) => void>>()
      const listener = (ev: Event): void =>
        Arr.forEach(ev.composedPath(), (node) =>
          UndefinedOr.map(targets.get(node), (deliveries) => Arr.forEach(Arr.fromIterable(deliveries), (deliver) => deliver(ev as E))),
        )
      Arr.forEach(kind.types, (type) => win.addEventListener(type, listener, kind.capture))
      const made: PathWindow<E> = { targets, listener }
      kind.windows.set(win, made)
      return made
    },
  })

/**
 * `delivery` handed `kind`'s events on `target`'s window that pass through `target` (#439, #460), until
 * the function returned stops it; the window's listener goes once no target there is left.
 */
const deliverAlong = <E>(kind: PathKind<E>, target: unknown, delivery: (ev: E) => void): (() => void) => {
  const win = windowOf(target)
  const path = pathWindowOf(kind, win)
  const el = target as EventTarget
  const deliveries = UndefinedOr.match(path.targets.get(el), {
    onDefined: identity,
    onUndefined: () => {
      const made = new Set<(ev: E) => void>()
      path.targets.set(el, made)
      return made
    },
  })
  deliveries.add(delivery)
  return (): void => {
    deliveries.delete(delivery)
    if (deliveries.size === 0) path.targets.delete(el)
    if (path.targets.size > 0) return
    Arr.forEach(kind.types, (type) => win.removeEventListener(type, path.listener, kind.capture))
    kind.windows.delete(win)
  }
}

/**
 * The keys at `target` or inside it (ADR-0037): `keydown`/`keyup` on its window, in the bubble
 * phase, so after the page's own handlers, handed to the targets a key passed through innermost first
 * (#439). An **Input feed** (#318): each key reaches its consumer inside the dispatch (ADR-0032), where
 * its `handle()` still counts.
 */
const keyboardOf = (target: unknown): InputFeed.InputFeed<InputSource.KeyboardLikeEvent> => (emit) =>
  deliverAlong(KEYS, target, (ev) => emit(toKeyboard(keyTypeOf(ev), ev, target)))

/**
 * `target`'s focus and blur, as an **Input feed** (#318), and since #439 those inside it, with
 * `fromTarget: false`, so a **Keyboard press** that reached an ancestor from inside is cancelled when
 * focus leaves the element its key came from. Since #460 `focusin` and `focusout` on its window, handed
 * to the targets on their path ({@link FOCUS}): a target's own is the one whose path starts at it.
 */
const focusOf = (target: unknown): InputFeed.InputFeed<InputSource.FocusLikeEvent> => (emit) =>
  deliverAlong(FOCUS, target, (ev) => emit(toPathFocus(ev, target)))

/**
 * A `focusin` or `focusout` as `target`'s focus or blur (#460): its own when the event's path starts at
 * it, which shadow roots don't hide as they do `ev.target`, and shown as the element focus moved to or
 * from shows it.
 */
const toPathFocus = (ev: FocusEvent, target: unknown): InputSource.FocusLikeEvent => {
  const origin = UndefinedOr.match(ev.composedPath()[0], { onUndefined: () => ev.target, onDefined: identity })
  return {
    type: Bool.match(ev.type === "focusin", { onTrue: (): InputSource.FocusLikeEvent["type"] => "focus", onFalse: () => "blur" }),
    timeStamp: ev.timeStamp,
    visible: focusVisible(origin),
    fromTarget: origin === target,
    raw: ev,
  }
}

/**
 * Whether focus is on `target` or inside it (#460, core's `InputSource.focusWithin`): the active element
 * of its root, its document or its shadow root, is it or inside it. A focus deeper in a shadow root
 * inside it shows there as that root's host. A target that isn't a node has no focus.
 */
const focusWithin = (target: unknown): boolean => {
  if (Bool.not(isNode(target))) return false
  const active = ((target as Node).getRootNode() as Partial<DocumentOrShadowRoot>).activeElement
  if (Predicate.isNullish(active)) return false
  return (target as Node).contains(active)
}

// --- Feeds over many targets (#665's PR 5, Q56): a Batch's members, from one listener set ------------

/**
 * The pointer events a feed over many targets hears, at its window in the bubble phase: after the page's
 * handlers and each element's own listeners, so a press inside a member has marked its **Press claim**
 * by then (#439). No `pointermove`: a held pointer's moves come through its page-wide feed, and a move
 * that isn't held changes no hover or press.
 */
const AMONG_POINTER: ReadonlyArray<string> = ["pointerover", "pointerout", "pointerdown", "pointerup", "pointercancel"]

/** `node`'s parent, a shadow root's host for the root: the composed tree's. */
const parentOf = (node: Node): Node | null => {
  const parent = node.parentNode
  if (Predicate.isNull(parent)) return null
  if (parent.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
    const host = (parent as ShadowRoot).host
    if (Predicate.isNotUndefined(host)) return host
  }
  return parent
}

/** What names the member a node is, `Option.none()` for none: core's `pointerAmong`'s and `focusAmong`'s. */
type MemberOf = (node: unknown) => Option.Option<unknown>

/** The members `node` is or is inside, innermost first, as `memberOf` names them: for a node with no path, a `relatedTarget`. */
// Per pointer event over the page (#665).
const membersFrom = (node: EventTarget | null, memberOf: MemberOf): ReadonlyArray<unknown> => {
  const found: Array<unknown> = []
  if (isNode(node)) membersUp(node as Node, memberOf, found)
  return found
}

/** `at`'s member, then its ancestors', up the composed tree, into `found`: a recursion as deep as the node. */
const membersUp = (at: Node, memberOf: MemberOf, found: Array<unknown>): void => {
  Option.map(memberOf(at), (member) => found.push(member))
  const parent = parentOf(at)
  if (Predicate.isNotNull(parent)) membersUp(parent, memberOf, found)
}

/** The members an event passed through, innermost first: its composed path's, so a member in a shadow root counts. */
const membersOnPath = (ev: Event, memberOf: MemberOf): ReadonlyArray<unknown> => {
  const found: Array<unknown> = []
  Arr.forEach(ev.composedPath(), (node) => {
    Option.map(memberOf(node), (member) => found.push(member))
  })
  return found
}

/** A member's held pointer, while one pressed on it is held: how its events reach it, and what stops it. */
interface HeldMember {
  toTarget: ((event: InputSource.PointerLikeEvent, raw: unknown) => void) | undefined
  readonly pointers: Set<number>
  stop: () => void
}

/**
 * The pointer events over `memberOf`'s members, each told with its member (core's `pointerAmong`): their
 * enters and leaves, from `pointerover` and `pointerout` (a member's from where the pointer was, outside
 * it; nested members each once, enters outermost first and leaves innermost first, as the DOM's
 * `pointerenter` and `pointerleave`), the downs, releases and cancels over each, and once one goes down on
 * a member, that pointer's events wherever they land, through core's `heldPointer`, made for the member
 * at the down and let go once nothing it pressed is held.
 */
// The page's window: a member in an iframe's document is heard by none (a feed over many targets has no one
// target whose window to take, as each per-target feed does).
const pointerAmongOf = (memberOf: MemberOf): InputFeed.InputFeed<InputSource.TargetEvent<InputSource.PointerLikeEvent>> => (emit) => {
  const win = window
  const held = new Map<unknown, HeldMember>()
  /** `member`'s event: through its held pointer while it has one, else told at once. */
  const deliver = (member: unknown, event: InputSource.PointerLikeEvent, raw: unknown): void => {
    const holding = held.get(member)
    if (Predicate.isUndefined(holding)) return emit({ target: member, event })
    const toTarget = holding.toTarget
    if (Predicate.isUndefined(toTarget)) return emit({ target: member, event })
    toTarget(event, raw)
  }
  /** `member`'s held pointer, made for a down on it. */
  const holdOn = (member: unknown): HeldMember => {
    const known = held.get(member)
    if (Predicate.isNotUndefined(known)) return known
    const made: HeldMember = { toTarget: undefined, pointers: new Set(), stop: constVoid }
    held.set(member, made)
    made.stop = InputSource.heldPointer({
      target: (toTarget) => {
        made.toTarget = toTarget
        return () => {
          made.toTarget = undefined
        }
      },
      global: feedOf(windowOf(member), HELD_POINTER_EVENTS, CAPTURE_PASSIVE, landedOn(member)),
      scroll: scrollFeedOf(member),
    })(
      (event) => {
        emit({ target: member, event })
        // Let go once nothing pressed on it is held: after this dispatch, which may still reach it.
        if (event.type === "down") {
          if (event.adopted !== true) made.pointers.add(event.pointerId)
          return
        }
        if (Bool.not(endsHoldOf(event))) return
        made.pointers.delete(event.pointerId)
        if (made.pointers.size > 0) return
        queueMicrotask(() => {
          if (Bool.or(made.pointers.size > 0, held.get(member) !== made)) return
          held.delete(member)
          made.stop()
        })
      },
      constVoid,
    )
    return made
  }
  /** The members `ev` crossed into (`pointerover`) or out of (`pointerout`): on its path, not where the pointer came from or went. */
  const crossed = (ev: PointerEvent): ReadonlyArray<unknown> => {
    const other = membersFrom(ev.relatedTarget, memberOf)
    // By reference: `Arr.contains`' structural equality would walk a DOM node.
    return Arr.filter(membersOnPath(ev, memberOf), (member) => Bool.not(Arr.some(other, (outside) => outside === member)))
  }
  /** A down, a release or a cancel: each member it passed through hears it, innermost first, a down holding it. */
  const toEach = (ev: PointerEvent): void => {
    const members = membersOnPath(ev, memberOf)
    if (members.length === 0) return
    const event = toPointer(UndefinedOr.getOrThrow(POINTER_TYPE[ev.type]), ev)
    Arr.forEach(members, (member) => {
      if (event.type === "down") holdOn(member)
      deliver(member, event, ev)
    })
  }
  // Each event type's handling, made once a subscription: one record read an event.
  const byType: Readonly<Record<string, (ev: PointerEvent) => void>> = {
    pointerover: (ev) => {
      const entered = crossed(ev)
      if (entered.length === 0) return
      const event = toPointer("enter", ev)
      // Outermost first, as `pointerenter`.
      Arr.forEach(Arr.reverse(entered), (member) => deliver(member, event, ev))
    },
    pointerout: (ev) => {
      const left = crossed(ev)
      if (left.length === 0) return
      const event = toPointer("leave", ev)
      Arr.forEach(left, (member) => deliver(member, event, ev))
    },
    pointerdown: toEach,
    pointerup: toEach,
    pointercancel: toEach,
  }
  const listener = (raw: Event): void => UndefinedOr.getOrThrow(byType[raw.type])(raw as PointerEvent)
  Arr.forEach(AMONG_POINTER, (type) => win.addEventListener(type, listener, PASSIVE))
  return () => {
    Arr.forEach(AMONG_POINTER, (type) => win.removeEventListener(type, listener, PASSIVE))
    Iter.forEach(held, ([, holding]) => holding.stop())
    held.clear()
  }
}

/** Whether `event` ends its pointer's hold: its release, its cancel, or a move with no button pressed. */
const endsHoldOf = (event: InputSource.PointerLikeEvent): boolean => {
  if (event.type === "up") return true
  if (event.type === "cancel") return true
  return Bool.and(event.type === "move", Bool.not(event.pressed))
}

/** The element focus is on in `doc`, inside any shadow root it's in; `null` for none but the page's own. */
const deepActiveOf = (doc: Document): Element | null => {
  const active = doc.activeElement
  if (Bool.or(Predicate.isNull(active), active === doc.body)) return null
  return innermostActive(active as Element)
}

/** The element focus is on inside `el`'s shadow root, and inside its, else `el`. */
const innermostActive = (el: Element): Element => {
  const root = el.shadowRoot
  if (Predicate.isNull(root)) return el
  const inner = root.activeElement
  if (Predicate.isNull(inner)) return el
  return innermostActive(inner)
}

/**
 * The focus and blur of `memberOf`'s members and of what's inside each (core's `focusAmong`): `focusin`
 * and `focusout` on the window in the capture phase, as a target's own feed hears them (#460), told to
 * each member on the event's path, innermost first, a member's own when the path starts at it. A focus
 * already within a member at subscribe is told as its focus first, so its keys press it from now, as a
 * per-target press opens its keys when `focusWithin` says so.
 */
const focusAmongOf = (memberOf: MemberOf): InputFeed.InputFeed<InputSource.TargetEvent<InputSource.FocusLikeEvent>> => (emit) => {
  const win = window
  const listener = (raw: Event): void => {
    const ev = raw as FocusEvent
    const members = membersOnPath(ev, memberOf)
    if (members.length === 0) return
    Arr.forEach(members, (member) => emit({ target: member, event: toPathFocus(ev, member) }))
  }
  const active = deepActiveOf(win.document)
  if (Predicate.isNotNull(active)) {
    Arr.forEach(membersFrom(active, memberOf), (member) =>
      emit({ target: member, event: { type: "focus", timeStamp: win.performance.now(), visible: focusVisible(active), fromTarget: active === member } }))
  }
  Arr.forEach(FOCUS.types, (type) => win.addEventListener(type, listener, FOCUS.capture))
  return () => Arr.forEach(FOCUS.types, (type) => win.removeEventListener(type, listener, FOCUS.capture))
}

/**
 * The DOM's **Input feeds** (#318): each shared per target by core's `InputFeed.byTarget`, so a
 * target's hover, press and drag start one listener-set, not three. `pointer`'s target, page-wide
 * and scroll feeds go through core's `InputSource.heldPointer` (one ordered emit).
 */
const make = Effect.gen(function* () {
  // Client-only (ADR-0021, decision 7): every feed below is built on a live document.
  yield* requireGlobal("DomInput.layer", "document")
  // The Environment's adopted downs (#431): its own, not the module's, so two Environments on a page
  // don't hear each other's (#618, F5).
  const adopters: Adopters = new WeakMap()

  const pointer = InputFeed.byTarget((target) =>
    InputSource.heldPointer({
      target: feedOf(target as EventTarget, POINTER_EVENTS),
      global: feedOf(windowOf(target), HELD_POINTER_EVENTS, CAPTURE_PASSIVE, landedOn(target)),
      scroll: scrollFeedOf(target),
    })
  )
  // A target given Drag controls (#431, #507): the same Held pointer, with the downs handed to it.
  const adoptablePointer = InputFeed.byTarget((target) =>
    InputSource.heldPointer({
      target: feedOf(target as EventTarget, POINTER_EVENTS),
      adopted: adoptedFeedOf(adopters, target),
      global: feedOf(windowOf(target), HELD_POINTER_EVENTS, CAPTURE_PASSIVE, landedOn(target)),
      scroll: scrollFeedOf(target),
    })
  )
  const focus = InputFeed.byTarget(focusOf)
  const keyboard = InputFeed.byTarget(keyboardOf)
  // Feeds over many targets (#665's PR 5): one listener set for each `memberOf`, shared by its watches.
  const pointerAmong = InputFeed.byTarget((memberOf) => pointerAmongOf(memberOf as MemberOf))
  const focusAmong = InputFeed.byTarget((memberOf) => focusAmongOf(memberOf as MemberOf))

  return InputSource.InputSource.of({
    pointer,
    adoptablePointer,
    focus,
    keyboard,
    focusWithin,
    adoptPointer: adoptPointerIn(adopters),
    pointerAmong,
    focusAmong,
  })
})

/**
 * Core's `InputSource` on the DOM's events: each target's pointer, keys and focus, shared by everyone
 * who listens to it, for as long as the Layer lives. Building it on a server fails, with an error that
 * says it's client-only.
 */
// Built with `Layer.effect`, so `make` runs in the layer's scope and the shared helpers' `RcMap`/`RcRef`
// caches live for the layer's lifetime. ADR-0021, decision 7.
export const InputDomLive: Layer.Layer<InputSource.InputSource> = Layer.effect(InputSource.InputSource)(make)
