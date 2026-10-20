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
