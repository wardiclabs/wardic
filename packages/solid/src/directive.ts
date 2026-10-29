/**
 * `use:wardic` — the Solid directive surface for Wardic motion (ADR-0008 Tier 1, ADR-0042):
 * it puts a **Ward** on the element it's on. It's the `wardic` export itself, called:
 * `wardic.<tag>` and `wardic.create` are its properties (`wardic.tsx`).
 *
 * Solid's compiler turns `<div use:wardic={config}>` into `wardic(el, () => config)`,
 * so {@link wardicDirective} receives the live element plus a reactive `Accessor<WardConfig>`
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
 * CLIENT-ONLY (ADR-0003): `use:wardic` runs AFTER hydration, so the `initial` style
 * is NOT applied during SSR / the pre-mount render — the element may flash before
 * the first commit. For an SSR-correct initial (no flash), use `createWard`
 * or `wardic.create` (their `style` carries the Starting style until the first commit).
 *
 * `use:wardic` resolves through the `wardic` import (`import { wardic } from
 * "@wardic/solid"`): Solid's `use:` compiles to a bare `wardic(...)` reference. A
 * local Ward can't shadow it, since a Ward is named after its element or `ward`
 * (ADR-0042, the reason the directive isn't `use:wardic`).
 */
import { constVoid } from "effect/Function"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import { createUniqueId, type Accessor, untrack } from "solid-js"
import { useWardicGate, useWardicRuntime } from "./provider.tsx"
import { controlledOf, runSpine } from "./create-ward.tsx"
import { usePresenceContext } from "./presence.tsx"
import { madeWith } from "./spine.ts"
import type { WardConfig } from "./config.ts"
import { createVariantNode } from "./variant-node.ts"
import { useVariantContext } from "./variants.ts"

/**
 * The `use:wardic` directive — drive `el` through Wardic's motion spine. An arrow
 * function, so the `wardic` Proxy over it has no non-configurable `prototype` to keep.
 *
 * @param el the directive's host element (supplied by Solid).
 * @param value the reactive config accessor (Solid wraps `use:wardic={config}` as `() => config`).
 */
export const wardicDirective = (el: HTMLElement, value: Accessor<WardConfig>): void => {
  // The directive runs in a component owner, so it reads the nearest variant context
  // (ADR-0007) and, as a Variant child, joins it (#50). It renders no children, so it
  // provides none.
  // Animation controls for its `animate` (#433): each change they make is its entry.
  const { cfg, controls } = controlledOf(value)
  const node = createVariantNode(cfg, useVariantContext(), UndefinedOr.map(controls, (c) => c.change))
  // Under a presence, its element is told to it (#286): its `key`, and whether it's a twin.
  const presence = usePresenceContext()
  if (Predicate.isNotUndefined(presence)) madeWith(presence, constVoid, untrack(cfg))(el)
  runSpine({
    runtime: useWardicRuntime(),
    gate: useWardicGate(),
    id: createUniqueId(),
    el: () => el,
    cfg,
    controls,
    parent: node.inherited,
    extraDelay: node.extraDelay,
    byName: node.names,
    canStart: node.canStart,
    bindGestures: node.bindGestures,
    onFrame: node.onFrame,
    makeSink: (element) => ({ target: element }),
  })
}

declare module "solid-js" {
  // biome-ignore lint/style/useNamingConvention: augmenting Solid's JSX namespace.
  namespace JSX {
    interface Directives {
      wardic: WardConfig
    }
  }
}
