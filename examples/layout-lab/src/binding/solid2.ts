/**
 * The lab's binding on Solid 2 (`bun dev:v2`, #209 PR 5): `@wardic/solid/unstable/v2` and
 * `@solidjs/web`, as `#binding` resolves under the `solid2` condition. The same names as
 * `solid1.ts`, so the shared UI and entry compile against either.
 *
 * @module
 */
import type { LabBinding } from "../lab/lab.ts"
export { wardic, type WardicEnv, WardicProvider } from "@wardic/solid/unstable/v2"
// The provider's projection system, for the tree panel (#681): internal to the binding, so the lab takes
// it from the binding's source, the module `@wardic/solid/unstable/v2` itself runs.
export { useWardicProjection } from "../../../../packages/solid/src/unstable/v2/layout-projection.ts"
export { type JSX, render } from "@solidjs/web"

/** Solid 2 has no `batch`: writes batch until its flush. A call, so the shared UI reads the same. */
export const batch = <A>(fn: () => A): A => fn()

/** Which binding this build runs, recorded in every saved log. */
export const BINDING: LabBinding = "solid2"
