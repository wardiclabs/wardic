/**
 * The **Complete element**'s own code (#511, ADR-0067; #548): what tells the spine it brings every
 * Feature, and `createWard`, the Complete ward. In a module of its own, apart from the spine every
 * element shares, so an app whose pages use the Slim element (`w.*`) ships no Feature from here, even
 * when one of them uses a Complete element (ADR-0067, *Amendment (#548)*).
 *
 * @module
 */
import type { Accessor } from "solid-js"
import type { WardConfig, WardicVariantLabels } from "./config.ts"
import { createWardWith, type SpineInternals, type Ward } from "./create-ward.tsx"
import { ALL } from "./features/all.ts"
import type { InferredMotion, TargetKey } from "./ward-keys.ts"

/**
 * Create a **Ward**, one element's motion binding (ADR-0042): spread it onto the element
 * (`<div {...ward()}>`) to drive it through Wardic's motion spine. Solid's `create*`
 * convention: it owns computations under the current owner, as `createDrag` does.
 *
 * `config` may be a plain {@link WardConfig} (back-compat) OR an
 * `Accessor<WardConfig>` for reactive config: when the accessor reads signals,
 * a change recomputes the override-stack `target()` and drives a
 * velocity-preserving Retarget through the existing Snapshot wiring. `animate` /
 * `whileHover` / `whileTap` / `transition` / `variants` are read reactively
 * through `cfg()`; `initial` is read EXACTLY ONCE at setup (`untrack`) — it is
 * the SSR/first-frame seed and must never re-seed after mount (ADR-0003).
 *
 * Its keys are inferred from its targets (#305), as a `wardic.*` element's are, so its `transition`
 * takes entries for the keys it animates, `default` and `layout`, and a target's own takes them and
 * `default` ({@link InferredMotion}). The config keeps its own type, so a name it doesn't know is an
 * error as ever.
 *
 * It puts on a **Complete element**, every Feature brought (#511); `w.createWard` puts on a Slim one.
 *
 * @param config initial/animate/whileHover/whileTap + transition (see {@link WardConfig}), or an accessor of it.
 * @returns the Ward: call it to spread onto a JSX element.
 */
export function createWard<
  K extends TargetKey = never,
  N extends string = never,
  LI extends WardicVariantLabels = never,
  LA extends WardicVariantLabels = never,
  D extends boolean | "x" | "y" = never,
>(config: InferredMotion<WardConfig, K, N, LI, LA, D> | Accessor<InferredMotion<WardConfig, K, N, LI, LA, D>>): Ward {
  return createWardWith(config as WardConfig | Accessor<WardConfig>, COMPLETE)
}

/**
 * What a **Complete element** tells the spine (#511, ADR-0067): it brings every Feature. Its forms'
 * (`createWard`, `wardic.*`, `wardic.create`, `use:wardic`) alone: a Slim element's never name it, so
 * its app ships no Feature it doesn't choose.
 */
export const COMPLETE: SpineInternals = { brings: ALL, complete: true }
