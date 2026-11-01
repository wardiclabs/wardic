/**
 * The **Flush gate**: the accumulator a binding writes each element's values into, committed once
 * per Refresh frame (ADR-0006, ADR-0031, ADR-0033, ADR-0034). `@wardic/dom/FlushGate` (#132,
 * ADR-0041).
 *
 * It's a service built by a Layer (`layer`) and ended by that Layer's Scope: closing it takes the
 * gate's hook off the Frame loop, cancels a pending frame and clears what it held. Its members
 * are plain functions, called per element and per frame. `make` is the scoped constructor, for a
 * binding that wires it itself.
 *
 * A server render gets `inert`, which does nothing (ADR-0021, decision 9): a value for a binding
 * whose server builds no runtime, or `layerInert` for one whose server runs an Effect program.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { Atom } from "effect/reactivity"
import type * as Scope from "effect/Scope"
import * as internal from "./internal/gate.ts"
import { makeRunner } from "./internal/runner.ts"

/** The gate: what a binding registers its elements with and writes their values into. */
export type Shape = Omit<internal.FlushGate, "dispose">

/** An element's commit target and hooks, given to `register`. */
export type Sink = internal.FlushSink

/** What a binding hands its gate: the `batch` a frame's Starting-style switches run in. */
export type Options = internal.FlushGateOptions

/** The services a gate needs from its Environment. */
export type Services = internal.FlushGateServices

/** The Environment's Flush gate. */
export class FlushGate extends Context.Service<FlushGate, Shape>()("@wardic/dom/FlushGate") {}

/**
 * Build a gate over the context's Renderer, Frame loop and Refresh frame source, in the current
 * Scope: what it forks runs in that Scope, and closing it ends the gate.
 */
export const make: (options: Options) => Effect.Effect<Shape, never, Services | Scope.Scope> = Effect.fnUntraced(
  function* (options: Options) {
    // The gate itself, typed without `dispose`: the Scope ends it. Its runner forks on Effect's
    // default scheduler, whatever call built the Layer (`internal/runner.ts`).
    const gate = internal.makeFlushGate(yield* makeRunner<Services>(), options)
    yield* Effect.addFinalizer(() => Effect.sync(gate.dispose))
    return gate
  })

/** The gate as a Layer: built by `make`, ended by the Layer's Scope. */
export const layer = (options: Options): Layer.Layer<FlushGate, never, Services> => Layer.effect(FlushGate)(make(options))

const noop = (): void => {}

/** What `inert`'s `valueOf` gives: an Atom that stays `undefined`, since nothing is committed on a server. */
const NO_VALUE: Atom.Atom<unknown> = Atom.make<unknown>(undefined)

/**
 * The gate a server render gets (ADR-0021, decision 9): it flushes nothing, so `register` returns a
 * no-op unregister and the rest do nothing (an `afterFlush` call included: no flush comes). Code that grabs the gate at setup and uses it after
 * mount keeps working on a server.
 */
export const inert: Shape = Object.freeze({
  register: () => noop,
  write: noop,
  flushPass: noop,
  release: noop,
  valueOf: () => NO_VALUE,
  afterFlush: noop,
})

/** `inert` as a Layer, for a binding whose server render runs an Effect program. */
export const layerInert: Layer.Layer<FlushGate> = Layer.succeed(FlushGate, inert)
