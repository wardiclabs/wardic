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
 * This file owns only the context plumbing. `useWardic` reads it and applies the
 * resolution priority; `ward.Provider` (an added property on the `useWardic`
 * callable) publishes the parent instance's current variant name down the tree.
 *
 * Extensibility (ADR-0007, step 21b): the context value is intentionally an
 * open object — registry / stagger / `when` fields are added later as OPTIONAL
 * members, so adding them never breaks existing readers (they only read the
 * fields they know about).
 */
import type { StaggerOrigin } from "@wardic/core"
import { type Accessor, createContext, useContext } from "solid-js"
import type { WardicTransition } from "./use-wardic.tsx"

/**
 * The handle a child receives from {@link WardicVariantContextValue.register}
 * when it mounts under a `ward.Provider` (ADR-0007, step 21b).
 *
 * - `index` / `total` — the child's SNAPSHOT position + sibling count for the
 *   CURRENT transition. The Provider rewrites these only at the trigger (the
 *   parent variant changing), never mid-transition; the child reads them to feed
 *   core `stagger(amount, { from })(index, total)`.
 * - `setSettled` — the child reports its own settle state (true when its spine
 *   settles, false while animating), feeding the parent's `allChildrenSettled`.
 * - `dispose` — removes this record from the registry on unmount.
 */
export interface WardicChildRegistration {
  readonly index: Accessor<number>
  readonly total: Accessor<number>
  readonly setSettled: (settled: boolean) => void
  readonly dispose: () => void
}

/** The resolved stagger config the Provider exposes to its children. */
export interface WardicStaggerConfig {
  /** Seconds between siblings (core `stagger` amount). */
  readonly amount: number
  /** Fixed offset added to every child's computed delay. */
  readonly delayChildren: number
  /** Origin the stagger distance grows outward from (core option). */
  readonly from: StaggerOrigin
  /** `1` forward (index = position), `-1` reverses the effective index. */
  readonly direction: 1 | -1
}

/**
 * The value carried down the tree by {@link WardicVariantContext}.
 *
 * - `variant` — the parent instance's CURRENT variant NAME (reactive). It is
 *   `undefined` when the parent's resolved `animate` is a `Values` map rather
 *   than a name (propagation is by name only — a values map has no name to
 *   inherit).
 * - `transition` — the parent's transition, inherited as the DEFAULT for
 *   children that supply no local `transition`.
 *
 * Designed to extend without breaking: 21b adds optional `registry` / `stagger`
 * / `when` members; readers consume only the fields they know.
 */
export interface WardicVariantContextValue {
  /** The parent's current variant NAME, reactive (undefined if it's a values map). */
  readonly variant: Accessor<string | undefined>
  /** The parent's transition, inherited as the default for children. */
  readonly transition: Accessor<WardicTransition | undefined>
  /**
   * Register this child with the parent's ordered registry (call on mount).
   * Returns the child's reactive snapshot index/total + a settle reporter +
   * a disposer. Children register in mount order; the Provider snapshots that
   * order at each transition trigger (ADR-0007 snapshot-at-trigger).
   */
  readonly register: () => WardicChildRegistration
  /**
   * The parent's resolved stagger config (from `config.transition`): amount =
   * `staggerChildren`, plus `delayChildren` / `from` / `direction`.
   */
  readonly stagger: Accessor<WardicStaggerConfig>
  /** The parent's `when` mode, or `undefined` (default concurrent). */
  readonly when: Accessor<"beforeChildren" | "afterChildren" | undefined>
  /**
   * Whether children may START their inherited-variant Retarget yet. True
   * immediately UNLESS `when === "beforeChildren"`, in which case it flips true
   * once the parent's own variant animation settles.
   */
  readonly childrenMayStart: Accessor<boolean>
  /** Whether EVERY registered child has reported its spine as settled. */
  readonly allChildrenSettled: Accessor<boolean>
}

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
 * `ward.Provider` is in scope. `useWardic` uses this to apply the ADR-0007
 * resolution priority (local `animate` > inherited variant name > `initial`).
 */
export const useVariantContext = (): WardicVariantContextValue | undefined => useContext(WardicVariantContext)
