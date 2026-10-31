# WardicConfig: Motion's MotionConfig, settings for a subtree

Motion gives a subtree its settings with `<MotionConfig>` (`.reference/motion` at `16c6122`):
- **`transition`** is each `motion.*` element's own `transition` when it gives none: `{ ...useContext(MotionConfigContext), ...props }` (`framer-motion/src/motion/index.tsx`), read through `visualElement.getDefaultTransition()` by every animation of the element's targets (`visual-element-target.ts`) and by its layout animation (`create-projection-node.ts`).
  - An element's own `transition` replaces it. A target's own transition with `inherit: true` lays its fields over the element's, the config's when it has none (`resolveTransition`).
  - A nested `MotionConfig` replaces its parent's transition, or with `inherit: true` shallow-merges over it, its own fields winning (`components/MotionConfig/index.tsx`, `MotionConfig.test.tsx`).
  - `useAnimate`'s `animate()` runs on the options it's given (`animateElement` → `getValueTransition(options, key)`), not on the config's.
- **`reducedMotion`**, read per element as it's made (`use-visual-element.ts:44`), and by `useAnimate`.
- **`skipAnimations`**, `nonce`, `transformPagePoint` and `isValidProp`.

Wardic had `reducedMotion` and `appear` on `WardicProvider`, which builds the runtime: a nested provider builds a second runtime, with its own flush gate and projection system, so it can't serve a subtree. Its Default transition (ADR-0051) is one per Environment. And a Variant child with no `transition` takes its parent's (ADR-0007, `ownOrInherited`), which Motion has no step for. #434 is one of 1.0's Motion-parity gaps (#426).

## Decisions (grilled 2026-10-29, #434)

1. **A new component, `WardicConfig`** (Q1: A), Motion's `MotionConfig` named as `motion.div` is `wardic.div`. It provides a context and no runtime, so it nests anywhere under `WardicProvider`, on both bindings.
   - Rejected: B, `transition` on `WardicProvider` (one per runtime, no subtree); C, a nestable `WardicProvider` whose `env` is optional (a root provider that forgets it fails at run time, and "provider" means two things).
2. **It carries `transition` and `reducedMotion`** (Q2: A). `reducedMotion` is the nearest `WardicConfig`'s, else `WardicProvider`'s, which stays, as the root's. A server's Appear picks each element's rules by its nearest config. `skipAnimations` is #468.
   - Rejected: B, `transition` only; C, `skipAnimations` now too, new runtime behaviour (every leg, exit and layout animation at once, a server rendering the end state).
