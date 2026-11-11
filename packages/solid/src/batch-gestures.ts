/**
 * A Batch's members' hover and presses (#665's PR 5, ADR-0070 decision 12, Q56–Q62): watched from one
 * source each over the gestures' input, each member's `whileHover` and `whileTap` laid over its
 * `animate` targets as they start and lifted as they end, and its events told. Loaded at a Batch's first
 * need (`lazy-batch-gestures.ts`, Q62), so a Batch with no gesture ships none of it. Shared by both
 * bindings.
 *
 * @module
 */
// Q56: core's `Recognizer.watchHoverAmong` and `watchPressAmong`, over the InputSource's feeds over many
// targets (Q17's probe: a listener set per member cost 12 ms and 4.6 KB a member per 1,000). The input is
// the gesture Features' (`features/input.ts`), brought as the Batch listens (ADR-0067 decision 12).
import * as InputSource from "@wardic/core/InputSource"
import * as Recognizer from "@wardic/core/Recognizer"
import * as DomInput from "@wardic/dom/DomInput"
import * as Report from "@wardic/dom/Report"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import type * as Cause from "effect/Cause"
import type * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as Scope from "effect/Scope"
import * as UndefinedOr from "effect/UndefinedOr"
import { type BatchGestureHost, type BatchGestureLayer, type BatchGestureTold, fail, objectFormOf, objectFormValues } from "./batch.ts"
import type { WardicTransition } from "./config.ts"
import type { Feature } from "./feature.ts"
import { input } from "./features/input.ts"
import { serviceOf } from "./gesture-features.ts"
import { pointInfoOf, pressInfoOf } from "./gesture-info.ts"
import * as OwnerScope from "./owner-scope.ts"
import type { WardicRuntime } from "./runtime.ts"

/** What a Batch's gestures stand on, which it brings (ADR-0067 decision 12): the gestures' input. */
export const BATCH_GESTURES: ReadonlyArray<Feature> = [{ name: "createBatch's gestures", key: InputSource.InputSource, layer: input }]

/** A Batch's gestures once their code has loaded: each watched over its host, a pressable element made focusable, all stopped at `close`. */
export interface BatchGesturesOn {
  readonly listen: (gesture: "hover" | "press", host: BatchGestureHost) => void
  readonly focusable: (el: Element) => void
  readonly close: () => void
}

/** A gesture of a member's, and where the Batch's config gives it. */
interface Gesture {
  readonly layer: BatchGestureLayer
  /** Its config key, as an error names it. */
  readonly name: "whileHover" | "whileTap"
  readonly given: (host: BatchGestureHost) => unknown
}

const HOVER: Gesture = { layer: "hover", name: "whileHover", given: (host) => host.hoverGiven }
const PRESS: Gesture = { layer: "press", name: "whileTap", given: (host) => host.tapGiven }

/** A hover's events, by whether it's on. */
const HOVER_EVENT = { true: "hoverStart", false: "hoverEnd" } as const

/** Each press phase's event: a press a drag took over has none, as a Wardic element's. */
const PRESS_EVENT = { start: "pressStart", tap: "tap", cancel: "tapCancel", dragged: undefined } as const

/**
 * `gesture`'s values for member `i` now (Q58), by key index, `NaN` for a key they don't give: an object's,
 * less its `transition`, or a function's, called untracked with its index (keyed: its item and index).
 * A key the Batch doesn't have, or a value that isn't a number, is an error naming it.
 */
const valuesOf = (host: BatchGestureHost, gesture: Gesture, given: unknown, i: number): Float64Array => {
  const values: Readonly<Record<string, unknown>> = Bool.match(Predicate.isFunction(given), {
    onTrue: () =>
      host.untrack(() =>
        Bool.match(host.keyed, {
          onTrue: () => (given as (item: unknown, i: number) => Readonly<Record<string, unknown>>)(host.itemOf(i), host.indexOf(i)),
          onFalse: () => (given as (i: number) => Readonly<Record<string, unknown>>)(i),
        })
      ),
    onFalse: () => objectFormValues(given),
  })
  const keys = host.keys()
  const out = new Float64Array(keys.length).fill(Number.NaN)
  // Per key of a gesture, once at its start: statements.
  Arr.forEach(Rec.keys(values), (key) => {
    const value = values[key]
    if (Predicate.isUndefined(value)) return
    const k = keys.indexOf(key)
    if (k === -1) return fail(`${host.nameOf(i)}'s \`${gesture.name}\` gives "${key}", which isn't one of its keys (${keys.join(", ")}): a Batch's keys are fixed when it's made`)
    if (!Predicate.isNumber(value)) return fail(`${host.nameOf(i)}'s \`${gesture.name}\` "${key}" is ${JSON.stringify(value)}: a Batch's values are numbers`)
    out[k] = value
  })
  return out
}

