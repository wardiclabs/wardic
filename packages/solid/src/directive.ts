/**
 * `use:ward` — the Solid directive surface for Wardic motion (ADR-0008 Tier 1).
 *
 * Solid's compiler turns `<div use:ward={config}>` into `ward(el, () => config)`,
 * so {@link ward} receives the live element plus a reactive `Accessor<WardicConfig>`
 * (the compiler always wraps the value in a thunk). The directive drives that GIVEN
 * element through the shared {@link runSpine} — the same path as every Wardic element
 * (ADR-0006, ADR-0034): the gate commits the projected `Patch` onto `el.style` each frame,
 * writing ONLY the animated keys so any inline style the user set (e.g.
 * `style={{ height: "100px" }}`) is preserved. The directive doesn't own the element's
 * `style` prop, so a key both set goes to whichever wrote last: animate a key the
 * element's `style` doesn't set, or use `wardic.*`, whose `style` gives up the keys
 * Wardic holds.
 *
 * Directives run inside the component owner (Solid invokes them during render), so
 * `runSpine`'s `createEffect` / `onCleanup` teardown is owner-scoped — the fibers
 * are interrupted and the element is unregistered from the gate on element removal.
 *
 * CLIENT-ONLY (ADR-0003): `use:ward` runs AFTER hydration, so the `initial` style
 * is NOT applied during SSR / the pre-mount render — the element may flash before
 * the first commit. For an SSR-correct initial (no flash), use {@link useWardic}
 * or `wardic.create` (their `style` carries the Starting style until the first commit).
 *
 * IMPORTANT (use:-import retention): consumers MUST `import { ward } from
 * "@wardic/solid"` for `use:ward` to resolve — Solid's `use:` compiles to a bare
 * `ward(...)` reference, and an unused-looking import would otherwise be
 * tree-shaken away. The import itself retains the symbol; no tree-shaking applies.
 */
import { createUniqueId, type Accessor } from "solid-js"
import { useWardicGate, useWardicRuntime } from "./provider.tsx"
import { runSpine, type WardicConfig } from "./use-wardic.tsx"
import { useVariantContext } from "./variants.ts"

/**
 * `use:ward` directive — drive `el` through Wardic's motion spine.
 *
 * @param el the directive's host element (supplied by Solid).
 * @param value the reactive config accessor (Solid wraps `use:ward={config}` as `() => config`).
 */
export function ward(el: HTMLElement, value: Accessor<WardicConfig>): void {
  runSpine({
    runtime: useWardicRuntime(),
    gate: useWardicGate(),
    id: createUniqueId(),
    el: () => el,
    cfg: value,
    // The directive runs in a component owner, so it inherits any parent variant
    // context (ADR-0007) just like useWardic does.
    parent: useVariantContext(),
    makeSink: (element) => ({ target: element }),
  })
}

declare module "solid-js" {
  // biome-ignore lint/style/useNamingConvention: augmenting Solid's JSX namespace.
  namespace JSX {
    interface Directives {
      ward: WardicConfig
    }
  }
}
