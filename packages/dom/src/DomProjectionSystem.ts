/**
 * The DOM's layout engine: `layer` builds the Projection system, writing through the Environment's
 * `FlushGate`, and `make` builds it over any sink, for a binding that wires it itself. Only a binding's
 * layout feature imports it, so a page that never lays out ships none of it. Closing its Scope stops the
 * engine: its run, its observers and listeners, and what it forked. Built after the gate, it ends before
 * it.
 *
 * @example
 * import * as DomProjectionSystem from "@wardic/dom/DomProjectionSystem"
 *
 * const layout = DomProjectionSystem.layer().pipe(Layer.provide(FlushGate.layer({ batch: (apply) => apply() })))
 */
// The DOM's **Projection system** engine (#548, ADR-0041's `Dom` implementations), apart from
// `ProjectionSystem`'s key and types (ADR-0067, *Amendment (#548)*). Its members are plain functions.
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type * as Scope from "effect/Scope"
import * as FlushGate from "./FlushGate.ts"
import * as internal from "./internal/projection.ts"
import { makeRunner } from "./internal/runner.ts"
import { ProjectionSystem, type Options, type Services, type Shape, type Sink } from "./ProjectionSystem.ts"

/**
 * Build the engine over `sink`, the context's Frame loop and Renderer, in the current Scope: what
 * it forks runs in that Scope, and closing it ends the engine.
 */
export const make: (sink: Sink, options?: Options) => Effect.Effect<Shape, never, Services | Scope.Scope> = /*#__PURE__*/ Effect.fnUntraced(
  function* (sink: Sink, options: Options = {}) {
    // The same object the engine's own lookups key on (`onPassEnd`), typed without `dispose`:
    // the Scope ends it. Its runner forks on Effect's default scheduler, whatever call built the
    // Layer (`internal/runner.ts`).
    const system = internal.makeProjectionSystem(yield* makeRunner<Services>(), sink, options)
    yield* Effect.addFinalizer(() => Effect.sync(system.dispose))
    return system
  })

/** The engine as a Layer, writing through the Environment's `FlushGate`: built by `make`, ended by the Layer's Scope. */
export const layer = (options: Options = {}): Layer.Layer<ProjectionSystem, never, FlushGate.FlushGate | Services> =>
  Layer.effect(ProjectionSystem)(Effect.flatMap(Effect.service(FlushGate.FlushGate), (gate) => make(gate, options)))