3. **Motion's order: the config's transition is an element's own when it gives none** (Q3: B). Under a `WardicConfig`, a Variant child runs on the config's transition, not its parent's; with no config above, ADR-0007's inheritance is unchanged. Ported Motion code runs as in Motion, and a parent whose transition is only orchestration (`{ staggerChildren: 0.1 }`) doesn't leave its children on the Environment's default.
   - Rejected: A, nearest wins (the element's own, else its Variant parent's, else the config's), which keeps ADR-0007 under a config but differs from Motion, and skips the config for a child whose parent's transition defines none.
4. **Two PRs** (Q4: A): PR 1, `WardicConfig` with `transition` (Part of #434); PR 2, its `reducedMotion` (Closes #434).

**Defaults, stated:**
- **An element's own `transition` replaces the config's,** as Motion's spread. A target's own with `inherit: true` lays its fields over the element's, the config's when it has none.
- **Nested configs:** an inner one replaces the outer's transition, or with `inherit: true` lays its own fields over it. One that gives none passes the outer's on.
- **What reads it:** whatever reads the element's transition: `animate`, variants and lists of names, the `while*` targets, exits, Animation controls' starts, layout animations (its `layout` entry, else `default`, else its own fields, else Motion's 0.45 s tween; ADR-0049) and their crossfades, every ward form, and a server's Appear animation. Not `createAnimate`'s `animate()`, nor the drag's release (`dragTransition`), as Motion's.
- **Per key, as before:** a value's entry, else `default`, else the own fields (ADR-0049). A config's transition that defines none (a `delay`, or orchestration alone) keeps that over each key's Default transition (ADR-0051).
- **A config's orchestration counts:** `staggerChildren` in it staggers the Variant children of every element below that gives no transition, as Motion's.
- **Read when each animation starts:** a change to a config moves nothing by itself, as a change to an element's own `transition` doesn't.
- **Typed wide:** a config isn't one element, so its transition takes every value's name; #305's inference doesn't apply.

## Built (PR 1)

- **`wardic-config-value.ts`** (both bindings): `WardicConfigValue`, the context's value (its `transition` an accessor); `configTransitionOf`, a config's transition over its parent's (`transitionOfTarget`, the variant rule's `inherit`); `withConfigTransition`, a config with the config's transition as its own when it gives none.
- **Solid 1** (`wardic-config.tsx`): `WardicConfig`, its transition a memo, one object per change, so the elements below share it and #66's and #301's caches hit. `controlledOf`, which every client ward form builds its config through (`createWardWith`, so `wardic.*`, `wardic.create` and a `Reorder.Item`, and `use:wardic`), lays it in with a memo. With no config above, it's the config as given, and no memo. A server ward lays it into its one copy.
- **Solid 2** (`unstable/v2/wardic-config.tsx`): the same, its memo transparent to hydration ids (#209), and its context `null` for none, as Solid 2 throws on a read of a context made with `undefined` and no provider. `wardWith` and the server ward lay it over the ward's per-key view with a getter (`configuredView`), as Animation controls lay their `animate` (#433), so `transition` is read where it's read.
- **Exports:** `WardicConfig` and `WardicConfigProps` from both bindings.

**Found building it:**
- **A change to an element's own `transition` alone tells `onAnimationStart` and `onAnimationComplete`,** though nothing moves: its Retarget runs, every key already at its target (#448). Motion's tells nothing, as its targets haven't changed. A config's change does the same as an element's own, which WC9 pins. Not changed here: it's how an element's own change behaves, and a config's follows it; a difference from Motion, worth an issue of its own.
  - *Fixed by #470* (ADR-0046, *Amendment (#470)*): Solid 1's target is compared by value, as Solid 2's is, so neither change tells anything. WC9 pins that now.

## Tests (PR 1)

- **Solid 1** (`wardic-config.browser.test.tsx`, WC1–WC10, real frames: a 1 s linear tween well short of its target while a 0.1 s one has landed):
  - WC1: an element with no transition runs on the config's; one with its own, on its own.
  - WC2: an inner config replaces an outer one's; `inherit: true` lays its delay over it.
  - WC3: a Variant child runs on the config's, not its parent's (Q3); with no config, its parent's.
  - WC4: a variant's own transition with `inherit: true` lays its delay over the config's.
  - WC5: an exit, a hover target and Animation controls' start run on the config's.
  - WC6: a layout animation runs on the config's `layout` entry.
  - WC7: a config's `delay` alone keeps it over a key's Default transition.
  - WC8: `createAnimate`'s `animate()` runs on its options alone.
  - WC9: a change to the config moves nothing, told as an element's own change is; the next animation runs on the new one. Since #470, neither tells anything.
  - WC10: a config's `staggerChildren` staggers the Variant children of an element that gives none.
- **Solid 2** (`v2/wardic-config.browser.test.tsx`, WCV1–WCV4): a ward and a `wardic.*` element, nested configs, a Variant child, an exit.
- **A server's Appear animation** (`appear.ssr.test.tsx` AR23, `v2/appear.ssr.test.tsx` AR20): the config's transition times an element's rule; its own keeps its own; an inner config's `inherit: true` delay is held in the rule.
- **Mutation-checked** (`.tmp/434/mutate.py`, run alone): ten single-point mutations, all caught: Solid 1 ignoring the config, on the client and on a server; the config over an element's own; an inner config never inheriting, or one with none passing nothing on; Solid 2 ignoring it, on the client and on a server, or putting it over an element's own; Solid 1's config read once; and the config's `layout` entry dropped. WC2's config with none was added for the fourth before the run.

**Bench:** `bun run bench:solid` (N = 1,000, against main at c706b8b): every row within noise. The page has no `WardicConfig`, so this is what it costs every other element: one context read at setup. Warm: Solid 1 mount −0.5%, Retarget −0.6%, rest Retarget +0.3%, unmount +0.8%; Solid 2 −0.9%, +0.1%, −0.6%, +1.1%. Bytes −0.3% / +0.4%; retained and the layout scenes flat.

## Built (PR 2)

- **The config's setting:** `WardicConfigValue.reducedMotion`, its own else an enclosing config's (`configReducedMotionOf`). The shared module is `wardic-config-value.ts` now, as it holds both.
- **The reader:** the context value's `reducedMotionUnder(setting)`: the setting given, else the provider's, else `"user"`, with the user's preference. `useWardicReducedMotion`, on both bindings, reads it with the nearest config (`reducedMotionWith`); with none above, it's the provider's reader as before. So the spine, the Solid 2 ward and `createAnimate` follow it with no change of their own, as Motion's `useAnimate` follows its `MotionConfig`.
- **An exit** reads the leaving element's: its presence record carries the element's reader (`PresenceRecord.reducedMotion`), over the presence's, so a `WardicConfig` inside an `AnimatePresence` holds for its exits.
- **A layout animation** reads the element's: dom's `RegisterNodeOptions.reducedMotion` is each node's own reader, the system's by default, and the binding passes the element's through `layoutOptionsOf`.
- **A server's Appear animation:** each element enters with its nearest config's setting. Under `"always"` its reduced play goes in both slots, under `"never"` its normal one, so a provider-wide setting is the same rule. The head's media-query block is written when some element follows the user, with those elements' reduced timings alone. A page with no `WardicConfig` writes what it did.

## Tests (PR 2)

- **Solid 1** (`wardic-config-reduced-motion.browser.test.tsx`, WR1–WR8, every sample read after a paint, a box beside outside the config):
  - WR1: a config's `"always"` snaps `x` under a provider's `"never"`;
  - WR2: its `"never"` animates `x` under a provider's `"always"`, and under the user's preference;
  - WR3: its `"user"` follows the preference under a provider's `"never"`;
  - WR4: a config with none passes its parent's on; an inner one replaces it;
  - WR5: an exit honours the leaving element's config, not its presence's;
  - WR6: a layout animation under `"always"` lands at once;
  - WR7: `createAnimate`'s `animate()` honours its scope's config;
  - WR8: a change to the config applies from the next animation.
- **Solid 2** (`v2/wardic-config-reduced-motion.browser.test.tsx`, WRV1–WRV2): a ward and a `wardic.*` element both ways, and an exit.
- **A server's Appear animation** (`appear.ssr.test.tsx` AR24, `v2/appear.ssr.test.tsx` AR21): an element under a config's `"always"`, `"never"` or `"user"` renders the same timings as a page with that setting at its provider, and a config's `"user"` under a provider's `"never"` gets its media-query timing alone.
- AR25 (`appear.ssr.test.tsx`): a `"user"` Variant child waits, in its reduced timing too, for its `"never"` parent's move (`when: "beforeChildren"`), not a snap.
- **Mutation-checked** (`.tmp/434/mutate2.py`, run alone): fifteen single-point mutations, all caught: the config's setting ignored, or either binding's reader taking the provider's; the provider's over the config's; a config with none passing nothing on, or an inner one not replacing; an exit reading its presence's; a layout node reading the system's, or its options dropping the element's; a server ignoring the config, keeping both plays under `"always"` or `"never"`, writing the media block by the provider's, or putting a non-`"user"` element under it; and the config's setting read once. `"never"` keeping both plays survived at first: an element under it writes no reduced timing of its own, so AR25 was added, where a `"user"` Variant child's reduced delay waits for its `"never"` parent's move.

**Bench:** `bun run bench:solid` (N = 1,000, against main at c706b8b, with PR 1): passed. The page has no `WardicConfig`, so this is what every other element pays: one more context read at setup (its reduced-motion reader), and a layout node's reader passed on. Warm: Solid 1 mount −0.1%, Retarget +0.9%, rest Retarget +0.4%, unmount +0.6%; Solid 2 +1.3%, +0.5%, +0.5%, +2.5%. Bytes ±0.0%; retained and the layout scenes flat.

## Amendment (#443, 2026-10-30): `isValidProp`, and `wardic.create`'s options

Grilled on #443 (Q1 A, Q7 A). Motion's `MotionConfig` also takes `isValidProp`: which of a `motion.<tag>`'s props reach its DOM element. Motion's `filterProps` passes an `on…` prop unless it's a motion prop, and any other by `isValidProp` when one is given, else when it isn't a motion prop; a wrapped component gets every prop that isn't a motion prop. Its `motion.create(Component, options)` takes `forwardMotionProps` and `type`, and `isValidMotionProp`, `isMotionComponent` and `unwrapMotionComponent` are exported. #434 took none of them.

- **`WardicConfig`'s `isValidProp(key)`,** on both bindings: its own, else an enclosing config's (one that gives none passes it on), read from the nearest config as each Wardic element is made, for the props it has then. A tag's own props (the motion props, `ref` and `style` aside) that it says `false` for are kept off the element, on the client and on a server alike, so a hydrated element matches its markup. It's never asked about a prop starting with `on`, and a wrapped component's props aren't filtered, as Motion's. Rejected: filtering again as the keys change, as Motion does at each render: a spread whose keys change after the element is made is rare, and following it would cost every element a proxy.
- **`wardic.create(x, { forwardMotionProps, type })`:** `forwardMotionProps` hands the motion props on to what it renders as well, a wrapped component or a tag's attributes, as Motion's does; they still drive the element. `type: "svg"` routes a wrapped component's server render and Starting style as an svg-inner element's, its attribute keys as attributes (by `g`'s routing, which every svg-inner tag shares, ADR-0014); `"html"` routes every key as style. On the client the element decides, as it did.
- **`isValidWardicProp(key)`:** each binding's own motion props, exactly: Solid 2's leaves out the callbacks that are DOM events there. Rejected: Motion's prefixes, which call `whileAnything` a motion prop.
- **`isWardicComponent` / `unwrapWardicComponent`:** a registered symbol (`Symbol.for`) on every component `wardic.<tag>` and `wardic.create` make, holding its tag or the component it wraps, so either binding reads the other's.

**Built:** `wardic-component.ts` (both bindings' options, `routingTagOf`, the mark, `droppedKeysOf`); `WardicConfigValue.isValidProp` with `configIsValidPropOf` and `isValidPropOf`; Solid 1's `wardComponent` and server `passThrough`, Solid 2's `restOf`, each splitting again only when a key is kept off.

- **Pinned by:** `small-utilities.browser.test.tsx` SU6 and SU7, `v2/small-utilities.browser.test.tsx` SUV5 and SUV6 (a tag's prop kept off, `on` props unasked, a wrapped component given every prop, a config with none passing it on, an inner one replacing it; the motion props handed on and still driving the element); `small-utilities.ssr.test.tsx` SUS1–SUS4 and SUS6, `v2/small-utilities.ssr.test.tsx` SUSV1–SUSV4 (each binding's list, the mark, `type` on a server, `isValidProp` on a server).
- **Mutation-checked** with PR 1's hooks (`.tmp/443/mutate.py`, run alone): see ADR-0043's *Note (#443)*. Here: `isValidProp` asked of an `on` prop, a wrapped component filtered, a config with none passing nothing on, either binding's client or Solid 1's server ignoring it; the motion props not forwarded on either binding's client or Solid 1's server; `type` ignored either way; Solid 2 answering Solid 1's list; either binding leaving its components unmarked. All caught.

## Amendment (#443 PR 4, 2026-10-31): `transformPagePoint`

Grilled on #443 (Q6 A): Motion's `MotionConfig` `transformPagePoint` and its two helpers, on both bindings.

- **`WardicConfig`'s `transformPagePoint(point)`**: read from the nearest config at each drag or pan start, an inner config with none passing its parent's on, as `isValidProp`. It maps every point the drag and the pan use, in Wardic's viewport coordinates:
  - the down and each move (core's `Recognizer.watchDrag` and `watchPan` take a `mapPoint`, read at each down);
  - an adopted down (Drag controls' `start`), and the snap to the cursor, whose pointer and box centre are mapped;
  - the boxes drag constraints are measured from, the element's and its container's, each box's top-left and bottom-right corners, as Motion's `measurePageBox`;
  - `createDrag`'s samples.
- **Not layout projection boxes,** which Motion also maps: Wardic's projection already reads them through their ancestors' transforms (ADR-0012, #136, #137), so mapping them again would count a zoom twice. A layout element's drag follows the pointer inside a zoomed parent all the same (PP4), its offsets mapped.
- **Hover and press points aren't mapped,** as Motion maps only pan sessions'.
- **The helpers,** `correctParentTransform(parent)` and `transformViewBoxPoint(svg)`, take an element or an accessor of one, read at each point, and work in viewport coordinates: Motion's add the page's scroll, as its points are the page's. The first turns a point through the inverse of the parent's transform about its centre (Motion's `getInverseMatrix`, here through `DOMMatrixReadOnly`); the second scales it into the SVG's viewBox about its top left corner.
- **A point the hold of a pointer counts the page's scroll into** (ADR-0019, *Amendment (Reorder)*) is mapped where it is on the screen, and that scroll is added back after.
- It lifts ADR-0012's decision 4: inside a scaled or rotated parent, a drag follows the pointer when the app gives the mapping (*Amendment (#443)* there).

- **Pinned by:** `page-point.browser.test.tsx` PP1–PP9 (a 2× parent with and without it, a rotated one, constraints, a layout drag, an SVG viewBox, a pan, an inner config and a new mapping read at the next start, a snap to the cursor, `createDrag`) and `v2/page-point.browser.test.tsx` PPV1–PPV3 (`wardic.div` and a ward, `createDrag`, a ward's pan); on a server, `small-utilities.ssr.test.tsx` SUS9 and `v2/…` SUSV8.
- **Mutation-checked** (`.tmp/443/mutate4.py`, run alone): 18 single-point mutations, all caught. They covered: a drag's or a pan's points not mapped, the mapping read once rather than at each down; either binding's drag, pan or `createDrag` not given it; the constraints or a box's corners not mapped; the snap not mapped; an inner config not passing it on; `correctParentTransform` passing the point, or its inverse's off-diagonals swapped; the viewBox scale inverted; a helper throwing with no element.
