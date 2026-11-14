/**
 * `useWardicProjection` (#548): in a module of its own, beside the `layout` Feature it brings, so the
 * provider every page renders doesn't reach the projection system (ADR-0067, *Amendment (#548)*).
 *
 * @module
 */
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import type * as Context from "effect/Context"
import type { ProjectionNodes } from "./features/keys.ts"
import { layoutBrought, type LayoutServices, projectionBrought, projectionNodesBrought } from "./features/layout.ts"
import { fromWardicContext } from "./provider.tsx"

/**
 * Reads the provider's projection system (ADR-0009, the box-based Projection), bringing the
 * `layout` Feature (#511, decision 12): built now if nothing has built it yet. For a component that
 * brings it (`LayoutGroup`, `Reorder`, `createProjectionNode`). Throws a clear, named error outside a
 * `WardicProvider`, or during a server render. Must be called within a Solid owner.
 */
export function useWardicProjection(): ProjectionSystem.Shape {
  return fromWardicContext("useWardicProjection", projectionBrought)
}

/**
 * The `layout` Feature's element code beside {@link useWardicProjection}'s system (#746): what
 * `createProjectionNode` registers its node through, after `useWardicProjection`. Internal.
 */
export function useProjectionNodes(): ProjectionNodes["Service"] {
  return fromWardicContext("useWardicProjection", projectionNodesBrought)
}

/**
 * {@link useWardicProjection}'s services, all of them, for a Reorder controller: the projection system
 * and what it hears each Measure pass by (#618). Internal.
 */
export function useLayoutServices(): Context.Context<LayoutServices> {
  return fromWardicContext("useWardicProjection", layoutBrought)
}
