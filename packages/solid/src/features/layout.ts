/**
 * The **`layout` Feature** (#511, ADR-0067 decisions 3 and 15): the projection system (ADR-0009), in a
 * module of its own, so an app that never imports it ships none of it. It's what a Slim element's
 * `layout`, `layoutId` and `layoutScroll` need, and the shared-element crossfades and Switches between
 * `layoutId` twins (ADR-0010). Its top-level calls are marked pure, as `colors`' are.
 *
 * @module
 */
import * as FlushGate from "@wardic/dom/FlushGate"
import * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as UndefinedOr from "effect/UndefinedOr"
import type { Feature } from "../feature.ts"
import { ProjectionOptions, projectionIn, type WardicContextValue } from "../runtime.ts"

/**
 * Layout animations (ADR-0009): a provider's projection system, built once for the provider, over its
 * flush gate and with its reduced motion and scale correctors. Every section with it shares it, as the
 * projection tree is the page's: a `layoutId` pair in two sections still crossfades.
 */
export const layout: Feature<ProjectionSystem.ProjectionSystem, ProjectionSystem.Shape> = {
  name: "layout",
  key: ProjectionSystem.ProjectionSystem,
  layer: /*#__PURE__*/ Layer.effect(ProjectionSystem.ProjectionSystem)(
    /*#__PURE__*/ Effect.flatMap(FlushGate.FlushGate, (gate) => Effect.flatMap(ProjectionOptions, (options) => ProjectionSystem.make(gate, options))),
  ),
}

/** What a component that brings `layout` asks its provider for: one list, so the provider joins it once. */
const BRINGS: ReadonlyArray<Feature> = [layout]

/**
 * The projection system of `value`'s provider, its `layout` Feature built now if nothing has built it
 * yet (#511, decision 12): what a component that brings it works with (`LayoutGroup`, `Reorder`,
 * `useLayoutMember`), whatever its section has. A clear error during a server render, which builds
 * none (ADR-0021).
 */
export const projectionBrought = (value: WardicContextValue): ProjectionSystem.Shape =>
  UndefinedOr.getOrThrowWith(projectionIn(value.features.build(BRINGS)), () => new Error("useWardicProjection: there is no projection system during a server render (ADR-0021)"))
