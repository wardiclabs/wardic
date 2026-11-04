/**
 * `WardicConfig` on the Solid 1 binding (#434, Motion's `MotionConfig`): settings for the Wardic
 * elements below it. It provides a context and no runtime, so it nests anywhere under a
 * `WardicProvider`.
 *
 * @module
 */
import { createContext, createMemo, type JSX, useContext } from "solid-js"
import type * as ReducedMotion from "@wardic/core/ReducedMotion"
import type { WardicTransformPoint, WardicVariantTransition } from "./config.ts"
import { configIsValidPropOf, configReducedMotionOf, configTransformPagePointOf, configSkipAnimationsOf, configTransitionOf, type WardicConfigValue } from "./wardic-config-value.ts"

const WardicConfigContext = createContext<WardicConfigValue | undefined>(undefined)

/** `WardicConfig`'s props. */
export interface WardicConfigProps {
  /**
   * The **Config transition**: each Wardic element below runs on it when it gives no `transition` of
   * its own, a Variant child in place of its parent's, as Motion's `MotionConfig` `transition`. It
   * replaces an enclosing config's, or with `inherit: true` lays its own fields over it. Read when
   * each animation starts.
   */
  readonly transition?: WardicVariantTransition | undefined
  /**
   * How the Wardic elements below honour the user's `prefers-reduced-motion`, as Motion's
   * `MotionConfig` `reducedMotion`: `"user"` follows it, `"always"` reduces motion whatever it is,
   * `"never"` animates whatever it is. It replaces an enclosing config's, and the `WardicProvider`'s
   * for them; with none, theirs applies. Read when each animation starts.
   */
  readonly reducedMotion?: ReducedMotion.Config | undefined
  /**
   * Every animation of the Wardic elements below lands at its end on the next frame, as Motion's
   * `MotionConfig` `skipAnimations`: its legs, exits, layout animations, a drag's release,
   * `createAnimate` and `createSpring`, each still told. For end-to-end and visual-regression tests.
   * An inner config's `false` animates its subtree again. Read when each animation starts.
   */
  readonly skipAnimations?: boolean | undefined
  /**
   * Which of the props given a Wardic element's tag below reach the element (Motion's
   * `MotionConfig` `isValidProp`): one it returns `false` for is kept off it, for a prop a styling
   * system reads that shouldn't render as an attribute. Asked of no prop starting with `on`, nor a
   * wrapped component's, which get every prop, as Motion's do. It replaces an enclosing config's. Read as
   * each element is made, for the props it has then.
   */
  readonly isValidProp?: ((key: string) => boolean) | undefined
  /**
   * Where the points a drag or a pan below uses are (Motion's `MotionConfig`
   * `transformPagePoint`): handed each point in the viewport's coordinates, it gives the one the
   * gesture uses. Read at each drag or pan start, and applied to its down, each move, a drag
   * controls' start and its snap to the cursor, and to the boxes drag constraints are measured from;
   * never to a layout animation's boxes, which Wardic already reads through their ancestors'
   * transforms. `correctParentTransform(parent)` makes one for a zoomed or rotated parent, and
   * `transformViewBoxPoint(svg)` one for an SVG's viewBox. It replaces an enclosing config's.
   */
  readonly transformPagePoint?: WardicTransformPoint | undefined
  readonly children?: JSX.Element
}

/**
 * Settings for the Wardic elements below it (Motion's `MotionConfig`): their default
 * `transition`, their `reducedMotion` and `skipAnimations`. Nest it anywhere under a
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
  return <WardicConfigContext.Provider value={{ transition, reducedMotion: () => configReducedMotionOf(props.reducedMotion, parent), skipAnimations: () => configSkipAnimationsOf(props.skipAnimations, parent), isValidProp: () => configIsValidPropOf(props.isValidProp, parent), transformPagePoint: () => configTransformPagePointOf(props.transformPagePoint, parent) }}>{props.children}</WardicConfigContext.Provider>
}

/** The nearest `WardicConfig`'s settings, or none. Internal. */
export const useWardicConfig = (): WardicConfigValue | undefined => useContext(WardicConfigContext)
