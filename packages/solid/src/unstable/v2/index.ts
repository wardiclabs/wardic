/**
 * `@wardic/solid/unstable/v2`: Wardic for Solid 2 (#209). Unstable: it tracks Solid 2's release
 * candidate (`solid-js@2.0.0-rc`), and any release may change it. It lives here, inside
 * `@wardic/solid`, until Solid 2.0 is stable, when `@wardic/solid` itself becomes it and the Solid 1
 * binding moves to `@wardic/solid/v1`.
 *
 * @module
 */
export {
  runScoped,
  useAnimateLayout,
  useWardicFiber,
  useWardicGate,
  useWardicRuntime,
  WardicProvider,
} from "./provider.tsx"
export type { AnimateLayout, WardicEnv, WardicRuntime, WardicServices } from "../../runtime.ts"

/**
 * `ward(config)`: a **Ward**, one element's motion, as a ref that carries its props. Spread it
 * (`<div {...ward(config)} />`, its Starting style in server HTML) or give it to `ref`
 * (`ref={ward(config)}`, client-only). A kept ward has `.Provider` for its Variant children,
 * `.read(key)` and `.atom(key)` for its values.
 */
export { type Ward, type WardConfig, type WardProps, type WardRead, type WardStyle, ward } from "./ward.tsx"

/** The variant context (ADR-0007): what a ward's `.Provider` and a `wardic.*` element hand their children. */
export { useVariantContext, WardicVariantContext } from "./variant-node.ts"
export type { WardicVariantContextValue } from "../../variant-tree.ts"
export type { WardicOrchestration, WardicReducedMotion, WardicTransformShorthands, WardicTransition, WardicValues } from "../../config.ts"

/**
 * `wardic.<tag>` and `wardic.create(tag | Component)` (ADR-0008): Motion's components, with the
 * element's own props and the motion props; a `wardic.create(Component)` component forwards its `ref`.
 */
export { type Wardic, type WardicProps, type WardicWrappable, wardic } from "./wardic.tsx"
export type { WardicMotionProps } from "../../motion-props.ts"
