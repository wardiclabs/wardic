# Variant orchestration: name propagation, snapshot-order stagger, binding-composed sequencing

Variant orchestration is a binding concern built on a small pure core surface. Through the tree, the binding propagates the current **variant name** (not resolved values) plus the inherited transition/stagger config and a `registerChild` handle; each child holds its own `variants` map and resolves the inherited name locally (a child's `"open"` is independent of its siblings'). A target resolves by priority: local `animate` > parent-context variant > `initial`. The only core piece involved is the existing pure `stagger(amount, opts): (index, total) => delaySeconds` — the binding supplies `index`/`total`.

**Stagger order is snapshotted at transition-trigger time.** When a parent variant changes, the Provider snapshots the current child order (source/positional order at that instant), assigns each child an `index`/`total` for *that* transition, and each child computes its delay from the inherited stagger fn. A reorder, mount, or unmount *mid-transition* does not reshuffle in-flight delays — each child is already animating with its assigned delay — and the next variant change recomputes from the new order. `staggerDirection` reverses the index, `delayChildren` adds a fixed offset, `from` selects the origin (core stagger option).

**`when` sequencing is composed in the binding from existing combinators.** `beforeChildren` runs the parent stream, then on its `onSettle` starts the staggered children `group`; `afterChildren` runs the children `group`, then on all-settled starts the parent; the default is concurrent with stagger/delay offsets. No new core combinator is introduced.

## Considered Options

