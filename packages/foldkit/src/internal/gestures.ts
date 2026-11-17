/**
 * A `w.*` element's gestures (#793, PR 1; ADR-0071 decision 23; ADR-0047): hover, press, focus and in
 * view, each started the first time a delivery wants it (its `While*`, or a callback of its) while its
 * Feature is built, and kept from then on, as Motion's features start (ADR-0047 decision 5). Each is
 * dom's Feature's `watch`, run in a Scope of the element's own on the provider and closed at its
 * release. A transition sets the element's entry in the Override stack and sends the callback's
 * Message, at the event: a function handler runs inside the recognizer's dispatch, so
 * `stopPropagation()` and `preventDefault()` do what they say, and its Message reaches `update` a
 * microtask later. A gesture wanted without its Feature is inert, and warned once in development.
 *
 * @module
 */
import type * as InputFeed from "@wardic/core/InputFeed"
import type * as Recognizer from "@wardic/core/Recognizer"
import type * as Spine from "@wardic/core/unstable/Spine"
import type * as VariantTree from "@wardic/core/unstable/VariantTree"
import type * as WardicServices from "@wardic/core/unstable/WardicServices"
import * as Report from "@wardic/dom/Report"
import * as GestureFeatures from "@wardic/dom/unstable/GestureFeatures"
import * as GestureInfo from "@wardic/dom/unstable/GestureInfo"
import * as Keys from "@wardic/dom/unstable/features/Keys"
import * as OwnerScope from "@wardic/dom/unstable/OwnerScope"
import * as Press from "@wardic/dom/unstable/Press"
import * as Bool from "effect/Boolean"
import type * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import { identity } from "effect/Function"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Scope from "effect/Scope"
import * as UndefinedOr from "effect/UndefinedOr"
import type * as Ward from "../Ward.ts"
import type { Dispatch } from "./element.ts"
import { featureIn, missingMessage, type Provider } from "./services.ts"
import { DEV } from "@wardic/foldkit/internal/dev"

/** The config the gestures read: an element's, as delivered (`element.ts`'s `Config`). */
type Config = Ward.Config<unknown>

/** What an element's gestures are made with. */
export interface GestureOptions {
  readonly provider: Provider
  readonly element: HTMLElement
  /** The element's config now, as its last delivery gave it: read at each event. */
  readonly config: () => Config
  /** What sends a callback's Message: the element's Mount queue, unless replay has the view. */
  readonly send: (message: unknown) => void
  /** `send` for a one-value handler (`Ward.Handler`): the viewport callbacks'. */
  readonly dispatch: Dispatch
  /** Called after an entry flips, so the element re-resolves its Override stack. */
  readonly onChange: () => void
  /** The element's id, for a report. */
  readonly id: string
}

/** An element's gestures (above). */
export interface Gestures {
  /** Which entries of the Override stack are on now; the drag's off until PR 2. */
  readonly active: () => Spine.Active
  /** Which gestures are on, for the names the element's variant node hands down (#291). */
  readonly states: () => VariantTree.GestureStates
  /** Start what the config wants and the Features give, once each: at mount, at each delivery, and as a Feature arrives. */
  readonly check: () => void
  /** Close every recognizer's Scope: at the element's release. */
  readonly dispose: () => void
}

/** Whether `config` runs the hover recognizer (Motion's hover feature): `whileHover`, or a hover callback. */
const wantsHover = (config: Config): boolean => {
  if (Predicate.isNotUndefined(config.whileHover)) return true
  if (Predicate.isNotUndefined(config.onHoverStart)) return true
  return Predicate.isNotUndefined(config.onHoverEnd)
}

/** Whether `config` runs the press recognizer (Motion's tap feature): `whileTap`, or a tap callback. */
const wantsPress = (config: Config): boolean => {
  if (Predicate.isNotUndefined(config.whileTap)) return true
  if (Predicate.isNotUndefined(config.onTap)) return true
  if (Predicate.isNotUndefined(config.onTapStart)) return true
  return Predicate.isNotUndefined(config.onTapCancel)
}

/** Whether `config` runs the focus recognizer (Motion's focus feature): `whileFocus`. */
const wantsFocus = (config: Config): boolean => Predicate.isNotUndefined(config.whileFocus)

