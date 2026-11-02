# skipAnimations: every animation in a subtree lands at once

Motion's `<MotionConfig skipAnimations>` makes every animation below it set its values instantly, "useful for E2E tests and visual regression testing" (`.reference/motion` at `16c6122`, `MotionConfigContext.tsx`). In Motion:
- **A value animation started with the element is made instant** (`motion-value.ts:100–135`): its delay 0, its final keyframe set on the next frame, its `onComplete` called. That covers `animate`, variants, the `while*` targets, exits, a drag's release and `useAnimate`'s `animate()`, which hands its config's setting to each animation (`use-animate.ts:18`, `animate/index.ts:113`). The element reads it once, at mount (`VisualElement.ts:494`).
- **A transition can carry it** (`skipAnimations: true`, `animation/types.ts:511`). A transition's `false` doesn't undo a config's: Motion skips when either says so.
- **Layout animations don't see it:** the projection starts its animation without the element (`create-projection-node.ts:1739`). Neither does `useSpring`. Only the page-wide `MotionGlobalConfig.skipAnimations` reaches those.
- **A skipped drag release goes to the drag's origin:** it starts with keyframes `[null, 0]` (`VisualElementDragControls.ts:522`), and the last is 0.

Wardic had none. `reducedMotion="always"` snaps the positional keys only (ADR-0029). #468 was split from #434 (ADR-0062), one of 1.0's Motion-parity gaps (#426).

## Decisions (grilled 2026-10-29, #468)

