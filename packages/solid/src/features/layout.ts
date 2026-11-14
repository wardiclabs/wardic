/**
 * The **`layout` Feature** (#511, ADR-0067 decisions 3 and 15): the projection system (ADR-0009), in a
 * module of its own, so an app that never imports it ships none of it. It's what a Slim element's
 * `layout`, `layoutId` and `layoutScroll` need, and the shared-element crossfades and Switches between
 * `layoutId` twins (ADR-0010). Its top-level calls are marked pure, as `colors`' are.
 *
 * @module
 */
import type * as Announcer from "@wardic/core/Announcer"
import * as DomProjectionSystem from "@wardic/dom/DomProjectionSystem"
import * as FlushGate from "@wardic/dom/FlushGate"
import * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import type * as ReorderController from "@wardic/dom/ReorderController"
import type * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as UndefinedOr from "effect/UndefinedOr"
import type { Feature } from "../feature.ts"
import { ProjectionOptions, projectionIn, type WardicContextValue } from "../runtime.ts"

/**
 * Layout animations: a provider's projection system, built once for the provider, over its
 * flush gate and with its reduced motion and scale correctors. Every section with it shares it, as the
 * projection tree is the page's: a `layoutId` pair in two sections still crossfades.
 */
export const layout: Feature<ProjectionSystem.ProjectionSystem, ProjectionSystem.Shape, "layout"> = {
  name: "layout",
  key: ProjectionSystem.ProjectionSystem,
  // The engine, and what its Reorder controllers hear each Measure pass by, beside it (#618).
  layer: /*#__PURE__*/ Layer.effectContext(
    /*#__PURE__*/ Effect.flatMap(FlushGate.FlushGate, (gate) => Effect.flatMap(ProjectionOptions, (options) => DomProjectionSystem.make(gate, options))),
  ),
}

/** What `layout` brings: the projection system, and what a Reorder controller over it takes beside it. */
export type LayoutServices = Exclude<ReorderController.Services, Announcer.Announcer>

/** What a component that brings `layout` asks its provider for: one list, so the provider joins it once. */
const BRINGS: ReadonlyArray<Feature> = [layout]

/**
 * The projection system of `value`'s provider, its `layout` Feature built now if nothing has built it
 * yet (#511, decision 12): what a component that brings it works with (`LayoutGroup`, `Reorder`,
 * `createProjectionNode`), whatever its section has. A clear error during a server render, which builds
 * none (ADR-0021).
 */
export const projectionBrought = (value: WardicContextValue): ProjectionSystem.Shape =>
  UndefinedOr.getOrThrowWith(projectionIn(value.features.build(BRINGS)), () => new Error("useWardicProjection: there is no projection system during a server render (ADR-0021)"))

/** {@link projectionBrought}'s services, all of them: what a Reorder controller is built with (#618). */
export const layoutBrought = (value: WardicContextValue): Context.Context<LayoutServices> => {
  projectionBrought(value)
  return value.features.build(BRINGS) as Context.Context<LayoutServices>
}
