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

- **`config-transition.ts`** (both bindings): `WardicConfigValue`, the context's value (its `transition` an accessor); `configTransitionOf`, a config's transition over its parent's (`transitionOfTarget`, the variant rule's `inherit`); `withConfigTransition`, a config with the config's transition as its own when it gives none.
- **Solid 1** (`wardic-config.tsx`): `WardicConfig`, its transition a memo, one object per change, so the elements below share it and #66's and #301's caches hit. `controlledOf`, which every client ward form builds its config through (`createWardWith`, so `wardic.*`, `wardic.create` and a `Reorder.Item`, and `use:wardic`), lays it in with a memo. With no config above, it's the config as given, and no memo. A server ward lays it into its one copy.
- **Solid 2** (`unstable/v2/wardic-config.tsx`): the same, its memo transparent to hydration ids (#209), and its context `null` for none, as Solid 2 throws on a read of a context made with `undefined` and no provider. `wardWith` and the server ward lay it over the ward's per-key view with a getter (`configuredView`), as Animation controls lay their `animate` (#433), so `transition` is read where it's read.
- **Exports:** `WardicConfig` and `WardicConfigProps` from both bindings.

**Found building it:**
- **A change to an element's own `transition` alone tells `onAnimationStart` and `onAnimationComplete`,** though nothing moves: its Retarget runs, every key already at its target (#448). Motion's tells nothing, as its targets haven't changed. A config's change does the same as an element's own, which WC9 pins. Not changed here: it's how an element's own change behaves, and a config's follows it; a difference from Motion, worth an issue of its own.

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
  - WC9: a change to the config moves nothing, told as an element's own change is; the next animation runs on the new one.
  - WC10: a config's `staggerChildren` staggers the Variant children of an element that gives none.
- **Solid 2** (`v2/wardic-config.browser.test.tsx`, WCV1–WCV4): a ward and a `wardic.*` element, nested configs, a Variant child, an exit.
- **A server's Appear animation** (`appear.ssr.test.tsx` AR23, `v2/appear.ssr.test.tsx` AR20): the config's transition times an element's rule; its own keeps its own; an inner config's `inherit: true` delay is held in the rule.
- **Mutation-checked** (`.tmp/434/mutate.py`, run alone): ten single-point mutations, all caught: Solid 1 ignoring the config, on the client and on a server; the config over an element's own; an inner config never inheriting, or one with none passing nothing on; Solid 2 ignoring it, on the client and on a server, or putting it over an element's own; Solid 1's config read once; and the config's `layout` entry dropped. WC2's config with none was added for the fourth before the run.

**Bench:** `bun run bench:solid` (N = 1,000, against main at c706b8b): every row within noise. The page has no `WardicConfig`, so this is what it costs every other element: one context read at setup. Warm: Solid 1 mount −0.5%, Retarget −0.6%, rest Retarget +0.3%, unmount +0.8%; Solid 2 −0.9%, +0.1%, −0.6%, +1.1%. Bytes −0.3% / +0.4%; retained and the layout scenes flat.
