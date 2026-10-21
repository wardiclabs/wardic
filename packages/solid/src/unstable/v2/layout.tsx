/**
 * `<LayoutGroup>` on Solid 2 (#209, ADR-0009): a grouping boundary whose `layoutDependency`
 * re-measures the whole projection tree, as the Solid 1 binding's. A ward's own layout node is
 * registered at its mount (`ward.tsx`, through `layout-member.ts`).
 *
 * @module
 */
import { isServer, type JSX } from "@solidjs/web"
import { createEffect } from "solid-js"
import { useWardicProjection } from "./provider.tsx"
import { CLIENT_ONLY_DEFERRED } from "./solid-reactivity.ts"

/**
 * A grouping boundary for layout elements. Its `layoutDependency`, a value whose change requests a
 * re-measure of every layout node (sibling reflow falls out), is read in an effect.
 */
export function LayoutGroup(props: { readonly children?: JSX.Element; readonly layoutDependency?: unknown }): JSX.Element {
  // A server render has no projection system to re-measure (ADR-0021).
  if (isServer) return <>{props.children}</>
  const projection = useWardicProjection()
  // Not at mount: nodes measure themselves as they register.
  createEffect(
    () => props.layoutDependency,
    () => {
      projection.notify()
    },
    CLIENT_ONLY_DEFERRED,
  )
  // Its children in JSX, so they're read where they track: returned from the body, they were read
  // once, and `<LayoutGroup>{open() ? a : b}</LayoutGroup>` never switched (#257's audit).
  return <>{props.children}</>
}