- **Propagate resolved values instead of the variant name.** Rejected: siblings define different values for the same named state, so resolution must be local to each child; pushing values down would force the parent to know every child's value map.
- **Continuously reactive positional stagger index** (index always reflects current visual position; mid-transition reorders re-derive delays live). Rejected: reordering during a transition causes in-flight delay jumps/restarts (jank) and is the most complex against keyed `<For>` identity. Snapshot-at-trigger gives visually-correct order at the moment that matters without continuous re-indexing.
- **Mount-order indices, retained** (the original plan's literal wording). Rejected: after reorders the stagger no longer follows visual order, and it never actually defined the mid-transition case — the open question this ADR closes.
- **A core `sequence`/`andThen` combinator, or a core `orchestrate({parent, children, when})` primitive.** Rejected: `when`'s parent-then-staggered-children shape isn't a plain linear sequence (so a `sequence` combinator only partially fits), and a full orchestration primitive bakes the component-tree timing model into core — the "fat core" trap ADR-0004 rejected. `onSettle` + `group` + `delay` already express it.

## Consequences

- Core gains nothing for variant orchestration beyond the `stagger` util it already ships; the boundary holds once more (binding owns tree + lifecycle, core owns the delay math).
- Stagger is a per-transition snapshot, not a live binding: predictable under churn, and the implementation never has to reconcile in-flight delays with a changing child set.
- A child that inherits a variant name it doesn't define simply has nothing to animate for that transition (no-op), which is also how a child opts into inheriting only some states.
- `<AnimatePresence>` exit (binding-only, on `onSettle`) composes with this: an exiting child can inherit the parent's `exit` variant by the same name-propagation path; exit stagger is the same snapshot mechanism with a reversed/own ordering.
- A future `@wardic/react` binding reuses the same model over React context + its own child-registration; only the registration plumbing differs, not the stagger math or the sequencing composition.

## Amendment (#47, 2026-10-02): below the base, each key falls back to its Base value

The priority above resolves the base layer as a whole: local `animate`, else the parent's variant, else `initial`. A key that no layer sets any more, including one the base layer drops, then returns to the key's `initial` value, else its `style` value, else the element's Own value (ADR-0022). #50's inherited `initial` will join at the `initial` link.

## Amendment (#77, 2026-10-09): a staggered tween with a `repeat` waits its stagger once

- **The binding folds a child's stagger into its transition's `delay`.** `animate` held that `delay` again before every segment of a `repeat` / `yoyo` run, so a staggered child's repeating tween waited its stagger again before each repeat.
- **Since #77, `delay` holds once,** before the first segment (ADR-0027, *Amendment (#77)*). So the stagger offsets each child's start once, as a per-child `delay` does in Motion.
- **A spring transition has no segments,** so it's unchanged.

## Amendment (#50, 2026-10-12): every Wardic element provides, and only a Variant child joins

#50 found that variant orchestration only ran through `useWardic`'s explicit `<ward.Provider>`: a `wardic.ul` passed nothing to its `wardic.li`s, so the most common Motion pattern, a staggered list entrance, didn't happen, and no child started from its parent's `initial`. Even under `ward.Provider`, every `useWardic` below it registered, `variants` or not. The grill (2026-10-12) took Motion's rule (`.reference/motion` at `16c6122`: `use-visual-state.ts:77-85`, `MotionContext/utils.ts`, `VisualElement.ts:461` and `:787-792`).

1. **Every Wardic element hands its children a variant context:** `wardic.*`, `wardic.create(Component)` and `<Reorder.Item>`, and `useWardic` through `ward.Provider` (a hook can't wrap its children). The directives read the context but provide none, since they render no children. An element renders the Provider only when it changes what its children read, that is when it has variants of its own or sets `inherit={false}` (`changesContext`). Any other hands them its parent's context as it is, so it renders none. That's decided once, at setup, from the same props on a server and on the client (ADR-0021, *Amendment (#50)*).
2. **Only a Variant child joins** (CONTEXT.md): an element with `variants` that names neither its own `initial` nor `animate`, and doesn't set `inherit={false}`.
   - It joins its nearest ancestor with variants of its own (`variants`, or a named `initial` or `animate`): it inherits that ancestor's names and default transition, takes a stagger slot among its variant children, and counts for its `when`.
   - Any other element passes its parent's context through untouched, so a plain `wardic.*` element between a list and its items doesn't break the chain. An element without `variants` inherits nothing and takes no stagger slot, where under `ward.Provider` it used to register.
   - Membership is decided once, at setup, as `initial` is read. The names stay reactive.
3. **The context carries the `initial` name too, read once.** A Variant child with no `initial` of its own resolves its ancestor's `initial` name against its own `variants`: its Starting style, its server markup and its spring's start (the Amendment (#47)'s `initial` link). Only names pass down: a values map hands down nothing, since it can't be resolved against a child's `variants`. An element that names its own variants hands down its own names; any other passes its parent's through.
4. **`inherit={false}`** (Motion's `inherit`): the element inherits no names, joins nothing, and hands its children no names from above it. It still provides its own, if it has any.
5. **A non-variant element no longer inherits its parent's default transition.** Before, any `useWardic` under `ward.Provider` took the parent's `transition` when it had none; now only a Variant child does, with the names.
6. **The registry costs the same per child at any size:** a `Set` in mount order with a count of the unsettled children, so a child's mount, unmount or settle never copies the registry or rescans it (it used to, through a signal of the whole array).

Rejected:
- **Provide automatically, but keep the old membership** (every Wardic element under a parent registers): an icon inside a list item would take a stagger slot and hold up `afterChildren`.
- **Keep `ward.Provider` explicit and document it:** the list pattern keeps not working.
- **Inherit `animate` only, or the `initial` name on the client only:** no entrance, or a snap at hydration (ADR-0021).

The server side is ADR-0021's *Amendment (#50)*.

Measured on the final code (the bench server, `wardic-quiet`, Chromium 147 headless; `.tmp/50-mount/` and `.tmp/50-ssr/`, not committed):

- **A client mount of 1,000 elements in one task**, main, an A/A copy of main, and this branch, 7–11 paired reps, with a GC before each mount (median [p25–p75]):

  | Workload | main | here | here / main | A/A |
  |---|---|---|---|---|
  | `flat`: `wardic.div`s, no variants | 146.7 / 128.0 ms | 143.6 / 126.1 | −2.1% [−2.6, −0.5] / −1.6% [−1.9, −1.4] | +0.2% / −0.1% |
  | `own`: `wardic.li`s naming their own variants | 147.7 / 128.3 | 153.3 / 130.9 | +4.3% [+1.6, +4.5] / +2.5% [+1.4, +3.5] | −1.4% / −0.5% |
  | `list`: a `wardic.ul`'s 1,000 Variant children | 124.1 / 108.1 | 154.5 / 137.7 | +25.2% / +27.3% | −3.1% / −0.3% |

  (cold / warm in each cell)

  - A plain element mounts slightly cheaper: it no longer builds a registry and its memos for children that never come.
  - An element with variants of its own pays about 3–6 µs for its Provider and its orchestration.
  - `list` against main isn't like for like: on main the `li`s never animate (#50's bug). On this branch `list` against `own` is what joining costs: 1–7 µs per child.
  - Without the forced GC, `flat`'s warm mounts were bimodal on this branch (a median of +9.5% [−1.0, +10.9], with the same work): a collection landed in some of them. With the GC moved out of the timed task, the branch is the cheaper one.
- **A server render of 1,000 elements**, 9 alternating pairs: `flat` +3.3% [+2.5, +4.8] (3.11 → 3.25 ms); the variant list +76% (2.84 → 5.04 ms, about 2.2 µs per `li`), which now renders its inherited Starting style and its own Provider. A Provider on every element, before it was made conditional, cost `flat` +37%.

Pinned by `variant-inheritance.ssr.test.tsx` (VI1–VI10), `variant-inheritance.browser.test.tsx` (VB1–VB5) and the hydrate project's F18. Without the element's Provider, VI1, VI3, VI9, VB1, VB4 and VB5 fail; with every element joining, VB2 (a stagger slot), VB3 and VI5 (`inherit={false}`) fail.

Gates: `bun run typecheck` (and the layout lab's), `bun run lint`, `bun run test` (67 files, 723 tests) and `bun run test:browser` (66 files, 659 tests; no "optimized dependencies changed" in the log).

## Amendment (#134, 2026-10-13): `initial={false}` passes down, and `<AnimatePresence initial={false}>`

`initial={false}` starts an element at its `animate` (ADR-0003, *Amendment (#134)*). Two places carry it beyond the element, as Motion's do.

1. **The variant context carries `false` with the `initial` name (Q4)**, Motion's `getCurrentTreeVariants`: an element that names its own variants hands its `initial` down when it is a name or `false`. A **Variant child** with no `initial` of its own takes it, and starts at its inherited `animate`, so a list with `initial={false} animate="open"` mounts its items at "open", with no stagger. A child with its own `initial` keeps it. An element that names no variants passes its ancestors' through, its own `initial={false}` applying to itself only, and `inherit={false}` cuts it off, as it cuts names (#50). Rejected: handing `false` down from any element (it breaks #50's rule that only an element naming its own variants changes what its children inherit), and no inheritance.
2. **`<AnimatePresence initial={false}>` (Q5)**: the child rendered with the presence's first render, and every Wardic element under it, starts at its `animate`, over its own `initial`, as Motion's `presenceContext.initial`. A child that enters later, a re-entry after an exit, animates in from its `initial`. Exits are unchanged, and a `layoutId` twin is untouched (at the first render there is no prior twin to crossfade from). It reaches the elements through the presence context they read at setup, set during the presence's first render only; a server renders once, so its child is always at `animate`. Rejected: holding every entry (that is the child's own `initial={false}`), and leaving it to another issue.

## Amendment (#291, 2026-10-22): the gesture props take a variant name, which passes down

Motion's five gesture props (`whileHover`, `whileTap`, `whileDrag`, `whileFocus`, `whileInView`) take a variant name as well as a target (`VariantLabels | TargetAndTransition`, `motion-dom/src/node/types.ts` at `16c6122`). The name passes down, and a Variant child's gesture is on while its parent's is:
- the variant context hands each gesture's label to the children (`get-variant-context.ts`);
- the animation state's `setActive` turns the gesture on in every Variant child (`animation-state.ts`);
- the children animate through the parent's `animateVariant`, staggered by that variant's orchestration.

Wardic's gesture props took values only.

1. **All five take a name** (the user's call when filing #291). A name names a `variants` entry, a target or a dynamic variant resolved with `custom` (ADR-0048, #277's PR 4).
2. **The name passes down to Variant children** (Q1: A, Motion's).
   - While the gesture is on, each Variant child animates its own entry for it, and returns when it ends. This is the reason the names exist: hover a card, and its icon, label and arrow respond together.
   - **Its orchestration** comes from that variant's own transition: `staggerChildren`, `delayChildren`, `staggerDirection` and `when`. For a gesture, it's the own transition of the highest active gesture's name, else the target's.
   - **A child's gesture is on while its parent's is,** whether the parent's is a name or a target (Motion's `setActive` doesn't look). On, it resolves its own `while*` for that gesture first, else the name. A child's own `whileHover={{ x: -20 }}` applies while the card is hovered.
   - Rejected: B, the name resolving on the element only, which drops Motion's main use of it.
3. **Lists of names are #297** (Q2: B). `whileHover={["hover", "lift"]}`, like `animate={[…]}`, is for all eight props at once, as Motion's `VariantLabels`.
4. **Defaults stated, not asked:**
   - **A gesture target's own transition** drives its keys, deferred to here from #277's PR 4. A Retarget runs each key on the own transition of the highest active layer that sets it: the base target's, a gesture target's, else the element's. A key returning to its Base value runs on the base's.
   - **`onAnimationStart` / `onAnimationComplete`** report a gesture's name when it comes on (Motion names its type's label). Otherwise they report the base's name when it changes, else the values, as before.
   - **A gesture whose layer resolves to nothing new** (a name the child has no entry for) Retargets nothing, as before.

**Built:**
- **Each gesture layer** resolves through `resolveTarget`: its own entry while the gesture is on (its own, or its provider's), else the label handed down (`gestureLayerOf`; `handedDown` in `variant-tree.ts` since #297). An off layer resolves nothing: one shared empty layer.
- **The `Resolution`** keeps its layers and the active gestures' names. The Retarget splits its keys by layer only when an active layer has its own transition (`keysByLayerOf`).
- **The hand-down:** a provider's variant node hands down a `GestureHandDown` (whether each gesture is on, and its label) through the context's `gestures`. It's a memo equal while nothing changes, so its children re-resolve only at a change.
  - Its stagger snapshot and its `beforeChildren` key on the variant name plus the active gestures' names (`triggerKeyOf`).
  - **Solid 1 takes the snapshot lazily now**, as Solid 2's does (#209 PR 4a). The trigger memo marks it stale, and a child's first slot read retakes it. Taken in an effect, a child that the same change Retargets read its old slot first: an item added since the last trigger staggered from 0 (GN12).
  - Its orchestration reads the highest active gesture name's own transition.
- **Each spine binds its gesture states into its node** (`bindGestures`):
  - Solid 1, in `runSpine`'s mount effect, from the resolution's `active`;
  - Solid 2, at the ward's setup, from its gesture signals. Its target memo skips an unchanged resolution (`sameResolution`), so a hover whose own layer is empty never reached the hand-down through it (GW2 caught it).
- **An element with no provider** reads its own states and the shared empty names, with nothing made per Retarget.

**Pinned by:**
- **Solid 1:** `test/gesture-names.browser.test.tsx` GN1–GN12:
  - a gesture's name on the element itself, and back at its end;
  - a dynamic one with `custom`;
  - a gesture target's own transition;
  - the name passing down, and staggered;
  - a child's own `while*` on with its parent's hover;
  - `whileTap`;
  - `onAnimationStart` told the name;
  - two levels;
  - `when: "beforeChildren"`;
  - a parent's gesture given as values turning a child's own on;
  - the stagger slots retaken when a gesture comes on, for an item added since.
- **Solid 2:** `test/v2/gesture-names.browser.test.tsx` GW1–GW3, under the diagnostics gate.
- **Mutation-checked:** fifteen single-point mutations, each caught:
  - an own name not resolved;
  - labels, or the activity, not handed down;
  - the label over an own `while*`;
  - Solid 1's orchestration or trigger ignoring the gestures (GN12, once added);
  - its slots never retaken;
  - a gesture's own transition ignored;
  - the definition ignoring the names;
  - either binding's states never bound;
  - Solid 2's bound to the target;
  - the per-layer split only on gesture layers (DV7);
  - the base-only path taken with gestures handed down, or with the element's own on.

**What it costs an element that uses none of it** (`bench:solid`, N = 1,000, no provider on the page, against main `fdb6f73`):
- **The first build** made the five gesture layers, their names and a closure per element at every resolution, provider or not. Solid 1's warm Retarget read +2.2% [+1.1%, +5.2%] and mount +1.4%; Solid 2's warm mount +2.3% [+1.1%, +3.8%].
- **Plain guards** in place of `UndefinedOr` calls brought Solid 1's warm Retarget to +0.8%, but its cold Retarget read +7.8% [+6.1%, +8.1%], and Solid 2's warm mount +3.2% [+0.4%, +3.6%].
- **A base-only path** fixed both. With nothing handed down and no gesture on, `resolutionOf` resolves the base layer alone, and makes and calls nothing else.
- The result (control −0.4%): Solid 1's Retarget −2.6% warm and +3.0% [−3.0%, +4.3%] cold, mount +1.1% [−1.3%, +1.2%], bytes −0.8%. Solid 2's Retarget +0.5% warm, mount −0.7%, bytes −0.3%.

## Amendment (#297, 2026-10-22): the variant props take a list of names

Motion's variant props take a list wherever they take a name (`VariantLabels = string | string[]`, `motion-dom/src/node/types.ts` at `16c6122`):
- a list merges its names in order, later names winning (`animation-state.ts:251-258`);
- each name is then animated as its own variant (`visual-element.ts:16-20`), with its own transition and orchestration, and told to `onAnimationStart` / `onAnimationComplete` on its own (`visual-element.ts:13,35`);
- the variant context hands a list down as it is (`isVariantLabel`), and each Variant child resolves the names it has.

Wardic's took one name.

1. **All eight props** (Q1: A): `initial`, `animate`, `exit` and the five `while*` take `WardicVariantLabels = string | ReadonlyArray<string>`. One resolver (`resolveTargets`) serves them all, on both bindings and the server. Rejected: B (`initial`, `animate`, `exit` first); C (`animate` only).
2. **Each key on the own transition of the last name in the list that sets it** (Q2: A, Motion's), else the element's. "Fade fast, pop with a spring" composes from two variants. A list's return to a Base value runs on the element's transition.
   - Rejected: B (one transition for the list: an earlier name's own would be ignored for its keys); C (the element's only).
   - Per-value transitions (`transition={{ opacity: {…}, default: {…} }}`, Motion's `getValueTransition`) are another matter, filed as #301.
3. **Each name orchestrates the Variant children's keys it sets** (Q3: A, Motion's `animateVariant` a name): its own `delayChildren`, `staggerChildren`, `staggerDirection` and `when`. An entrance name's stagger beside a toggled state's none: toggling the state moves every child at once.
   - Rejected: B (`when` for the list as a whole); C (one orchestration for the list).
   - **Per-name `when` came in PR 2** (Q6). PR 1 took `when` for the list as a whole, the last name whose own transition set it.
4. **The whole list passes down** (Q4: A, Motion's): each Variant child resolves the names it has, in order, and skips the rest. That covers `initial`, `animate`, the inherited exit name (#290) and the gesture labels (#291). Rejected: B (only the names the parent has); C (the last name a child has).
5. **The definition reported, in each binding's shape** (Q5: C):
   - **Solid 1** calls `onAnimationStart` once per name in the list, in order, and `onAnimationComplete` per name as the keys it drives settle. Every name is reported whenever the list changes, as Motion's. Ported callbacks that branch on the name go on working.
   - **Solid 2** has one landing per Retarget, its `definition` the list. `settled()` is a state (#257), and a landing per name would flicker it through names within one animation.
   - Rejected: A (a landing per name on Solid 2 too); B (once per Retarget with the list on both).
6. **Two PRs** (Q6: A). This one is everything but per-name `when`; PR 2 adds that, with the parent's per-name settle and the child's per-name gates, and the presence's exit orchestration.
7. **Defaults stated, not asked:**
   - **A list equal name by name, in order, is the same list** (Motion's `shallowCompare`): a fresh array each render isn't a change of names.
   - **Names:** an unknown name is skipped, as a single unknown name resolves to nothing; an empty list is no name; the order is the merge order.
   - **A dynamic variant in a list** resolves with `custom`. A resolver still returns a target or a single name.
   - **`initial`:** a list gives merged Starting values, on the server too.
   - **Appear** animates a list on its merged transition (each field the last name's that sets it): an Appear animation is one per element. The client's legs take over by elapsed time, as for any.
   - **`exit`:** a list merges its targets, each key on the transition of the last name that sets it. Inside a leaver (#290), each name orchestrates the exits of that name.

**Built:**
- **The resolver** (`variant-target.ts`): `resolveTargets` resolves a list's names each on their own (`NamedTarget`). `resolveTarget` merges them (`mergedOf`): values in order, transitions field by field, so orchestration reads the last name's `when`. `isLabels` tells a list from a values map: a list is an object too, so a string check alone took it for one. The same goes for dom's Starting style (`entryOf`'s list branch).
- **The Override stack:**
  - A list is a layer a name, in order (`Layer.name`), the base's and each gesture's.
  - A single name or a values map takes the path it took before: one layer, nothing else made.
  - The Retarget splits its keys by layer when a layer has its own transition (#291), or when names delay them differently (`delaysDiffer`).
  - A list's returns are a group of their own, on the element's transition.
- **Per-name delays:**
  - A context hands down `staggerFor(name)`, a name's stagger config from its own transition, else the element's, kept per name until the config changes.
  - A Variant child's `extraDelay(name)` folds its slot through it.
  - The slot index is kept in order, and each name's `staggerDirection` turns it at its delay (`directed`).
- **Callbacks:** Solid 1's `animationCallbacks` tells each name at the start, and the spine tells each name's end as the legs of its group settle (`namesSettled`, `nameSettlesOf`). Solid 2's lifecycle lands once, with the list.
- **The hand-down:** `nameOf`, the context's `variant` / `initial`, the gesture labels and the trigger key take a list. Both bindings' `variant` memo keeps a list equal name by name. `sameResolution` compares names the same way, so on Solid 2 a fresh list with the same names starts no Retarget. Solid 1's target memo has no equality, so a re-read config's Retarget is told as its values there, a single name's too (VL3).
- **Exits:** `PresenceExit.groups`, a list's names each with the keys it drives and its own transition; the presence runs each group at that name's delay.
- **Found on the way:** a config with no `drag` offered `x` in a ward's key completions (`DragKeys`: `[never] extends ["x"]`). Fixed, and pinned by WK7.

**What it costs an element that uses none of it** (`bench:solid`, N = 1,000, no variants on the page, against main `2ac3f8c`):
- **The first build** cost Solid 1 +4.6% [+2.3%, +7.7%] on its warm Retarget and +2.1% in bytes, and Solid 2 +1.1% in bytes.
  - Solid 1's animation hooks worked out each Retarget's definition before looking for a callback, where they had looked first.
  - Every Retarget made a match's closures for where a list's returns go.
- **With guards in their place,** the result (control −0.5%, after runs whose controls were too noisy): Solid 1's Retarget −1.4% warm, mount +1.0%, bytes +0.5%; Solid 2's Retarget +0.1% warm, mount −0.3%, bytes +0.2%. Each layer carries its name now.

**Pinned by:**
- **Solid 1:** `test/variant-lists.browser.test.tsx` VL1–VL15:
  - the merge, and each key on its last name's own transition;
  - a fresh list with the same names, and one name changed;
  - the hand-down, and a name's stagger beside another's none;
  - `initial`, `exit` and `whileHover` lists;
  - the callbacks per name;
  - unknown names and the empty list, and a dynamic variant;
  - a list's returns on the element's transition;
  - `when` the last name's that sets it, from an earlier name and from a later one.

  Also `test/variant-lists.ssr.test.tsx` VS1–VS4: the Starting style, a Variant child's, `initial={false}`, and an Appear animation's end.
- **Solid 2:** `test/v2/variant-lists.browser.test.tsx` LV1–LV3, under the diagnostics gate; `test/v2/ward-keys.ssr.test.tsx` WK7 (types).
- **Mutation-checked:** seventeen single-point mutations, sixteen caught:
  - a list resolving its first name (VL15, once `when` was on a later name), or merged in reverse (VS4);
  - one base layer for a list;
  - a list always a change;
  - no hand-down;
  - each binding's delays not per name;
  - no split by delays;
  - the direction ignored;
  - dom's Starting style taking no list;
  - exit groups ignored;
  - a gesture list's first name only;
  - Solid 1's starts told as one, or its names completing together;
  - a list's returns on its first name's transition;
  - `when` from the last whole transition.

  The seventeenth, Solid 2's `variant` memo passing a fresh list on, is equivalent: its `equals` and `sameResolution` both compare name by name, so it starts no Retarget either way.

**Built (PR 2): each name's own `when`.** Motion's `animateVariant` runs per name: with `beforeChildren`, a name's own animation and then its children's animations of that name; with `afterChildren`, the reverse. Other names run alongside.
- **The gate:** a Variant child's keys of a list's name start once the name's gate opens. Its provider's keys of that name have settled since the list last changed, unless the name's `when` isn't `beforeChildren`; and for the child's own children, the same for `afterChildren` (`mayStartFor`, `canStartFor`, the variant node's `names`).
- **Waiting, not re-running:** a shut name's legs start on the Retarget's token behind a gate machine that reads the gate each tick (`gatedBy`). A gate that opens starts that name's legs alone, and leaves the other names' running animations as they are, as Motion's per-name animations run on their own (NW3). A later Retarget ends the wait as it ends a leg.
- **Held where they start:** a shut name's keys are written to the gate at their start values, so another name's first commit, which hands the element's style back (ADR-0034), doesn't drop them to their CSS value.
- **Settles per name:** the spine tells a list's names as the legs of their keys settle (`nameSettlesOf`, shared with Solid 1's callbacks), to the variant node, which keeps them per name (`ownNames`, each record's `names`).
  - **Solid 1** clears them when the trigger changes.
  - **Solid 2** keeps the trigger each was settled at, so an earlier settle counts for nothing.
  - **A name that drives no key** has no leg and settles at once, as Motion's empty variant does (NW5). A list's empty key groups make no leg.
- **The whole-element gate** stays for a single name. A list's `when()` is `undefined`, its names each having their own.
- **The Retarget's common path is as before.** A list's work is done apart, in hoisted functions called only for a list (`splitLegsOf`, `listingOf`), so the Retarget's other calls keep their inlining (docs/agents/effect-first.md). The first build made that work's checks on every Retarget, and every element allocated about 1% more. After it (`bench:solid`, N = 1,000, against main `3145f5b`, control −2.3%): Solid 1's Retarget +1.3% [−0.7%, +2.2%] warm, mount −0.4%, bytes +0.6%; Solid 2's Retarget −0.6% warm, mount +0.5%, bytes +0.3%.
- **Exits inside a leaver** (#290) run per name too (`runName`): each name's own keys, then its Variant children's (or the reverse), the other names alongside. Each element's exit is prepared once and run a name at a time (`preparedOf`).
- **Pinned by:**
  - `test/variant-list-when.browser.test.tsx` NW1–NW6: `beforeChildren`, `afterChildren`, a gate opening without a restart, an exit list, and a name with no key of its own, first in its list and later;
  - `test/v2/variant-lists.browser.test.tsx` LV4;
  - VL14 and VL15, now each name's.
- **Mutation-checked:** thirteen single-point mutations, each caught:
  - no gate shut, or one that opens at once;
  - each binding's names never settling (LV4, once it asserted the child arrives);
  - each binding's `beforeChildren` ignored, and Solid 1's `afterChildren`;
  - shut keys not held;
  - a list's empty key groups making legs (NW5, and NW6 once the empty name was later in its list);
  - each binding taking a list's `when` as a whole;
  - an exit's names all at once, or each running every key.

*Note (#325, 2026-10-23):* a Retarget now keeps a key whose target didn't change on its running Leg (ADR-0005, *Amendment (#325)*), and starts no Leg for a key that landed there. So a Variant child whose values didn't change starts none: no stagger delays it, and an `afterChildren` provider doesn't wait on a no-op Leg of its. A Retarget with no Leg, its own or carried, reports its element settled at the gate's next flush, so a provider whose values didn't change still releases its `beforeChildren` children (SW-j). Under a `when` gate, a key an earlier change started runs on toward its unchanged target; the gated change's keys still wait where they are, the Legs it started just before the gate shut included.

## Amendment (#436, 2026-10-29): `delayChildren: stagger()`, Motion's current stagger form

Motion's `delayChildren` takes a number or a function of a child's index and the count, which `stagger(duration, { startDelay, from, ease })` builds (`.reference/motion` at `16c6122`, `utils/stagger.ts`). A function decides a child's whole delay: `staggerChildren` and `staggerDirection` are then unread (`calc-child-stagger.ts`, `visual-element-variant.ts:96`). With `ease`, `stagger()` eases its delays across `duration × total`, one step past the last child. #436 is one of 1.0's Motion-parity gaps (#426).

**Decisions (grilled 2026-10-29, Q1 A):**
1. **Motion's math, and core's matches** (Q1: A). `stagger()` eases across `duration × total`, so a ported `stagger(0.1, { ease })` gives Motion's delays. Core's `Stagger.make` eased across `amount × (total − 1)`; it takes Motion's span now, and a `startDelay`, so there's one stagger. Nothing in the bindings used its ease before. Rejected: B, core's span for both; C, Motion's in the binding only.

**Defaults, stated:** `stagger()` is exported from both bindings with Motion's signature, returning `(index, total) => seconds`. `delayChildren` takes a number, as before, or that function, which decides each child's whole delay (`staggerChildren`, `staggerDirection` and `from` unread beside it). It places every stagger: a Variant parent's children, a presence's propagated exits, and a server's Appear timing, by the index and count Wardic places a child by. `createAnimate`'s `delay` took a function of each element's index and count already, so `stagger()` staggers a selection too. A skipped child (#468) holds no stagger.

**Built:** `childDelayOf` (`variant-tree.ts`), the one place a child's delay is worked out, where four (both variant nodes, the presence controller's exits and the server's Appear timing) each added `delayChildren` to the stagger before. `WardicStagger`, the function's type, on `WardicOrchestration.delayChildren`. `stagger()` in `stagger.ts`, over core's `Stagger.make`, which gains `startDelay` and Motion's eased span.

**Tests:** core's ME7 (`motion-ease.test.ts`), Motion's numbers eased, a `startDelay`, no amount. Solid 1 (`stagger-fn.browser.test.tsx`, SG1–SG4): children staggered by index, turned by `from: "last"`, a `staggerChildren` and `staggerDirection` beside it unread; `startDelay` and `ease` as `stagger()` says, and its default step; a presence's propagated exits; `createAnimate`'s `delay`. Solid 2 (`v2/stagger-fn.browser.test.tsx`, SGV1). A server (`appear.ssr.test.tsx` AR28, `v2/appear.ssr.test.tsx` AR23): each child's rule delayed by its index. **Mutation-checked** (`.tmp/436/mutate.py`): five single-point mutations, each caught: a function `delayChildren` unread, or `staggerChildren` added beside it; the eased span `(total − 1)`; `startDelay` ignored; another default step. **Bench:** `bench:solid` against main at eb4c27d passed, warm rows within noise (Retarget −1.1% / −0.6%).

## Amendment (#618, 2026-11-05): a name on any variant prop, as Motion's

Wardic counted an element as naming its own variants when its `initial` or `animate` was a name (or Animation controls). Motion's `isControllingVariants` counts a name on any of its variant props: `initial`, `animate`, `whileInView`, `whileFocus`, `whileHover`, `whileTap`, `whileDrag` and `exit` (motion-dom 14.6, `render/utils/variant-props.mjs`). The glossary called Wardic's rule Motion's, and a Motion component ported as it is behaved differently.

**Decision (2026-11-05, #618 decision 8: A):** Motion's rule. `namesOwnVariants` (`variant-tree.ts`, both bindings) counts every variant prop. An element with a named `whileHover` or `exit` is no **Variant child**: it takes none of its parent's names and no stagger slot, and it hands its own names down. An object `whileHover` still leaves it a Variant child. Breaking, before 1.0. Rejected: keeping Wardic's rule and correcting the glossary.

**Tests:** `variant-controlling.browser.test.tsx` VC1–VC3 on Solid 1 and on Solid 2: a named `whileHover` keeps its own look and takes no stagger slot; a named `exit` doesn't follow; an object `whileHover` still does. VC1 and VC2 fail on the old rule.