1. **Everything Wardic animates below the config lands at once** (Q1: A): each leg (`animate`, variants and lists, the `while*` targets, Animation controls' starts, Keyframes at their last stop, a repeat where it would end), an exit with its element removed then, layout animations and their crossfades, a drag's release, `createAnimate`'s `animate()` and its sequences, and `createSpring` following its source. Each lands at its end on the next frame, with no delay, no stagger and velocity 0, and is told as any landing is.
   - Rejected: B, Motion's per-element scope exactly, which leaves layout animations and `createSpring` moving under a config made for screenshot stability.
2. **On a server page, the Appear animation lands at once** (Q2: B): the server writes its rule with every timing at 0 s, so the page is drawn landed from the first paint, JavaScript off included. Hydration takes over at its end, and the mount is told start and complete, as Motion's is. With `appear={false}`, the first render shows `initial`, and the client lands at its first frame.
   - Rejected: A, Motion's order (`initial` until hydration); C, starting at `animate` as `initial={false}` does (no flash, but the mount tells nothing, #448).
3. **`skipAnimations` on `WardicConfig` and on a transition** (Q3: A): an element's transition, a key's entry, a `layout` entry, a config's transition and `createAnimate`'s options. No global: a root `<WardicConfig skipAnimations>` is the page-wide switch.
   - Rejected: B, the config only; C, a switch on `WardicProvider` or a mutable global as `MotionGlobalConfig`.
4. **Two PRs** (Q4: A): PR 1, the client (Part of #468); PR 2, the server's Appear animation landing at once and hydration over it (Closes #468).

**Defaults, stated:**
- **Nesting:** the nearest config that sets it wins, so an inner `skipAnimations={false}` animates its subtree again; one that sets none passes its parent's on.
- **A transition's** turns it on for that animation, or that key's entry. `false` doesn't opt one out of a config's, as Motion's.
- **Over reduced motion:** it wins. Every key lands, not only the positional ones, whatever a transition's `respectReducedMotion`.
- **Read when each animation starts,** as the config's `transition` and `reducedMotion` are: a running animation runs on, and the next one lands at once. Motion reads it once, at mount.
- **What's told:** start and complete, the landing at the gate's next flush; Solid 2's `settled()` and `next()`; the layout callbacks; `onExitComplete` once the element is removed. A Transition end applies at the landing.
- **Orchestration:** no delay or stagger; `when` children follow their parent's landing, the next frame.
- **A drag:** the pointer still moves the element (that's no animation). Its release lands where it would come to rest: its momentum's end within the constraints, or the origin with `dragSnapToOrigin`. Motion's goes to the drag's origin; Wardic's doesn't.

## Built (PR 1)

- **The transition field** (`config.ts`): `WardicSkipAnimations`, `skipAnimations?: boolean`, on both arms of a transition and of a key's entry. Like the reduced-motion opt-out, it doesn't define a transition (`NOT_DEFINING`), so `{ skipAnimations: true }` alone runs each key on its Default transition, and a key's entry without `inherit` takes the whole transition's (`resolvedEntry`), as does a Default transition (`carried`).
- **The legs** (`retarget-legs.ts`): `legsOf` takes `skipped`, the element's setting. When it, or the transition a group runs on, says so, the group's legs are one `Snap` of every key, with no delay, landing where its leg would end (`ReducedMotion.endOf`): a target, a Keyframes key's last stop, a turned `repeat`'s start, a Measured pair's target as given, a return to a moving Live value where it is now. Nothing is measured for it.
- **The config** (`wardic-config-value.ts`, both bindings' `WardicConfig`): `skipAnimations`, its own else an enclosing config's (`configSkipAnimationsOf`); `useWardicSkipAnimations()` reads the nearest one's when each animation starts, `constFalse` with no config above, or while its provider's Instant change runs (ADR-0018, *Amendment (#443)*).
- **The spine** (`spine.ts`): a `skipAnimations` reader beside `reducedMotion`, read at each Retarget and each Imperative animation. Solid 1's `create-ward.tsx` and Solid 2's `ward.tsx` give it, and hand it to the presence record, the layout node and the drag track.
- **An exit** (`presence-controller.ts`): `PresenceRecord.skipAnimations`, the leaving element's.
- **A layout animation** (`@wardic/dom`'s projection): `RegisterNodeOptions.skipAnimations`, each node's reader. A skipped node's flight lands at once (the reduced-motion path), and its drag's Release offset lands on its slot. The binding passes its config's, or the `layout` transition's own (`layout-member.ts`), as Motion's projection runs on its layout transition.
- **A drag's release** (`drag-track.ts`): skipped, it lands at once at `Inertia.restOf`, new in core: the glide's resting point held to its edges, or the edge nearest a start past one, as the inertia's last frame. `onDragTransitionEnd` is told after the flush.
- **`createAnimate`** (`imperative.ts`): its scope's setting goes into each element's transition (`skippedIn`), as Motion's `useAnimate` does, so a Wardic element's own config can skip it too. A sequence's function Segment is told its last value alone.
- **`createSpring`**: core's `LiveValue.spring` takes a `skipped` reader, and its options a `skipAnimations`; while either says so, each change of the source is a jump. Both bindings pass the config's.
- **Exports:** `WardicSkipAnimations` from both bindings; `WardicConfigProps.skipAnimations`.

## Tests (PR 1)

- **Core** (`inertia.test.ts`): IR1, `Inertia.restOf` at the inertia's last frame for a glide, an edge it crosses and a start past one (Motion's fixtures); IR2, through `modifyTarget`, held to the edges.
- **The legs** (`retarget-legs.ssr.test.tsx`): SL1, skipped, one snap of every key landing on its first tick, whatever the delay or the reduced-motion opt-out; SL2, a transition's own, on the Default transition, a key's entry taking it, an entry's own for its key alone, `false` undoing nothing; SL3, a turned repeat landing where it ends.
- **Solid 1** (`skip-animations.browser.test.tsx`, SK1–SK8): a delayed 2 s tween landing on the next frame and told, beside one outside animating; Keyframes and a stagger; an exit with `onExitComplete`; a layout animation and a `layoutId` handover; a drag released past its constraints, and a flick, landing at once; `createAnimate` with a sequence and a function Segment; `createSpring`; nesting both ways, a transition's own, and a change applying from the next animation.
- **Solid 2** (`v2/skip-animations.browser.test.tsx`, SKV1–SKV3): a ward and a `wardic.*` element with `next("settled")`; an exit; `createAnimate` and `createSpring`.
- **Mutation-checked** (`.tmp/468/mutate.py`, run alone): twenty-one single-point mutations, each caught:
  - the legs ignoring the config's setting, or a transition's own (SK1, SK2, SKV1, SL1; SK6, SK8, SL2);
  - a skipped snap holding a delay (SK1, SL1);
  - a turned repeat landing on its target (SL3);
  - an entry, or a Default transition, dropping the transition's (SL2);
  - either binding's spine not given it (SK1, SKV1);
  - a config that sets none passing nothing on, or an inner `false` not replacing (SK8);
  - an exit, a layout flight, or the layout options not skipped (SK3, SKV2; SK4);
  - a drag's release not skipped (SK5);
  - a release's rest not held to its edges (IR1, IR2: SK5's drag starts past its edge, the other branch);
  - `createAnimate` ignoring its scope's, or a function Segment not skipped (SK6, SKV3);
  - `createSpring` ignoring the config on either binding, or core's spring never skipping (SK7, SKV3);
  - the config's setting read once (SK8).

**Bench:** `bun run bench:solid` (N = 1,000, against main at e08c0f5): passed. The page has no `WardicConfig`, so this is what every other element pays: one more context read at setup, and the skip flag at each Retarget and leg build. Warm: Solid 1 mount +0.2%, Retarget +0.9%, rest Retarget +1.0%, unmount +1.4%; Solid 2 −0.3%, +0.5%, +0.8%, −0.4%. Bytes +0.9% / +0.3%; retained +0.1–0.2%; the layout scenes flat.

## Built (PR 2)

- **A skipped mount animation** (`appear.ts`, `MountAnimation.skipped`): sampled on its legs skipped, so its rule is 0 s, `0%,100%` its end, filled forwards from first paint. Its key ends `|skipped`, so a skipped play and an unskipped one of the same mount have rules of their own, and an unskipped one's name is as before. One that repeats for ever lands too: its rule isn't infinite (`playsForever`).
- **A server element's skip** (`ServerElement.skipAnimations`): its nearest config's, read by each binding's server ward (`useWardicSkipAnimations()`), or its whole transition's own `skipAnimations`. A skipped element enters with one play in both slots, under no media query, whatever its reduced motion.
- **Its timing:** a skipped entry holds no stagger of its own (`ownStaggerOf`), as its client's snap has no delay. A `when` wait still holds, so a `"beforeChildren"` child of a skipped parent waits the parent's 0 s.
- **Hydration:** the client's handoff names its mount animation with its skip too (`skippedField`), so it finds the server's rule, and its legs land at once over the rule's end.
- **Left as is:** a key's own entry with `skipAnimations` snaps on the client from the start, while a server's rule holds it through the element's stagger; the element's other keys animate, so the rule isn't skipped whole.

## Tests (PR 2)

- **Solid 1** (`appear.ssr.test.tsx`): AR26, an element under the config, one with its transition's own, and a forever-repeating one: a 0 s rule holding its end, no reduced play under a provider's `"user"`, its Starting style under it; beside it, outside, its own 0.3 s. AR27: a skipped Variant child holds no stagger, and its skipped `"beforeChildren"` parent's 0 s.
- **Solid 2** (`v2/appear.ssr.test.tsx`): AR22, a ward and an element, 0 s and no reduced play; a skipped Variant child, no stagger.
- **Hydration** (`appear.hydrate.browser.test.tsx` AH15, `v2/appear.hydrate.browser.test.tsx` AH14, fixtures A11 and A10): a card on a 1.5 s tween and a list staggered by 0.3 s, every frame landed from first paint, before and after hydration; on Solid 1, the card's mount told start and complete once hydrated.
- **Mutation-checked** (`.tmp/468/mutate2.py`, run alone): nine single-point mutations, each caught: a server ignoring the config's skip or a transition's own; the sampled legs not skipped; a forever-repeating play still looping; a skipped entry keeping its stagger, or its reduced play under the media query; a skipped key named as an unskipped one (they'd share a rule); either binding's server ward not given it.

**Bench (PR 2):** `bun run bench:solid` (N = 1,000, against main at 851f4c7): passed. Only the server path and a hydration's handoff changed, so it's noise: warm, Solid 1 mount +1.0%, Retarget −0.3%, rest Retarget −0.6%, unmount −1.4%; Solid 2 +0.5%, +1.7%, +1.1%, −0.5%. Bytes ±0.1%; retained flat. Solid 2's layout page frame read +4.1% [+1.0% – +12.6%], the scene known to be noisy (#385).

