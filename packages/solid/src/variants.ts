/**
 * Variant context — the binding-owned channel that propagates the current
 * variant NAME (not resolved values) down the component tree (ADR-0007).
 *
 * The doctrine: through the tree the binding propagates the parent's current
 * variant *name* plus the inherited transition; each child holds its own
 * `variants` map and resolves the inherited name LOCALLY (a child's `"open"` is
 * independent of its siblings'). A target then resolves by priority:
 *
 *   local `animate` > parent-context variant name > `initial`.
 *
 * This file owns only the context plumbing; the value's types are Solid-free, in `variant-tree.ts` (#209). `variant-node.ts` decides what each element
 * provides and whether it joins its ancestor (CONTEXT.md, **Variant child**); every
 * `wardic.*` element, component wrap and `<Reorder.Item>` provides it, and a `createWard`
 * spread publishes it through `ward.Provider` (#50).
 *
 * Extensibility (ADR-0007, step 21b): the context value is intentionally an
 * open object — registry / stagger / `when` fields are added later as OPTIONAL
 * members, so adding them never breaks existing readers (they only read the
 * fields they know about).
 */
import { createContext, useContext } from "solid-js"
import type { WardicVariantContextValue } from "./variant-tree.ts"

export type { WardicChildRegistration, WardicStaggerConfig, WardicVariantContextValue } from "./variant-tree.ts"

/**
 * Context carrying the parent's current variant name + inherited transition.
 *
 * Defaults to `undefined` so {@link useVariantContext} reports "no parent
 * variant in scope" (the resolution then falls through to `initial`). A child
 * that finds a context value inherits `context.variant()` as its animate target.
 */
export const WardicVariantContext = createContext<WardicVariantContextValue | undefined>(undefined)

/**
 * Reads the nearest {@link WardicVariantContext} value, or `undefined` when no
 * `ward.Provider` is in scope. `createWard` uses this to apply the ADR-0007
 * resolution priority (local `animate` > inherited variant name > `initial`).
 */
export const useVariantContext = (): WardicVariantContextValue | undefined => useContext(WardicVariantContext)
