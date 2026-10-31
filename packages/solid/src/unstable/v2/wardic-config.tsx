/**
 * `WardicConfig` on the Solid 2 binding (#434, Motion's `MotionConfig`): settings for the Wardic
 * elements below it, as on the Solid 1 binding. A context value is its own provider.
 *
 * @module
 */
import type { JSX } from "@solidjs/web"
import * as Option from "effect/Option"
import { createContext, createMemo, useContext } from "solid-js"
import type * as ReducedMotion from "@wardic/core/ReducedMotion"
import type { WardicVariantTransition } from "../../config.ts"
import { configIsValidPropOf, configReducedMotionOf, configSkipAnimationsOf, configTransitionOf, type WardicConfigValue } from "../../wardic-config-value.ts"
import { CLIENT_ONLY } from "./solid-reactivity.ts"

// `null` for none, as the binding's other contexts: Solid 2 throws on a read of a context made with
// `undefined` and no provider above, and most elements have no `WardicConfig` above them.
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
  /**
   * Which of the props given a Wardic element's tag below reach the element (#443, Motion's
   * `MotionConfig` `isValidProp`): one it returns `false` for is kept off it, for a prop a styling
   * system reads that shouldn't render as an attribute. Asked of no prop starting with `on`, nor a
   * wrapped component's, which get every prop, as Motion's do. It replaces an enclosing config's. Read as
   * each element is made, for the props it has then.
   */
  readonly isValidProp?: ((key: string) => boolean) | undefined
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
  const parent = useWardicConfig()
  // One object per change, so the elements below share it, and its caches (#66, #301) hit. Transparent
  // to hydration ids, as every computation the binding makes (#209).
  const transition = createMemo(() => configTransitionOf(props.transition, parent), CLIENT_ONLY)
  return <WardicConfigContext value={{ transition, reducedMotion: () => configReducedMotionOf(props.reducedMotion, parent), skipAnimations: () => configSkipAnimationsOf(props.skipAnimations, parent), isValidProp: () => configIsValidPropOf(props.isValidProp, parent) }}>{props.children}</WardicConfigContext>
}

/** The nearest `WardicConfig`'s settings, or none. Internal. */
export const useWardicConfig = (): WardicConfigValue | undefined => Option.getOrUndefined(Option.fromNullishOr(useContext(WardicConfigContext)))

