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
 * `Layer.effect` runs `make` in the layer's own scope (it `Exclude`s `Scope`
 * from the requirements, effect 4's scoped-layer idiom — there is no separate
 * `Layer.scoped`), which the helpers' `RcMap`/`RcRef` need: the ref-counting
 * caches live for the layer's lifetime.
 *
 * Observability (CONTEXT.md observability convention): the shared helpers
 * already carry a `wardic.dom.shared.*` span + a debug-log on subscribe; the
 * per-event mapping path is deliberately unlogged — it is the hot path.
 */
import type { FocusLikeEvent, KeyboardLikeEvent, PointerLikeEvent, WheelLikeEvent } from "@wardic/core"
import { InputSource } from "@wardic/core"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
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

const toPointer = (type: PointerLikeEvent["type"]) =>
  (ev: PointerEvent): PointerLikeEvent => ({
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
 * One `fromEventListener` per DOM event type, mapped to a Like-event. The shared
 * helpers want `Effect<Stream<A>, never, Scope>`; `fromEventListener` is a plain
 * `Stream`, so each `lookup` simply succeeds with the merged stream.
 */
const make = Effect.gen(function* () {
  const pointer = yield* makeSharedByTarget((target) =>
    Effect.succeed(
      Stream.mergeAll(
        POINTER_EVENTS.map((type) =>
          Stream.fromEventListener<PointerEvent>(target as Stream.EventListener<PointerEvent>, type).pipe(
            Stream.map(toPointer(POINTER_TYPE[type]!)),
          )
        ),
        { concurrency: "unbounded" },
      ),
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
