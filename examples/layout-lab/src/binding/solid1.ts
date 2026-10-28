/**
 * The lab's binding on Solid 1 (`bun dev`): what the shared UI and entry take from the Solid
 * binding and Solid's web layer, imported as `#binding` (`package.json`'s `imports`). The Solid 2
 * build resolves `#binding` to `solid2.ts` instead (#209 PR 5).
 *
 * @module
 */
import type { LabBinding } from "../lab/lab.ts"
export { useWardicRuntime, wardic, type WardicEnv, WardicProvider } from "@wardic/solid"
export { batch, type JSX } from "solid-js"
export { render } from "solid-js/web"

/** Which binding this build runs, recorded in every saved log. */
export const BINDING: LabBinding = "solid1"
