/**
 * `WardicConfig` on the Solid 1 binding (#434, Motion's `MotionConfig`): settings for the Wardic
 * elements below it. It provides a context and no runtime, so it nests anywhere under a
 * `WardicProvider`.
 *
 * @module
 */
import { createContext, createMemo, type JSX, useContext } from "solid-js"
import type { WardicVariantTransition } from "./config.ts"
import { configTransitionOf, type WardicConfigValue } from "./config-transition.ts"

const WardicConfigContext = createContext<WardicConfigValue | undefined>(undefined)

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
  const parent = useContext(WardicConfigContext)
  // One object per change, so the elements below share it, and its caches (#66, #301) hit.
  const transition = createMemo(() => configTransitionOf(props.transition, parent))
  return <WardicConfigContext.Provider value={{ transition }}>{props.children}</WardicConfigContext.Provider>
}

/** The nearest `WardicConfig`'s settings, or none. Internal. */
export const useWardicConfig = (): WardicConfigValue | undefined => useContext(WardicConfigContext)
