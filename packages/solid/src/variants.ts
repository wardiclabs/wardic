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
 * The variant context: what the nearest variant parent hands its children, its names, transition and
 * orchestration. Wardic's elements read it to follow their parent's variants; a binding of your own
 * provides or reads it the same way. `undefined` outside a parent.
 *
 * @see https://wardic.dev/reference/solid/advanced/variant-context
 */
// ADR-0007.
export const WardicVariantContext = createContext<WardicVariantContextValue | undefined>(undefined)

/**
 * The nearest variant parent's context, or `undefined` outside one: its current variant name,
 * `initial`, transition and orchestration, for an element of your own that follows a parent's variants.
 *
 * @example
 * const parent = useVariantContext()
 * const name = () => parent?.variant()
 * @see https://wardic.dev/reference/solid/advanced/variant-context
 */
// ADR-0007: local `animate` over the inherited name over `initial`.
export const useVariantContext = (): WardicVariantContextValue | undefined => useContext(WardicVariantContext)
