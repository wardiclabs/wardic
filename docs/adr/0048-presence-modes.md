# AnimatePresence: many children, then Motion's modes, `custom` and the presence hooks

`<AnimatePresence>` covered Motion's basic case: one child, usually behind `<Show>`, kept in the DOM until its `exit` ends. Motion's has more (`.reference/motion` at `16c6122`, `components/AnimatePresence/types.ts`):
- many keyed children, each exiting on its own;
- `mode="wait"` and `mode="popLayout"`;
- `custom`, handed to a leaver's dynamic variants;
- `propagate`;
- the presence hooks: `usePresence()`, `useIsPresent()` and `usePresenceData()`.

#277 brings them, in five PRs, in this order (Q1):
1. **Many children** (*Many children*, *Built (PR 1)*).
2. **`mode="wait"`** (*Wait*, *Built (PR 2)*).
3. **`mode="popLayout"`**, and siblings told of every leaver's going (*Pop layout*, *Built (PR 3)*).
4. **`custom`, with dynamic (function) variants,** exits by name and a target's own transition (*Custom and dynamic variants*, *Built (PR 4)*).
5. The presence hooks and `propagate`.

Both bindings share the work in `packages/solid/src/presence-controller.ts`, so each PR lands there first.

## Why

- **A list where items leave is the common ask** after a single conditional child: a to-do list, notifications, search results. Wardic's presence retained one node, and dropped any other.
- **Many children comes first** because the others build on it: `wait` holds an entering child back while the leavers finish, and `popLayout` takes them out of the flow. Built on the single-child controller, each would be rebuilt with PR 1.
  - Rejected: `mode="wait"` first, the other common ask (a route or tab switch).

## Many children (grilled 2026-10-22, PR 1)

1. **A child is its DOM node** (Q2: C). A child that leaves is a node that left the resolved children, whatever made it: a `<Show>`'s branch, a `<For>`'s item, a `<Switch>`'s match. Each such node exits on its own.
   - **A child back mid-exit is a new node.** Solid has no keys on children, and its `<For>` makes a new node for an item added again. The new one enters beside the leaver, as Motion shows two children whose keys differ.
   - **The cost:** Motion reuses a leaver that comes back under its key, reversing its exit where it is. An optional key would do the same, filed as #286.
   - Rejected: A, a `key` prop on each child (Motion's, but a required prop Solid code doesn't need anywhere else); B, the presence covering only a `<For>`'s items, keyed by item (no `<Show>` or `<Switch>`).
2. **One rule for every child: a leaver finishes its exit** (Q3: A). This holds even beside a new child, and even for a lone `<Show>` child that comes back mid-exit. Before, a re-entry interrupted every stale exit and removed its node: the old one vanished, and the new one entered alone.
   - **Why:** a list item and a `<Show>` child are the same thing to the controller now, and one rule keeps them the same to the app. It's also Motion's: two children whose keys differ both stay until the leaver's exit ends.
   - **What it changes:** a `<Show>` toggled back mid-exit shows the old node finishing its exit beside the new one entering. The Solid 1 `onExitComplete` and Solid 2's `next("exitComplete")` now come once the leaver is gone, where the interrupt completed nothing. `exiting()` stays on until then.
   - **The cost:** a layout that can't hold two (a full-size panel) shows both for the exit's length. That is what `mode="wait"` and `mode="popLayout"` (PRs 2 and 3) are for, as in Motion.
   - Rejected: B, the interrupt kept for a lone child; C, the interrupt for every child.
