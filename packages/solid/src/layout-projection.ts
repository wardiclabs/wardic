/**
 * `useWardicProjection` (#548): in a module of its own, beside the `layout` Feature it brings, so the
 * provider every page renders doesn't reach the projection system (ADR-0067, *Amendment (#548)*).
 *
 * @module
 */
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import { projectionBrought } from "./features/layout.ts"
import { fromWardicContext } from "./provider.tsx"

/**
 * Reads the provider's projection system (ADR-0009 — the box-based layout engine), bringing the
 * `layout` Feature (#511, decision 12): built now if nothing has built it yet. For a component that
 * brings it (`LayoutGroup`, `Reorder`, `useLayoutMember`). Throws a clear, named error outside a
 * `WardicProvider`, or during a server render. Must be called within a Solid owner.
 */
export function useWardicProjection(): ProjectionSystem.Shape {
  return fromWardicContext("useWardicProjection", projectionBrought)
}