/** A gesture's own transition, its object's (Q58), else the Batch's. */
const transitionOf = (host: BatchGestureHost, given: unknown): WardicTransition | undefined => {
  const own = UndefinedOr.map(objectFormOf(given), (object) => object.transition as WardicTransition | undefined)
  if (Predicate.isNotUndefined(own)) return own
  return host.configured()
}

/**
 * Member `i`'s `gesture` on, from its given values on their transition (Q58), or off: back to the layer
 * under it, a press's to its hover's on the hover's transition while it's hovered (a Wardic element's
 * way, Motion's), else to `animate`'s on the Batch's (Q59).
 */
const turn = (host: BatchGestureHost, gesture: Gesture, i: number, on: boolean): void => {
  const given = gesture.given(host)
  if (Predicate.isUndefined(given)) return
  if (on === host.layered(gesture.layer, i)) return
  if (on) return host.layer(gesture.layer, i, valuesOf(host, gesture, given, i), transitionOf(host, given))
  if (Bool.and(gesture === PRESS, host.layered("hover", i))) return host.layer(gesture.layer, i, undefined, transitionOf(host, host.hoverGiven))
  host.layer(gesture.layer, i, undefined, host.configured())
}

/** A member's gesture event, told its binding with its point, element and member (Q60). */
const tell = (host: BatchGestureHost, i: number, told: Omit<BatchGestureTold, "i" | "item">): void =>
  host.tell({ ...told, i: host.indexOf(i), item: host.itemOf(i) })

/**
 * A Batch's gestures on `runtime`, over the input `services` gives, in a Scope of their own until `close`;
 * a handler's throw reported, and the watch goes on.
 */
export const batchGesturesOn = (runtime: WardicRuntime, services: () => Context.Context<never>): BatchGesturesOn => {
  const scope = OwnerScope.open(runtime)
  const onDefect = (cause: Cause.Cause<never>): void => {
    runtime.runFork(Report.failure("createBatch: a gesture failed", cause))
  }
  const run = (watch: Effect.Effect<void, never, Scope.Scope | InputSource.InputSource>): void => {
    runtime.runSync(watch.pipe(Effect.provideService(InputSource.InputSource, serviceOf(services(), InputSource.InputSource)), Scope.provide(scope)))
  }
  const hoverOf = (host: BatchGestureHost) => (element: unknown, edge: Recognizer.Edge): void => {
    const i = host.memberAt(element)
    if (Predicate.isUndefined(i)) return
    turn(host, HOVER, i, edge.active)
    const event = edge.event
    tell(host, i, { name: HOVER_EVENT[`${edge.active}`], raw: event.raw, ...pointInfoOf(event), input: undefined, element: element as Element })
  }
  const pressOf = (host: BatchGestureHost) => (element: unknown, press: Recognizer.PressEvent): void => {
    const i = host.memberAt(element)
    if (Predicate.isUndefined(i)) return
    turn(host, PRESS, i, press.phase === "start")
    const name = PRESS_EVENT[press.phase]
    if (Predicate.isUndefined(name)) return
    tell(host, i, { name, raw: press.event.raw, ...pressInfoOf(press, element as Element), element: element as Element })
  }
  // Each gesture's watch, over its host.
  const watches: Readonly<Record<"hover" | "press", (host: BatchGestureHost) => void>> = {
    hover: (host) => run(Recognizer.watchHoverAmong(host.memberElementOf, { on: hoverOf(host), onDefect })),
    press: (host) => run(Recognizer.watchPressAmong(host.memberElementOf, { on: pressOf(host), onDefect })),
  }
  return {
    listen: (gesture, host) => watches[gesture](host),
    focusable: DomInput.makeFocusable,
    close: () => OwnerScope.close(runtime, scope, "createBatch: a gesture's finalizer failed"),
  }
}