3. **Defaults stated, not asked:**
   - **A leaver keeps its place in the DOM** while it exits, between the siblings it was between, so the others don't move until it's gone. Leavers side by side keep their order.
   - **Each leaver runs its own exit,** from where it is drawn, as a lone child's did.
   - **`onExitComplete` comes once no leaver is left,** the last by completing, as Motion's (ADR-0046's "complete"). On Solid 2, `next("exitComplete")` likewise, and `exiting()` is on while any child exits.
   - **`<AnimatePresence initial={false}>`** starts every child of the first render at its `animate` (ADR-0007 *Amendment (#134)*). A child added later animates in from its `initial`.
   - **A plain child** (not a Wardic element) leaves at once, as before.
   - **A leaver hands back its twins** (ADR-0010 *Amendment (#181)*) and crossfades as a twin (`handleLeave`), each on its own, as a lone child did.

## Built (PR 1)

- **The controller tracks the children present at each change**, each with where it was then: its parent and next sibling (`Placed`). `present(current)` takes what the binding's `children()` resolved: one node, a flat array of them, or none.
- **Each node that left is retained and exits** (`left`), unless it's exiting already:
  - put back where it was, if the framework took it out, before its exit starts: a leaver's exit, and its twins' hand-back, read its box where it is drawn (PH3 caught a put-back after);
  - **the leavers of one change go back last first,** each before its old next sibling. A next sibling that left too is back already, so neighbours that leave together keep their order (MC2).
- **A leaver's place is kept until its exit ends** (`places`). At every change the controller puts back any leaver the framework has taken out since: Solid clears a `<For>`'s parent wholesale when its list empties, and that took out an item already mid-exit (MC8).
- **No interrupt at a re-entry** (decision 2). An exit ends only at its end, or at the presence's teardown.
- **Both bindings unchanged but for their docs:** each already resolved its children with `children()` and handed the result to the controller, which now reads all of it.

## Wait (grilled 2026-10-22, PR 2)

Motion's `mode="wait"` (`AnimatePresence/index.tsx` at `16c6122`): while any child exits, Motion renders only the exiting children (`nextChildren = exitingChildren`), so an entering child isn't rendered at all. Once every exit has completed, it renders the latest children (`pendingPresentChildren`), after calling `onExitComplete`. Nothing of the entering child runs before then.

In Solid, the change that removes the old child builds the new one. The presence must read its children to see that the old one left, and that read runs the `<Show>`'s new branch. So the entering child exists at once, and the question was which parts of it wait.

1. **The entering child is built at once, but held off the page until every leaver is gone** (Q1: A). It then goes on where Solid put it. Its Wardic elements, and every one inside it, wait until then: their entrance, layout node, gestures and presence record all start on the page. On screen it's Motion's sequence: out, then in.
   - **The cost:** the child's own code runs when Solid builds it, off the page. An `onMount(() => input.focus())` focuses nothing, and a size read there reads zeros. An effect's side effects (a fetch, a "viewed" event, a timer) start an exit's length early, and a child replaced again mid-wait was built and thrown away without being shown. Code that needs the page can run once the child is on it: Solid 1's `onAnimationStart` on its Wardic element, or Solid 2's `next("settled")` on its ward.
   - **It's what Solid's own out-in transition does:** `@solid-primitives/transition-group`'s `createSwitchTransition` (mode `"out-in"`) keeps the new element out of what it renders until the exit's `done`; solid-transition-group and solid-motionone's `exitBeforeEnter` are built on it.
   - Rejected: B, holding the child's own effects too, through Solid's own hold: Solid 1.9 holds an effect under a `<Suspense>` showing its fallback (`runTop`), and Solid 2 one under a `<Loading>` fallback (`heldRun`). The boundary inside the presence would catch the children's own async reads too. A resource would wait at the presence, with no fallback, instead of at the app's `<Suspense>`, and on Solid 1 a shown child whose resource refetches would be hidden by it.
   - Rejected: C, a presence-owned render function (`<AnimatePresence mode="wait" value={tab()}>{(tab) => …}`) that builds the child only once the leavers are gone, as Motion. It's another API, and `<Show>` and `<Switch>` children couldn't wait.
   - Asked as well: whether `mode="popLayout"` (PR 3) covers it. It doesn't: `popLayout` doesn't wait at all. The new child enters at once, and the leaver animates out of the flow, on top.
2. **Defaults stated, not asked:**
   - **When a child waits:** under `mode="wait"`, while a child exits, or one is leaving in this change with an exit to run. A plain child (not a Wardic element) leaves at once, and one with no `exit` is removed at once, so neither holds anything up.
   - **A switch again mid-wait:** the child held in between never goes on the page; the latest one does, as Motion renders `pendingPresentChildren`.
   - **The old child back mid-exit is a new node** (decision 1 of *Many children*): it waits until the old one has gone. Motion's keyed child would reverse its exit instead; #286 would key them.
   - **Many children under `wait`:** every entering child waits while any child exits, and the children that stay, stay. Motion renders only the exiting children then (its present ones unmount), and warns that `wait` with many children "will lead to odd visual behaviour".
   - **`onExitComplete` before the held child goes on,** as Motion's (Solid 2's `next("exitComplete")` likewise).
   - **`mode` is read at each change:** switched to `sync` mid-wait, the held child goes on at once.
   - **A `layoutId` twin in the held child enters in its place, with no handover:** its leaver's twin record ends with the task it left in (ADR-0010), and the held twin goes on an exit's length later.
   - **The presence's teardown mid-wait:** the held child never goes on the page.

## Built (PR 2)

- **The controller decides what goes on the page** (`shown`, called where the binding renders, before Solid applies the change):
  - under `mode="wait"`, while a child exits or is leaving in this change with a registered record, every child that wasn't on the page at the last change is **held**: left out of what the binding renders;
  - `present` is then told what went on the page, so a held child is never a leaver: replaced before it was shown, it just goes;
  - with the last exit's end (after the completion is told), the binding is asked to render its children again (`release`), and the held children go on.
- **A held child's wards wait** (`PresenceContextValue.hold`): a ward whose element is inside a held child queues its start with the presence and returns. Once the held children are on the page, `present` starts them, so the presence record, gate registration, layout node, gestures and entrance all begin there.
  - **Solid 1:** `runSpine`'s mount effect also tracks a signal of its own, made only under a presence; the queued start ticks it, and the effect runs again, the element now on the page. Every Solid 1 surface (`wardic.*`, `createWard`, `use:wardic`, Reorder) mounts through it.
  - **Solid 2:** the ward's mount effect reads such a signal too, and its apply queues instead of mounting.
- **Both bindings:** `mode?: PresenceMode` (`"sync" | "wait"`) on `<AnimatePresence>`; the children go on the page through a memo of `shown` and a release signal, and the effect that tells the controller reads that memo.
- **A ward outside a presence makes and calls nothing for the hold.** The first build asked the presence at every mount through `UndefinedOr` helpers and a closure per element, even with no presence. On `bench:solid` (N = 1,000, no presence on the page), that cost Solid 1's first Retarget after a cold mount +12.4% [+9.3%, +13.5%] (+2.0% warm), though nothing the Retarget runs had changed. A probe with only `create-ward.tsx` reverted read −8.6% cold. The helpers are hot on the Retarget path, so new call sites at mount slow its warm-up. Plain guards, with the signal and its closure made only under a presence, brought it back: Retarget −0.3% warm and +1.5% [−2.8%, +2.3%] cold, mount +0.0%, bytes +0.5%; Solid 2 flat (Retarget +0.8% warm), control −2.0%.

## Pop layout (grilled 2026-10-22, PR 3)

Motion's `mode="popLayout"` (`PopChild.tsx` at `16c6122`) works like this:
- **It measures the leaver** as its exit starts, in `getSnapshotBeforeUpdate`, so before the change is committed: its computed width and height, and its `offsetTop` and `offsetLeft`.
- **It pins the leaver** with a `<style>` rule it injects into `document.head` (or `root`, for a shadow root): `position: absolute !important`, with that size and those offsets. `anchorX` and `anchorY`, marked internal, choose the edges; by default the top and the left, or the right in a right-to-left one.
- **The siblings reflow at once,** and one with `layout` animates into the space. The entering child enters at once.

1. **The presence tells the projection when it moves its children** (Q1: A). It does so for a leaver popped out of the flow, and for a leaver removed at its exit's end, in every mode, so a `layout` sibling slides into the space as Motion's does.
   - **A bug, found while preparing this:** in `sync` mode, a `layout` sibling jumped into a removed leaver's gap. A probe found the next item at its new place from the first frame after the removal. Motion's slides, because its presence re-renders its children as the leaver goes (`setRenderedChildren`), and their `layout` sees the change. Nothing told Wardic's projection: the leaver's own layout node, if it had one, went at the change, not at the removal. `popLayout` needs the same signal as the leaver pops, so one change serves both.
   - Rejected: B, `popLayout` alone, leaving the `sync` jump to its own issue.
2. **Defaults stated, not asked:**
   - **Measured before the change,** as Motion's `getSnapshotBeforeUpdate`. A leaver is measured where it is when the binding renders, before Solid applies the change, so a child entering before it in the same change doesn't push it.
   - **Pinned with inline styles marked `important`,** not an injected `<style>` rule. So there's no `root` prop and no CSP `nonce` to pass, and the pin wins over any author rule, Motion's only over less specific ones.
   - **Pinned by its margin box,** as `top` and `left` position it. Motion's offsets are its border box's, so its leaver moves by its top or start margin. Right to left, the inline start is measured from the containing block's padding box, where Motion's is from its parent's border box.
   - **Anchored at the top and the inline start** (the left, or the right in a right-to-left one), Motion's default. No `anchorX` or `anchorY`: Motion's are internal.
   - **Whole pixels:** the offsets are the DOM's `offsetTop` and `offsetLeft`, as Motion's.
   - **A leaver with no size of its own** (an inline element, or an empty one) isn't popped, as Motion's.
   - **A sibling without `layout`** takes its place at once, as in Motion.
   - **The entering child enters at once,** as in `sync`. Every leaver pops, a crossfading `layoutId` twin included.
   - **Containing blocks:** Chromium's `offsetParent` counts a transformed ancestor as the containing block, so a leaver under a Wardic element's transform is pinned in place (probe: 0 px off).
   - **A plain child is removed by Solid, not the presence:** its siblings move as at any Solid change. A `layout` sibling animates only when something triggers a Measure pass, where Motion's presence re-renders it.

## Built (PR 3)

- **`PresenceMode` gains `"popLayout"`.**
- **Measured in `shown`** (`popBoxOf`): each child shown at the last change, leaving in this one with a registered record, before Solid applies the change. Its computed width and height, and its margin box's offset from its containing block's padding edge: from the top, and from the left, or the right in a right-to-left one. The width from the right is the offset parent's `clientWidth`, or the viewport's when the offset parent is the body. A leaver with no width or height of its own isn't measured.
- **Pinned in `left`** (`pin`), once it's put back: `position: absolute`, its width and height, its top and its left or right, each `important`. The pin stays until the leaver is removed.
- **The projection told** (`ProjectionSystem.notify`, a Measure pass at the end of the task):
  - by `present`, once, when the change popped a leaver;
  - by `finishExit`, when it removes a leaver that's in the flow. A popped one moves nothing, and a detached one neither.

  This holds in every mode.
- **The bindings:** only the prop's doc.

## Custom and dynamic variants (grilled 2026-10-22, PR 4)

Motion's dynamic variants (`resolveVariantFromProps` at `16c6122`): a `variants` entry may be a function, called with the element's `custom`, its values now and their velocities, which returns a target or another variant's name. `<AnimatePresence custom>` is what a leaving child's exit resolves with, as a removed child's props can't change. A variant is a `TargetAndTransition`: its own `transition` drives the animation it starts, in place of the element's, unless it sets `inherit: true` (`resolveTransition`). Wardic's variants were value maps, `exit` took values only, and no target carried a transition.

1. **Everything Motion's two canonical examples need** (Q1: A):
   - a `variants` entry may be a function `(custom, current, velocity) => target | name`;
   - `custom` on Wardic elements and `createWard`'s config;
   - `exit` takes a variant name;
   - `<AnimatePresence custom>`;
   - a variant's own `transition`.

   The two examples are the slideshow (an exit that goes the latest direction) and the staggered list (each item's `delay` from its index).
   - Rejected: B, without a variant's own transition, which leaves the `delay: i * …` form, `custom`'s most common use, without a port.
   - **Filed while preparing:** #290, a Wardic element inside a leaving child never runs its own `exit` (a probe: its transform stayed empty through the whole exit), and #291, the `while*` props taking a variant name. The user's call on #291: all five gestures.
2. **A bug fixed here: exits ignored `transition`.** Every exit ran on a default spring, whatever the element's `transition` said. A variant's own transition needs the exit to read one, so an exit now runs on `legsOf`, as a Retarget does: on the exit target's own transition, else the element's (or the one it inherits). A tween, a spring, a delay and reduced motion behave as in any animation.
3. **Defaults stated, not asked:**
   - **Motion's order:** a name's entry is looked up, a function is called, and a function that returns a name is followed once more.
   - **`current` and `velocity`** are copies of the element's Snapshot: its values and their velocities as the variant is resolved.
   - **A `custom` change re-resolves,** and a value that changed animates, as Motion re-resolves at each render. A change of the transition alone starts nothing: Retargets compare values.
   - **Each element resolves with its own `custom`.** A Variant child resolves the name it inherits with its own, as Motion's children do.
   - **An exit resolves once, as the child leaves,** with the presence's `custom` when that's given, else the child's own as it last was; it's never re-resolved mid-exit (Motion skips re-processing an active exit).
   - **`animate` and `exit` maps carry a transition too** (Motion's `TargetAndTransition`); `initial`'s is ignored, as it starts nothing. A CSS `transition` string in a values map stays a value: only an object is a target's transition.
   - **Each layer animates on its own transition:** the keys the base target drives on its own, an active gesture's keys on the element's, as Motion runs each animation type on its own. A gesture's own transition comes with #291.
   - **Orchestration** (`staggerChildren`, `delayChildren`, `staggerDirection`, `when`) is read from the target's own transition, else the element's, as Motion's `animateVariant`. The transition its children default to stays the element's: a variant's `delay` isn't handed down.
   - **The Starting style and a server render** resolve a dynamic `initial` with `custom` and no values; an Appear animation is timed on the target's own transition (#48).
   - **No `transitionEnd`:** Wardic has none yet.

## Built (PR 4)

- **Types** (`config.ts`, both bindings' exports): `WardicVariant` (values, or values with a `transition` object), `WardicVariantResolver`, `WardicVariants` and `WardicVariantTransition` (a transition with `inherit`). `initial`, `animate` and `exit` take a `WardicVariant` or a name; `custom` on `WardConfig`, the `wardic.*` props and Solid 2's ward config; `custom` on both `<AnimatePresence>`s.
- **The resolver** (`variant-target.ts`, Solid-free): `resolveTarget(entry, variants, custom, state)` returns a target's values and its own transition; `transitionOfTarget` lays it over the element's; `startingVariantsOf` resolves dynamic entries for dom's Starting style (as they are when none is a function); `ownTransitionOf` is what orchestration reads.
- **A Retarget:** `resolutionOf` takes the spine's Snapshot as the resolver's state (nothing allocated per element), and its `Resolution` carries the base target's own transition. The Retarget runs the base keys on it; when it has one and a gesture is active, the gesture's keys run on the element's (`gesturedKeysOf`).
- **Orchestration:** both bindings' variant nodes read stagger and `when` from one memo, the target's own transition else the element's.
- **Exits:**
  - The presence record resolves its exit as the child leaves: `exitOf(custom)`, from an `ExitConfig` (`exit`, `variants`, `custom` and transition) that an effect keeps current while the child is alive, under a presence only.
  - On Solid 2, it's first read untracked at setup. Read in the ward's body, the inherited transition is a reactive read the diagnostics gate refused (`STRICT_READ_UNTRACKED`), across 21 tests.
  - The controller passes its `custom` prop, read untracked, and runs the exit's legs on the retained node (`exitRunOf`).
- **`custom` is a rare key** on `wardic.*` (#273): read only when given.
- **A ward's typed keys** (`AnimatedKey`) leave out a target's `transition`; a dynamic variant's keys are its result's.
- **What it costs an element that uses none of it** (`bench:solid`, N = 1,000, against main `3ddacdd`, control +1.4%): nothing measurable. Solid 1's Retarget read −1.3% warm and −0.4% cold, mount +0.2%, bytes −0.0%; Solid 2's Retarget −5.2% warm, mount +0.1%, bytes −0.1%.
- **Tests changed by the exit fix:** PL1 and PP1's leaver now exits on the element's transition, so its exit is made longer than the siblings' slide (their transition's `layout` key), which it had outlasted on the spring.

## Consequences

- **A behaviour change:** a lone child toggled back mid-exit no longer cuts its leaver short. ADR-0046's "an exit a re-entry interrupts doesn't complete" and ADR-0010 *Amendment (#181)*'s "presence's re-entry interrupts a stale exit" no longer hold: see their *Note (#277)*.
- **No new API in PR 1.** PR 2 adds `mode` (`"sync" | "wait"`) on both bindings, and the `PresenceMode` type.
- **PR 4:** dynamic variants, `custom`, exits by name and targets' own transitions. **A behaviour change:** an exit now runs on its transition (its own, else the element's), where every exit ran on a default spring.
- **PR 3:** `mode` takes `"popLayout"`. A leaver's removal from the flow, in any mode, runs a Measure pass at the end of the task, so a `layout` sibling animates where it jumped before.
- **Per Wardic element under a presence (PR 2):** one signal, and its read in the mount effect; outside a presence, a check of a local at mount. Under `wait`, a held child costs an array filter per change while it waits.
- **Per change:** a set of the present nodes, and a record per present node. A list of N items costs N records at each change of the list.

## Pinned by

- **solid (Solid 1):** `test/presence-many.browser.test.tsx` MC1–MC9, around a `<For>`:
  - an item removed from the middle exits in its place, and a later change doesn't bring it back;
  - two neighbours removed together, in their order;
  - the list emptied;
  - exits that overlap, completed once;
  - an item added while another exits;
  - an item removed and added back, two nodes;
  - a plain item;
  - an item mid-exit when the list is emptied;
  - `initial={false}`.
- **solid (Solid 1):** `test/presence-exit-complete.browser.test.tsx` EC2: a child back mid-exit, completed once the leaver is gone.
- **solid (Solid 2):**
  - `test/v2/presence.browser.test.tsx` P9 (the old node finishes beside the new one) and P10 (a `<For>`, items removed one after the other, in order);
  - `test/v2/presence-handle.browser.test.tsx` PX2 (`exiting()` on until the leaver is gone, which completes it) and PX9 (two items leaving one after the other, one completion).
- **PR 2, solid (Solid 1):** `test/presence-wait.browser.test.tsx` WT1–WT11:
  - a switch: off the page while the leaver exits, then in from its `initial`, `onExitComplete` before;
  - the held child's `onMount` off the page;
  - a Wardic element inside the held child, animating in on the page;
  - a switch again mid-wait;
  - the old child back mid-exit;
  - a plain leaver, and one with no `exit`;
  - `sync`, the default;
  - a list under `wait`, with a change mid-wait;
  - the presence unmounted mid-wait;
  - `mode` changed to `sync` mid-wait;
  - a `layoutId` twin entering in place.
- **PR 2, solid (Solid 2):** `test/v2/presence-wait.browser.test.tsx` PW1–PW4, under the diagnostics gate: a switch with the handle's `exitComplete`; the held child's effect off the page and a `ward()` spread inside it animating in on the page; a switch again mid-wait; the presence unmounted mid-wait.
- **PR 4, solid (Solid 1):**
  - `test/dynamic-variants.browser.test.tsx` DV1–DV10:
    - a function variant with `custom`, and a `custom` change re-resolving it;
    - the resolver's `current` and `velocity`;
    - a resolver returning a name;
    - each item's delay from its index;
    - `inherit: true` against a replaced transition;
    - a gesture's keys on the element's transition;
    - `staggerChildren` in a parent variant's transition;
    - a dynamic `initial`;
    - an `animate` map's own transition.
  - `test/presence-custom.browser.test.tsx` PC1–PC7:
    - the slideshow, with the presence's `custom` and without;
    - `exit` naming a plain variant;
    - an exit on the element's transition, on its own, and delayed;
    - a `custom` changed while alive.
  - `test/dynamic-variants.ssr.test.tsx` DS1–DS2, and `test/appear.ssr.test.tsx` AR15: a target's own transition timing its Appear animation.
- **PR 4, solid (Solid 2):** `test/v2/dynamic-variants.browser.test.tsx` DW1–DW6, under the diagnostics gate; `test/v2/ward-keys.ssr.test.tsx` WK6 (types).
- **PR 4 mutation-checked:** eighteen single-point mutations, each caught:
  - the resolver never called, called without `custom`, or without `current` and `velocity`;
  - a resolver's name not followed;
  - a Retarget ignoring the own transition;
  - `inherit` ignored, or always merged;
  - gesture keys not split, or split onto the base's transition;
  - each binding's orchestration from the prop only;
  - the Starting style's variants unresolved;
  - the presence's `custom` ignored;
  - an exit ignoring the element's transition, or its own;
  - each binding's exit config not kept current (PC7, DW5);
  - Appear ignoring a target's transition.
- **PR 3, solid (Solid 1):** `test/presence-pop.browser.test.tsx` PL1–PL13:
  - a leaver popped in place, with a `layout` sibling sliding into its space;
  - a sibling without `layout`, at its place at once;
  - `sync`'s gap fix: a `layout` sibling sliding in once the leaver is removed;
  - pinned in place:
    - with margins;
    - right to left from the viewport (a body with a margin);
    - with a child entering before it in the same change;
    - two neighbours together;
    - inside a positioned container with padding and a border, and right to left inside a bordered one;
    - over a stylesheet's `!important` position and size;
  - a switch, the new child at once under the popped leaver;
  - an inline leaver, not popped;
  - a leaver with no `layout` of its own, its siblings still sliding.
- **PR 3, solid (Solid 2):** `test/v2/presence-pop.browser.test.tsx` PP1–PP2, under the diagnostics gate: the pop with a sliding sibling, and `sync`'s gap fix.
- **PR 3 mutation-checked:** fourteen single-point mutations, each caught:
  - never pinned;
  - measured after the change (PL6–PL8);
  - either margin ignored;
  - right to left anchored left, or its margin ignored;
  - no notify after a pop (PL11) or at a removal (PL3, PP2);
  - no size pinned;
  - the container's border counted (PL12);
  - the body's width for the viewport's (PL5, once the body had a margin);
  - a leaver with no size popped;
  - measured in every mode;
  - the pin not `important` (PL13).
- **PR 2 mutation-checked:** fifteen single-point mutations, thirteen caught:
  - never holding, waiting only on exits already running, wards never held, no release, a release only with events wired, every child held (WT8), not only entering ones;
  - each binding told what resolved instead of what went on the page;
  - each binding's ward not held, or never started again;
  - Solid 1's `mode` read once (WT10).

  Two are equivalent:
  - a held ward started at any change waits again, as its own check holds it (the check saves its re-run);
  - a release at the teardown renders nothing.
- **PR 1 mutation-checked:** six single-point mutations, each caught:
  - leavers put back in document order (MC2);
  - no put-back at later changes (MC8);
  - no put-back as a leaver leaves (PH3);
  - a re-entry interrupting the leavers (EC2, MC5, P9, PX2);
  - one child only (MC1, MC2);
  - a finished leaver's place kept (MC1).
