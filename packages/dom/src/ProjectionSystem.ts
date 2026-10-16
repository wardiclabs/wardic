/**
 * The **Projection system**: the DOM's engine for the **Projection**, one per Environment a binding
 * builds. It holds every Projection node, runs the Measure pass and the per-frame projection pass,
 * and owns `layoutId` matching (ADR-0009, ADR-0010, ADR-0018). `@wardic/dom/ProjectionSystem`
 * (#132, ADR-0041).
 *
 * It's a service built by a Layer (`layer`, which writes through the Environment's `FlushGate`) and
 * ended by that Layer's Scope: closing it stops the coordinator's run, drops its observers and
 * listeners, and ends what it forked. Built after the gate, it ends before it. Its members are
 * plain functions. `make` is the scoped constructor over any sink, for a binding that wires it
 * itself.
 *
 * A server render builds none (ADR-0021).
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type * as Scope from "effect/Scope"
import * as FlushGate from "./FlushGate.ts"
import * as internal from "./internal/projection.ts"
import { makeRunner } from "./internal/runner.ts"

export {
  type RegisterNodeOptions,
  type ProjectionNodeHandle as NodeHandle,
  type DragProjectionHandle as DragHandle,
  type AnimateLayoutOptions,
  type LayoutTransition,
  type DragTransition,
  DEFAULT_LAYOUT_TRANSITION,
  DEFAULT_DRAG_TRANSITION,
} from "./internal/projection.ts"
export { measureLayoutBox } from "./internal/measure.ts"

/** The engine: what a binding registers its layout elements with. */
export type Shape = Omit<internal.ProjectionSystem, "dispose">

/** What the engine writes each node's projection through: a `FlushGate`'s `write` and `flushPass`. */
export type Sink = internal.ProjectionSink

/** What a binding hands its engine: whether reduced motion applies now (ADR-0029). */
export type Options = internal.ProjectionSystemOptions

/** The services the engine needs from its Environment. */
export type Services = internal.ProjectionServices

/** The Environment's Projection system. */
export class ProjectionSystem extends Context.Service<ProjectionSystem, Shape>()("@wardic/dom/ProjectionSystem") {}

/**
 * Build the engine over `sink`, the context's Frame loop and Renderer, in the current Scope: what
 * it forks runs in that Scope, and closing it ends the engine.
 */
export const make = (sink: Sink, options: Options = {}): Effect.Effect<Shape, never, Services | Scope.Scope> =>
  Effect.gen(function* () {
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
