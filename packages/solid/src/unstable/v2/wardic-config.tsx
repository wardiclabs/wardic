/**
 * `WardicConfig` on the Solid 2 binding (#434, Motion's `MotionConfig`): settings for the Wardic
 * elements below it, as on the Solid 1 binding. A context value is its own provider.
 *
 * @module
 */
import type { JSX } from "@solidjs/web"
import * as Predicate from "effect/Predicate"
import { createContext, createMemo, useContext } from "solid-js"
import type { WardicVariantTransition } from "../../config.ts"
import { configTransitionOf, type WardicConfigValue } from "../../config-transition.ts"
import { CLIENT_ONLY } from "./solid-reactivity.ts"

// `null` for none: Solid 2 throws on a read of a context made with `undefined` and no provider above,
// and most elements have no `WardicConfig` above them.
const WardicConfigContext = createContext<WardicConfigValue | null>(null)

/** `WardicConfig`'s props (#434). */
export interface WardicConfigProps {
  /**
   * The **Config transition**: each Wardic element below runs on it when it gives no `transition` of
   * its own, a Variant child in place of its parent's, as Motion's `MotionConfig` `transition`. It
   * replaces an enclosing config's, or with `inherit: true` lays its own fields over it. Read when
   * each animation starts.
   */
  readonly transition?: WardicVariantTransition | undefined
  readonly children?: JSX.Element
}

/**
 * Settings for the Wardic elements below it (#434, Motion's `MotionConfig`): their default
 * `transition`. Nest it anywhere under a `WardicProvider`; an inner one replaces an outer one's
 * transition, unless it inherits it.
 *
 * ```tsx
 * <WardicConfig transition={{ type: "spring", stiffness: 300, damping: 30 }}>
 *   <wardic.div animate={{ x: 100 }} />
 * </WardicConfig>
 * ```
 */
export function WardicConfig(props: WardicConfigProps): JSX.Element {
  const parent = useWardicConfig()
  // One object per change, so the elements below share it, and its caches (#66, #301) hit. Transparent
  // to hydration ids, as every computation the binding makes (#209).
  const transition = createMemo(() => configTransitionOf(props.transition, parent), CLIENT_ONLY)
  return <WardicConfigContext value={{ transition }}>{props.children}</WardicConfigContext>
}

/** The nearest `WardicConfig`'s settings, or none. Internal. */
export const useWardicConfig = (): WardicConfigValue | undefined => {
  const value = useContext(WardicConfigContext)
  if (Predicate.isNull(value)) return undefined
  return value
}