/** Whether `config` runs the in-view recognizer (Motion's inView feature): `whileInView`, or a viewport callback. */
const wantsInView = (config: Config): boolean => {
  if (Predicate.isNotUndefined(config.whileInView)) return true
  if (Predicate.isNotUndefined(config.onViewportEnter)) return true
  return Predicate.isNotUndefined(config.onViewportLeave)
}

/** Each press phase's callback: a press a drag took over has none (Motion tells neither). */
const PRESS_CALLBACK = { start: "onTapStart", tap: "onTap", cancel: "onTapCancel", dragged: undefined } as const

/** Focus as the browser shows it (`:focus-visible`, Motion's `whileFocus`): a keyboard's, not a click's. */
const VISIBLE_FOCUS: Recognizer.FocusOptions = { visible: true }

/** Motion's `amount` as a share of the element: `"some"` any of it, `"all"` all of it. */
const amountOf = (amount: Ward.ViewportOptions["amount"]): number | undefined => {
  if (amount === "some") return 0
  if (amount === "all") return 1
  return amount
}

/**
 * The viewport's `root` element (#793, Q16): `"parent"`, the element's parent; a selector, resolved
 * under the `w.Provider()` element, else the document; none, the window. Read as the recognizer starts.
 */
const viewportRootOf = (provider: Provider, element: Element, root: string | undefined): Element | undefined => {
  if (Predicate.isUndefined(root)) return undefined
  if (root === "parent") return Option.getOrUndefined(Option.fromNullOr(element.parentElement))
  const under: ParentNode = UndefinedOr.match(provider.root, { onUndefined: (): ParentNode => document, onDefined: identity })
  return Option.getOrUndefined(Option.fromNullOr(under.querySelector(root)))
}

/** Motion's `viewport` as core's in-view options, its root resolved now, as the recognizer starts. */
const inViewOptionsOf = (provider: Provider, element: Element, viewport: Ward.ViewportOptions | undefined): Recognizer.InViewOptions =>
  UndefinedOr.match(viewport, {
    onUndefined: () => ({}),
    onDefined: (v) => ({ once: v.once, margin: v.margin, amount: amountOf(v.amount), root: viewportRootOf(provider, element, v.root) }),
  })

/** A gesture's recognizer, once started: its Scope, closed at the element's release. */
interface Started {
  hover: Scope.Closeable | undefined
  press: Scope.Closeable | undefined
  focus: Scope.Closeable | undefined
  inView: Scope.Closeable | undefined
}

/** Which gestures are on: the element's entries in the Override stack (`Spine.Active`), the drag's apart. */
interface On {
  hovered: boolean
  pressed: boolean
  focused: boolean
  inView: boolean
}

/** A recognizer's end that failed, at the element's release. */
const END_FAILED = "wardic.gesture: a recognizer's end failed"

/**
 * Send `handler`'s Message for `event` and `info` (decision 23): a Message as it is; a function's
 * answer, an `Option.none()` sending nothing.
 */
const tell = <Event, Info>(send: (message: unknown) => void, handler: Ward.GestureHandler<unknown, Event, Info> | undefined, event: Event, info: Info): void => {
  if (Predicate.isUndefined(handler)) return
  if (Bool.not(Predicate.isFunction(handler))) {
    send(handler)
    return
  }
  const out = (handler as (event: Event, info: Info) => unknown)(event, info)
  if (Option.isOption(out)) {
    Option.map(out, send)
    return
  }
  send(out)
}

