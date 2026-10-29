/**
 * `WardicConfig` on the Solid 1 binding (#434, Motion's `MotionConfig`): settings for the Wardic
 * elements below it. It provides a context and no runtime, so it nests anywhere under a
 * `WardicProvider`.
 *
 * @module
 */
import { createContext, createMemo, type JSX, useContext } from "solid-js"
import type * as ReducedMotion from "@wardic/core/ReducedMotion"
import type { WardicVariantTransition } from "./config.ts"
import { configReducedMotionOf, configSkipAnimationsOf, configTransitionOf, skipAnimationsOf, type WardicConfigValue } from "./wardic-config-value.ts"

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
  /**
   * How the Wardic elements below honour the user's `prefers-reduced-motion` (ADR-0029), as Motion's
   * `MotionConfig` `reducedMotion`: `"user"` follows it, `"always"` reduces motion whatever it is,
   * `"never"` animates whatever it is. It replaces an enclosing config's, and the `WardicProvider`'s
   * for them; with none, theirs applies. Read when each animation starts.
   */
  readonly reducedMotion?: ReducedMotion.Config | undefined
  /**
   * Every animation of the Wardic elements below lands at its end on the next frame, as Motion's
   * `MotionConfig` `skipAnimations` (#468): its legs, exits, layout animations, a drag's release,
   * `createAnimate` and `createSpring`, each still told. For end-to-end and visual-regression tests.
   * An inner config's `false` animates its subtree again. Read when each animation starts.
   */
  readonly skipAnimations?: boolean | undefined
  readonly children?: JSX.Element
}

/**
 * Settings for the Wardic elements below it (#434, Motion's `MotionConfig`): their default
 * `transition`, their `reducedMotion` and `skipAnimations` (#468). Nest it anywhere under a
 * `WardicProvider`; an inner one replaces an outer one's, unless its transition inherits it.
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
  return <WardicConfigContext.Provider value={{ transition, reducedMotion: () => configReducedMotionOf(props.reducedMotion, parent), skipAnimations: () => configSkipAnimationsOf(props.skipAnimations, parent) }}>{props.children}</WardicConfigContext.Provider>
}

/** The nearest `WardicConfig`'s settings, or none. Internal. */
export const useWardicConfig = (): WardicConfigValue | undefined => useContext(WardicConfigContext)

/** Whether the elements here skip their animations (#468): the nearest `WardicConfig`'s, read when each starts. Internal. */
export const useWardicSkipAnimations = (): (() => boolean) => skipAnimationsOf(useWardicConfig())
