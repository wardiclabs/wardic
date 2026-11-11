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
 * Makes a ward: Wardic's motion for an element of your own. Spread what it returns on the element,
 * `{...card()}`, or `{...card({ ref, style })}` to keep your own. `config` is the motion props, or an
 * accessor of them for a config that changes. `card.value(key)` reads what the element shows. This
 * one has every Feature; `w.createWard` has its section's.
 *
 * @example
 * const card = createWard({ initial: { opacity: 0 }, animate: { opacity: 1 } })
 * <article {...card()} />
 * @see https://wardic.dev/reference/solid/elements/ward
 */
// One element's motion binding (ADR-0042), owning computations under the current owner. An accessor
// config is read reactively (a change Retargets, velocity kept); `initial` once at setup (ADR-0003).
// Its keys are inferred from its targets (#305, InferredMotion), so `transition` takes entries for
// them. A Complete element (#511).
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