/** An element's gestures (above): nothing started until `check` wants it. */
export const gesturesOf = ({ provider, element, config, send, dispatch, onChange, id }: GestureOptions): Gestures => {
  const started: Started = { hover: undefined, press: undefined, focus: undefined, inView: undefined }
  const on: On = { hovered: false, pressed: false, focused: false, inView: false }
  /** A handler of the app's threw inside the recognizer's dispatch: reported, and the gesture goes on. */
  const onDefect: InputFeed.OnDefect = (cause: Cause.Cause<never>): void => {
    provider.runtime.runFork(Report.failure("wardic.gesture: a callback failed", cause).pipe(Effect.annotateLogs({ id })))
  }
  /** Run `watch` in a Scope of the element's own, on the provider, whose services (the Probe, for in view) it has. */
  const run = (watch: Effect.Effect<void, never, Scope.Scope | WardicServices.WardicServices>): Scope.Closeable => {
    const scope = OwnerScope.open(provider.runtime)
    provider.runtime.runSync(watch.pipe(Scope.provide(scope)))
    return scope
  }
  /** Development's word on a gesture wanted without its Feature (#511): once per provider, and not while a load is on its way (Q15). */
  const missing = (name: keyof typeof GestureFeatures.GESTURE_WORDS): void => {
    if (DEV && Bool.not(provider.features.pending())) provider.registry.warnOnce(name, missingMessage(name, GestureFeatures.GESTURE_WORDS[name]))
  }
  const hovered = (edge: Recognizer.Edge): void => {
    const c = config()
    const handler = Bool.match(edge.active, { onTrue: () => c.onHoverStart, onFalse: () => c.onHoverEnd })
    tell(send, handler, edge.event.raw as PointerEvent, GestureInfo.pointInfoOf(edge.event))
    on.hovered = edge.active
    onChange()
  }
  const pressedBy = (press: Recognizer.PressEvent): void => {
    const name = PRESS_CALLBACK[press.phase]
    if (Predicate.isNotUndefined(name)) tell(send, config()[name], press.event.raw as Ward.PressEvent, GestureInfo.pressInfoOf(press, element))
    on.pressed = press.phase === "start"
    onChange()
  }
  /** Whether its presses reach its pressable ancestors (#439): its `propagate`, read at each press's start. */
  const propagates = (): boolean => Press.tapPropagates(config().propagate)
  const focused = (has: boolean): void => {
    on.focused = has
    onChange()
  }
  const viewed = (edge: Recognizer.ViewEdge): void => {
    const c = config()
    const handler = Bool.match(edge.active, { onTrue: () => c.onViewportEnter, onFalse: () => c.onViewportLeave })
    UndefinedOr.map(handler, (h) => dispatch(h)(edge.raw as IntersectionObserverEntry))
    on.inView = edge.active
    onChange()
  }
  const check = (): void => {
    const c = config()
    if (Bool.and(Predicate.isUndefined(started.hover), wantsHover(c))) {
      UndefinedOr.match(featureIn(provider, Keys.HoverGesture), {
        onUndefined: () => missing("hover"),
        onDefined: (hover) => {
          started.hover = run(hover.watch(element, { on: hovered, onDefect }))
        },
      })
    }
    if (Bool.and(Predicate.isUndefined(started.press), wantsPress(c))) {
      UndefinedOr.match(featureIn(provider, Keys.PressGesture), {
        onUndefined: () => missing("press"),
        onDefined: (press) => {
          started.press = run(press.watch(element, { on: pressedBy, onDefect }, false, propagates))
        },
      })
    }
    if (Bool.and(Predicate.isUndefined(started.focus), wantsFocus(c))) {
      UndefinedOr.match(featureIn(provider, Keys.FocusGesture), {
        onUndefined: () => missing("focus"),
        onDefined: (focus) => {
          started.focus = run(focus.watch(element, VISIBLE_FOCUS, { on: focused, onDefect }))
        },
      })
    }
    // In view as its `viewport` says, read as it starts (Motion's), over the Environment's Probe.
    if (Bool.and(Predicate.isUndefined(started.inView), wantsInView(c))) {
      UndefinedOr.match(featureIn(provider, Keys.InViewGesture), {
        onUndefined: () => missing("inView"),
        onDefined: (inView) => {
          started.inView = run(inView.watch(element, inViewOptionsOf(provider, element, c.viewport), { on: viewed, onDefect }))
        },
      })
    }
  }
  return {
    active: () => ({ inView: on.inView, focused: on.focused, hovered: on.hovered, pressed: on.pressed, dragged: false, dragging: false }),
    states: () => ({ inView: on.inView, focused: on.focused, hovered: on.hovered, pressed: on.pressed, dragged: false }),
    check,
    dispose: () => {
      UndefinedOr.map(started.hover, (scope) => OwnerScope.close(provider.runtime, scope, END_FAILED))
      UndefinedOr.map(started.press, (scope) => OwnerScope.close(provider.runtime, scope, END_FAILED))
      UndefinedOr.map(started.focus, (scope) => OwnerScope.close(provider.runtime, scope, END_FAILED))
      UndefinedOr.map(started.inView, (scope) => OwnerScope.close(provider.runtime, scope, END_FAILED))
    },
  }
}
