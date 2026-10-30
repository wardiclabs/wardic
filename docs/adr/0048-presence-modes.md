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
5. The presence hooks and `propagate`, split in three on one mechanism (*Exits inside a leaver*, PR 5's Q1): 5a, exits inside a leaving child (#290, *Built (PR 5a)*); 5b, the hooks (*The presence hooks*, *Built (PR 5b)*); 5c, `propagate` (*Propagate*, *Built (PR 5c)*).

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
   - **A plain child** (not a Wardic element) leaves at once, as before. *Amended by* Plain leaving children *(#392)*: only one with nothing inside it to wait for.
   - **A leaver hands back its twins** (ADR-0010 *Amendment (#181)*) and crossfades as a twin (`handleLeave`), each on its own, as a lone child did.

## Built (PR 1)

- **The controller tracks the children present at each change**, each with where it was then: its parent and next sibling (`Placed`). `present(current)` takes what the binding's `children()` resolved: one node, a flat array of them, or none.
- **Each node that left is retained and exits** (`left`), unless it's exiting already:
  - put back where it was, if the framework took it out, before its exit starts: a leaver's exit, and its twins' hand-back, read its box where it is drawn (PH3 caught a put-back after);
  - **the leavers of one change go back last first,** each before its old next sibling. A next sibling that left too is back already, so neighbours that leave together keep their order (MC2). *Amended by* *Amendment (#486)*: in Motion's order, right after the staying child each followed.
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
   - **When a child waits:** under `mode="wait"`, while a child exits, or one is leaving in this change with an exit to run. A plain child (not a Wardic element) leaves at once, and one with no `exit` is removed at once, so neither holds anything up. *Since #392,* a plain child with something inside it to wait for exits and holds the entering one up too.
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

## Exits inside a leaver (grilled 2026-10-22, PR 5)

Motion's presence child counts every registrant inside it: each `motion` element with an exit, each `usePresence()` caller, and a nested `<AnimatePresence propagate>`. It removes the child only once all of them have called back (`PresenceChild.tsx` at `16c6122`). Each `motion` element under the leaving child runs its own `exit`. A parent's exit name reaches its Variant children through `animateVariant` (`visual-element-variant.ts`), each child delayed by the parent's `delayChildren` plus its stagger slot, with `when` putting one before the other. Wardic's presence ran only the leaving node's own exit: an element inside it stood where it was until the child went (#290, filed while preparing PR 4, a probe).

1. **Three PRs on one mechanism, the bug first** (Q1: A):
   - 5a, the exits inside a leaving child (#290);
   - 5b, the hooks;
   - 5c, `propagate`.

   All three are the same rule: the child stays until every part inside it is done.
   - Rejected: B, the hooks folded into 5a, where the bug fix would wait on the hooks' API; C, #290 left for later, under a mechanism built for the hooks anyway.
2. **What 5a runs, Motion's** (the scope Q1 settled; defaults otherwise):
   - **Every Wardic element inside the leaving child runs its own `exit`,** from where it's drawn, as the child's own did. The child goes once all of them, and #181's handovers, have ended. A child with no `exit` of its own stays, as drawn, until the exits inside it end.
   - **A Variant child** (CONTEXT.md) inside it exits on the name its provider hands down: the provider's `exit`, if a name, else the name it took itself. It's resolved against the child's own `variants`, with the presence's `custom`.
   - **The provider's exit orchestration** (`delayChildren`, `staggerChildren`, `staggerDirection` and `from`, `when`) comes from its exit target's own transition, else its `transition`, as Motion's.
   - **With `when`, one runs after the other.** The children's delays then count from 0; otherwise they count from the provider's own delay.
   - **An element's own `exit` wins** over the name it would take. It still hands that name down.
   - **Any other element inside**, one that joins nothing inside the child, runs its own exit from the leave.
   - **A twin inside the child** (a `layoutId`) runs none: #181 hands it back, and its crossfade replaces its exit.
   - **An element under a nested `<AnimatePresence>`** is that presence's: the outer leave doesn't run it. That's `propagate` (5c).
   - **A crossfading leaver** (`handleLeave`) runs none of the exits inside it: the projection drives it.

## Built (PR 5a)

- **Each record knows its place in the variant tree** (`PresenceRecord.tree`, `presenceTreeOf`, decided at setup): whether it's a Variant child, whether it provides a context (`changesContext`), and whether it's a twin. An exit resolves with the name it inherits, and hands one down (`PresenceExit.name`).
- **At a leave** (`driveExit`):
  - The parts are the registered records inside the leaver, in document order, twins left out (`partsOf`).
  - Each joining part is matched to its provider: the nearest ancestor inside the leaver that provides a context.
  - The exit tree is resolved once (`ExitNode`). It's the leaver's own tree, plus a tree from each part that joins nothing inside.
  - It runs as Motion's `animateVariant` (`runOf`): each element's exit on a Retarget's legs, `delay` seconds in (`exitOf`).
  - One fiber holds the whole tree, the leaver's exit part, and the leaver goes when it ends. With nothing to animate anywhere, it goes at once, as before.
- **Records are dropped** with their leaver, the parts' with it. A record whose element left the page some other way (its own control flow, inside a child that stays) is dropped at the presence's next change. Before, every record inside a child stayed registered until the presence went.
- **No binding change** but each record's tree flags, built from the config at setup.

## The presence hooks (grilled 2026-10-22, PR 5b)

Motion's hooks (`use-presence.ts`, `use-presence-data.ts` at `16c6122`) work like this:
- **`usePresence()`** registers its component with its presence child and returns `[isPresent, safeToRemove]`. The child stays until `safeToRemove` is called, typically from an effect on `isPresent`.
- **`useIsPresent()`** returns the flag alone.
- **`usePresenceData()`** returns the presence's `custom`.

In Solid, a leaving child's own code is disposed as it leaves, before the presence knows; its `onCleanup` runs first. No effect of its own ever sees `isPresent` turn `false`, so Motion's effect pattern can't port.

1. **`usePresence` takes a callback the presence calls at a real leave** (Q1: B). On Solid 1: `usePresence(() => el, (safeToRemove, custom) => …)`.
   - It's called once the child has left and its node is back in place (or popped, `mode="popLayout"`), with the presence's `custom`. The child is held until `safeToRemove()`.
   - Solid 2 has it as an async value, as #257 settled for that binding: `const presence = usePresence(); <div ref={presence}>`, then `await presence.next("leave")` (it resolves with `custom`), then `presence.safeToRemove()`.
   - Rejected: A, Motion's tuple with the exit in `onCleanup`. That runs at the presence's teardown too, and before the node is put back. Also rejected: C, a promise on both bindings, where Solid 1 takes callbacks everywhere else.
2. **Defaults stated, not asked:**
   - **A hook belongs to the child that holds its element,** as a child is its DOM node (PR 1's Q2). So each hook takes its element: an accessor on Solid 1, `ref` on Solid 2.
   - **`useIsPresent`** is `true`, then `false` from its child's leave on, for what still runs on the retained node: a handler, a timer. It's an accessor on Solid 1, and a sensor given to `ref` on Solid 2.
   - **`usePresenceData`** is an accessor of the nearest presence's `custom`, reactive.
   - **What holds the child:** it stays until every `usePresence` inside it is released, its exits have ended, and its handovers too, as Motion's presence child waits for every registrant. A plain child (not a Wardic element) a hook holds is retained too, and `mode="wait"` waits for it.
   - **What isn't a leave:** the callback isn't called at the presence's own teardown, and on Solid 2 a waiting `next("leave")` is rejected then.
   - **Errors:** a callback that throws is reported (`wardic.presence: a usePresence callback failed`), and lets the child go.
   - **A crossfading leaver** goes with its handover: the hooks inside it are told, but don't hold it.
   - **Outside a presence,** the callback is never called, `isPresent` is always `true`, and the data is `undefined`.
   - **`safeToRemove` before the leave** does nothing, and once released it's done: calling it again changes nothing.

## Built (PR 5b)

- **A presence hook registers a watch** (`PresenceContextValue.watch`, `PresenceWatch`): its element, whether it holds, and what it's told at its child's leave (`leave(custom, release)`) or when it goes some other way (`gone()`).
- **At a leave,** the presence tells the watches inside the child, once its node is back in place and popped (`tellLeave`), and drops them. Each holding one is a part of the leave, ended by its `release` (once).
- **Watches are dropped** with their leaver, at the presence's teardown (told `gone()`), and at a change when their element left the page some other way. That excludes a child `wait` holds off the page, whose hooks wait for it to go on.
- **The presence's `custom`** reaches `usePresenceData` through the context (`data`), reactive.
- **Solid 1:** `usePresence(target, onLeave)` and `useIsPresent(target)`, each returning `isPresent`, and `usePresenceData()`.
- **Solid 2** (`unstable/v2/presence-hooks.ts`):
  - `usePresence()`: a `PresenceHold` given to `ref`, with `isPresent()`, `next("leave")` and `each`, `safeToRemove()`. Its waits end when the child or the presence goes some other way, not with its owner, which is disposed as the child leaves.
  - `useIsPresent()`, a sensor.
  - `usePresenceData()`.

## Propagate (grilled 2026-10-22, PR 5c)

Motion's `propagate` (`AnimatePresence/index.tsx` at `16c6122`): a nested presence calls `usePresence(propagate)`, so with the prop it registers with its parent's presence child, and without it, registers nothing. When that child leaves, `propagate && !isParentPresent` makes every one of its own children leave. Once they've all completed, it calls `safeToRemove()`, at once with none. Without the prop, its children go with the parent's child, as they are (#290's NE8).

1. **Opt-in, Motion's `propagate` prop, `false` by default** (Q1: A). Ported Motion code behaves the same. A nested presence's exits, often a long staggered list, never lengthen the outer close unless asked for.
   - **The split it keeps:** a Wardic element inside a leaving child exits by default (5a), while a nested presence's children exit only with `propagate`. That's Motion's split.
   - Rejected: B, on by default with `propagate={false}` to opt out. Every existing nested presence would then hold its parent's leave for its children's exits, a silent change for Motion ports.
2. **Defaults stated, not asked:**
   - **Its children exit as at any leave** of theirs, on its own `custom`, its hooks told, the exits inside them run (5a, 5b). Its `onExitComplete` (Solid 2: `next("exitComplete")`) comes once they're gone.
   - **What holds the parent's child:** it waits for them all, and for the children already exiting when it left. A nested presence with none, or whose children leave at once, holds nothing.
   - **Two levels and more propagate,** each presence holding its parent's child.
   - **A nested presence removed on its own,** inside a child that stays, is torn down as before: its exits end and its retained nodes go.
   - **`propagate` is read once,** at setup.

## Built (PR 5c)

- **A propagating presence registers with its parent** as a hook that holds it (`propagateTo`, the watch of PR 5b). Its element is where its children are: the parent node of the last children it had (`anchor`). With none yet, a parent's leave doesn't find it, and it holds nothing.
- **Its disposal comes first:** Solid disposes the leaving child, the nested presence with it, before the parent presence hears of the leave. So its teardown waits a microtask:
  - **If the parent's leave reaches it,** every child it had leaves (`leaveAll`, its `present([])`). When the last has gone (`allLeft`, at its `leaveEnds`), it releases the parent's child and tears down.
  - **If not,** the teardown runs then, as before. Without `propagate`, or with no presence above, the teardown runs at its disposal, unchanged.
- **Both bindings:** `propagate` on `<AnimatePresence>`, read before the presence provides its own context, so the presence above is its parent's.

## Keys (grilled 2026-10-22, #286)

Motion keys a presence's children with React's `key` (`AnimatePresence/index.tsx` at `16c6122`). A child whose key comes back while it exits is the same element: `isPresent` turns `true` again, its exit stops, and it animates to its `animate` from its values and velocity as they are. The whole subtree is reused. No `onExitComplete` is told for it, and none comes at all if it was the last leaver, as the check runs only when an exit completes. PR 1 made a Wardic child its DOM node (*Many children*, Q2: C), so a child back mid-exit was a new node entering beside its leaver.

1. **`key` on the Wardic element** (Q1: A). It's Motion's spelling, so ported code works as-is.
   - It counts only on the presence's child itself (its root element, which may be a component's). Anywhere else, it does nothing.
   - It's read once, and never written to the DOM, on the server either. Solid's compiler gives `key` no meaning of its own.
   - A plain child can't be keyed, and keeps PR 1's rule.
   - Rejected: B, `presenceKey` (every port renames `key`); C, `<AnimatePresence keyOf={(node) => …}>` (any child, but the key goes through a `data-*` attribute, far from the item's data).
2. **The take-over** (Q2: A). The leaver goes at once, and the new node starts where the leaver is drawn: each key's value and velocity. It animates to its own `animate` on its own transition.
   - A key the leaver doesn't draw starts from the new node's `initial`, as any entering element's does.
   - The content is the new node's. Motion's reused element shows its new props, so the visible result is the same.
   - Rejected: B, the new node entering from its `initial` (it snaps back); C, the leaver crossfading over it (two nodes again).
3. **The Wardic elements inside pair in document order** (Q3: A). The i-th inside the new child takes over from the i-th inside the leaver, when the two hold as many and each pair has the same tag. Otherwise only the child itself takes over.
   - Rejected: B, a `key` on each inner element (ceremony Motion code doesn't have); C, the child alone (its icon snaps back).
4. **Coming back somewhere else** (Q4: A, Motion's): with `layout`, the new node animates from the leaver's box to its own place. Without it, the new node is drawn in its own place, its values taken over.
   - The siblings close the leaver's gap as at any leave.
   - Rejected: B, its own place always (a jump across the list); C, a take-over only in the leaver's place.
5. **Events and hooks** (Q5: A, Motion's): a take-over ends the leaver's exit without completing it.
   - `onExitComplete` / `next("exitComplete")` aren't told for it. They come once the other leavers complete, or not at all if it was the last.
   - `exiting()` turns off with the last.
   - The leaver's hooks are dropped, as at a teardown.
   - The new node has its own hooks, and its own `onAnimationStart` / `settled()` for the `animate` it turns to, once.
   - Rejected: B, counting it as a completion (an app's "it's gone" would fire with the item back); C, a new reenter event.
6. **Every mode** (Q6: A, Motion's).
   - Under `wait`, a child back under its key is never held, and the children held go in once no leaver is left.
   - Under `popLayout`, the new node is in the flow, and with `layout` glides from the popped leaver's box.
   - Rejected: B, `wait` holding it; C, keys in the default mode only.
7. **Two PRs** (Q7: A). PR 1 is the key and the value take-over on both bindings. PR 2 is the layout take-over (Q4): the new node's first box from the leaver's, in `@wardic/dom`'s projection.
8. **Defaults stated, not asked:**
   - **Duplicate keys:** a new node takes over from the latest leaver with its key, and the others keep exiting.
   - **Back after its leaver went:** there's nothing to take over, so it enters as a new child.
   - **A child replaced in the same change** (a list rebuilt from fresh objects with the same keys) takes over too, at once. Its old node never starts an exit, and its hooks aren't told it left. Motion keeps an element whose key stays.
   - **A keyed twin (`layoutId`) back while it crossfades out:** item 9 (PR 2). This default first said "the key wins, with no crossfade", which isn't what Motion does: it was withdrawn when grilled.
   - **Velocity** comes from the leaver's frames, per key, whatever its exit runs on, as Motion's values track it: a spring's from its frames, a tween's measured over each step's `dt`. A leaver taken over in the change it left in carries its own animation's velocities.
   - **Under reduced motion,** the new node's turn-around follows its own rule.
   - **The leaver's own work stops with it:** its exit, the exits inside it, the twins it handed back, and a `usePresence` hold.

9. **A keyed `layoutId` twin back while it crossfades out** (Q8: D, PR 2, grilled after checking what Motion does). A modal (`key` and `layoutId` `"card"`) closing into its list item, and reopened before that crossfade ends.
   - **Motion** (`MeasureLayout.tsx`, `projection/shared/stack.ts` at `16c6122`):
     - At the close, `relegate()` promotes the list item, with `resumeFrom` the modal, and the modal fades out as a follower.
     - At the reopen, it's the same modal element, so `isPresent` turns `true` again, and `promote()` makes it lead once more. `NodeStack.promote` snapshots the list item where it paints now, and hands that snapshot to the modal as its `resumeFrom`.
     - So the modal crossfades from where the list item paints, fading back in from its opacity, and the list item fades out. One modal is on screen throughout.
   - **Wardic:**
     - The new modal registers under the `layoutId`, and its first measure crossfades from the prior Lead's painted box (ADR-0010 *Amendment (#170)*), which is the list item's, as before.
     - The take-over ends the old modal's leaving Follower at once, uncompleted, and the new modal's handover fades on from the factor that Follower had faded to (`fadeFrom`), not from 0.
     - The list item fades out from where it was, as at any interrupted crossfade (#5).
     - The Lead and Follower rules are unchanged.
   - Rejected: B, as before (the old modal fades out over the new one, which fades in from 0: two modals); A, the default as first stated (no crossfade, the list item hidden at once), which isn't Motion's.

## Built (#286 PR 1)

- **Each Wardic element under a presence tells it it was made,** as its element is made (`made`, from its ref, and from `use:wardic`): its `key`, read once, and whether it's a twin. A child's key is then known before the presence decides what goes on the page, so `wait` doesn't hold it, and before its wards mount, so the elements inside pair.
- **A keyed leaver** is noted by its key as its exit starts, the latest under each key. While none is, a change looks for nothing.
- **Each exit keeps where it's drawn:** its values (the `drawn` map the projection reads), and each key's velocity. A spring leg's comes from its frames; a blend leg's machine is wrapped to measure its numeric keys over each step's `dt` (`measuredInto`), 0 once it settles; a snap's is 0. A record also reads its spine's velocities, for a leaver taken over in the change it left in.
- **Finding a take-over** (`shown`, before the mode decides): a child new on the page whose key is a leaver's, or a keyed child's leaving in the same change.
- **Doing it** (`settleTakeovers`, at the first of the child's wards' mounts, or the presence's next look):
  - Each of the child's Wardic elements gets a seed: the child itself the leaver's drawn values and velocities, and those inside their pairs' (`madeWithin`, `partsOf`, `sameShape`).
  - The leaver goes. An exiting one through `interruptExit`, uncompleted. One leaving in the same change is never retained, and its records and hooks are dropped.
- **The ward reads its seed at its mount, before its first Retarget** (`takeOverOf`, `spine.seed`):
  - The values and velocities go into its Snapshot, and each key into the keys it drove, so one no layer sets returns to its Base value from there.
  - They're drawn at the end of the task (`flushPass`). That's still before any paint, but outside the mount effect, where the first commit's Starting-style switch would flush Solid 2 inside an effect.
  - So the first Retarget starts from the leaver, and tells one start.

## Built (#286 PR 2)

- **Where a leaver painted** is read as its take-over is found (`shown`, before the change moves anything), for it and each Wardic element inside it: `ProjectionSystem.rootBoxOf`. That's its box as it paints, transforms included, in the Root frame, the frame a Switch seed is in. The browser may move the scroll as the leaver goes (scroll anchoring), and the Root frame carries that (KL7).
- **The seed carries it** (`box`), and a ward reads its seed before its layout node registers, which takes it as `enteredFrom`.
- **The node's first measure moves from there** (the projection's take-over branch), as a layout change with no handover. It's rebased into the node's Scroll-stable frame and drawn there on its first frame, its own scale divided out, as a Switch seed is (ADR-0010 *Amendments (#13)*, *(#8)*). A live twin to crossfade from comes first, and the take-over comes before a Switch seed.
- **A keyed twin crossfading out** is noted under its key too.
  - At its take-over, the presence ends its exit (uncompleted), and `ProjectionSystem.dropLeaver` ends its leaving Follower at once (`finishLeaver`), returning the factor it had faded to.
  - The seed carries that (`fade`), and the new node registers with it as `fadeFrom`. The handover its first measure begins fades from there.

## Plain leaving children (grilled 2026-10-25, #392)

**The gap.** A plain `<AnimatePresence>` child (not a Wardic element) left at once (decision 1 of *Many children*), even with Wardic elements inside it that have exits. The exits inside a leaver (PR 5a) ran only under a Wardic leaver, since `driveExit` took the leaver's record. So the Wardic elements in a plain wrapper went with it, unexited. A twin inside one wasn't handed back either, so its other twin popped in at full size. Found by #388's storefront quick view: a plain `div.detail-frame` around a `wardic.article` with an `exit`.

**Motion,** probed in Chromium (framer-motion 14.6, `.tmp/392/motion-probe.ts`):
- Every `motion` element with an `exit` registers with its presence child (`ExitAnimationFeature`), as does every `layout` or `layoutId` element (`MeasureLayout`'s `usePresence`). `PresenceChild` keeps the child until all of them have called back, however deep they sit under plain elements.
- A plain `div` around a `motion.article` with a 0.4 s `exit` stayed while it faded, and went at 423 ms.
- A plain `div` around a `motion.div` with no `exit` was gone in the next frame.
- A plain `div` around a `layoutId` twin stayed about 470 ms while the twin handed over.

1. **Motion's rule** (Q1: A). A plain leaving child runs the exits of the Wardic elements inside it, as a Wardic leaver does (PR 5a):
   - each element runs its own exit from the leave;
   - Variant children follow the name their provider hands down;
   - the child stays until all of them have ended and every hook holding it is released.

   With nothing inside it to wait for, it still goes at once (MC7 unchanged). While it's retained, `popLayout` pops it, `mode="wait"` waits for it, and `onExitComplete` and `exiting()` count it.
   - Rejected:
     - B, keeping "leaves at once" and documenting it: Motion ports that wrap their `motion` elements in a plain `div` would silently lose their exits;
     - C, an opt-in prop on the presence.
2. **It hands back the twins inside it** (Q2: A), as a Wardic leaver does (ADR-0010 *Amendment (#181)*), and stays until their handovers end. Measured on a twin inside a leaving `position: fixed` frame:

   | | Detail | Card | Wrapper gone |
   |---|---|---|---|
   | plain frame, before | vanishes at 0 ms | snaps from opacity 0 to 1 at full size by 32 ms, then shrinks | at once |
   | plain frame, now (as a Wardic frame was) | out by 331 ms | in by 148 ms | 481 ms |
   | Motion | out by 321 ms | in by 138 ms | about 470 ms |

   - Rejected: B, exits only, the twins still going with the child.
3. **A linear `partsOf`** (Q3: A). Plain leavers now take the Wardic leaver's path, whose `partsOf` tested every record of the presence against every leaver with `contains` (N × N). It now walks the leaver's own elements and looks each up in the registry; a walk is already in document order, so the sort went. Removing 1,000 children in one update (medians of 7, Chromium):

   | Shape | Before | Linear walk |
   |---|---|---|
   | Wardic | 61 ms | 40 ms |
   | Wardic, a span inside | 114 ms | 63.5 ms |

   One leaver holding 5,000 plain elements and one Wardic element costs 5.9 ms with the walk against 5.5 ms with the scan.
   - Rejected:
     - B, also putting every leaver back before any exit reads a style: about 7 µs more saved per leaver (40 → 33 ms) for a reordering of `present`'s leave loop;
     - C, keeping the scan: about 110 ms per 1,000 plain children with a Wardic element inside.

## Built (#392)

- **`retains(el)`:** a Wardic leaver, or a plain one with a hook holding it or a registered element inside it (`registersWithin`: an exit to run, or a twin to hand back).
- **`left`:**
  - A plain child that retains nothing goes at once, as before.
  - Any other takes `leave` with no record. It's put back, popped under `popLayout`, hands back its twins (`handBackWithin`), drives the exits inside it, and is counted in `pending` as one part for the exit, one per hold, and one for the handovers.
- **`driveExit(el, rec, custom)`:** with no record, the elements inside are the roots of the exit tree. With a record, the leaver's own tree comes first, as before.
- **`measureLeavers` and `waits`** ask `retains`. A plain child held only by a hook is now popped under `popLayout` too: before, only Wardic leavers were measured.
- **`partsOf`** walks `registeredWithin(el)`, the leaver's own elements looked up in the registry, with nothing to walk when the presence has no records. `DOCUMENT_ORDER` went.
- **Removing 1,000 children in one update,** after the change:

  | Shape | Before | After |
  |---|---|---|
  | plain, nothing inside | 1.2 ms | 1.4 ms |
  | plain, a Wardic span inside | 8.7 ms, exits skipped | 41.0 ms, exits run |
  | Wardic | 61.1 ms | 40.1 ms |
  | Wardic, a span inside | 114.0 ms | 64.2 ms |

- **The storefront:**
  - the quick view's frame is a plain `div` again;
  - the product detail now closes with Motion's crossfade: the card is in by about 150 ms, the detail out by about 360 ms and removed at about 470–500 ms, in both apps.

## A leaver's layout nodes (grilled 2026-10-27, #407)

**The gap.** Found by #366's storefront questions (`/layout/delivery-faq`). Each answer is a `layout="position"` child of a `layout` card, under `popLayout`. Closing one shrinks the card by a layout animation that starts at `scaleY(2.15)`, and pops the answer out of the flow to fade over 0.1 s.
- **Solid disposes a leaver's layout nodes at the leave.** The projection brought them back only inside a leaving twin (ADR-0010 *Amendment (#169)*). So nothing projected a plain one while it exited, and the card's scale stretched it: 66 px drawn 141 px tall, its offset in the card scaled too.
- **Motion keeps an exiting subtree mounted,** so its `layout` nodes go on counter-scaling (`scaleY(0.46)`).

**The containing block changes, in both.** The card isn't positioned, so the popped answer's `top` is measured from an outer offset parent. Once the card takes a transform, it becomes the answer's containing block, and the same `top` places the answer 290 px lower (Wardic) or 226 px lower (Motion). That's inside the card's `overflow: hidden`, which clips it from the first frame. So in all three apps the answer vanished at once instead of fading, and #407's "falls over the questions below" doesn't happen there.

Read after each paint (`.tmp/407/frames.ts`):

| | The card as it is | The card `position: relative` |
|---|---|---|
| Motion 14.6 | y 727, 66 px tall, none of it shown | y 501, 66 px tall, fading where it was |
| Wardic, before | y 790, 141 px tall, none of it shown | y 567, 141 px tall, none of it shown |

Motion's `PopChild` pins as Wardic does: offsets from `offsetParent`, measured before the change (`getSnapshotBeforeUpdate`). Nothing follows an ancestor that becomes the containing block later. *Pop layout*'s "a leaver under a Wardic element's transform is pinned in place" holds only for an ancestor already transformed at the pop.

1. **Motion's parity** (Q1: A). A leaving child's layout nodes with no `layoutId`, it included, come back as nodes it carries while it exits, in every mode. They go when the presence removes it.
   - Under an ancestor's layout animation, each is corrected as a live one would be: the answer is drawn at its own size where it was.
   - Its exit's own values are drawn on the correction, as Motion's projection composes `latestValues`. So an `x` exit still moves it.
   - **The containing block stays the author's,** as in Motion. A popped leaver whose `layout` ancestor animates is placed against that ancestor only while it has a transform. Giving the ancestor a `position` keeps the leaver in place throughout. The storefront's question and order cards now have one (`position: relative`), so all three apps fade the answer where it was.
   - Rejected:
     - B, also drawing it where it was under a static ancestor. Either the projection shifts a carried leaver by its containing block's offset whenever it draws an ancestor with a transform (layout leavers and Wardic's own transforms only), or the presence holds the nearest Wardic ancestor as the containing block (`will-change: transform` inline) while the leaver exits (a style on the author's element, its other absolute descendants re-anchored meanwhile). Motion does neither;
     - C, A with a dev warning for a popped leaver whose nearest `layout` ancestor is static and lies between it and its offset parent.

## Built (#407)

- **`keepLeaving(el, taken)`** (`@wardic/dom`'s `internal/projection.ts`) runs for every child that leaves running its exit. It now also brings back the layout nodes held this task inside `el`, `el` included, that aren't twins and that nothing brought back already (`reintroduceNodesWithin`, #169's, now returning them).
  - Each is a leaving node at its last pass's box, with its `layoutAnchor`, derived under its live ancestors.
  - The call `keepLeaving` returns finishes them (`finishLeaver`): the presence calls it as it removes the child, or as an exit is interrupted.
- **A carried leaving node's write** (`withExitValues`) puts the element's registered values (`registerValues`: its exit's `drawn`) under the projection's patch. `project` weaves their translate, scale and rotation into the projection's transform and copies the rest, its opacity included. A leaving Follower's write is as before: its handover draws over its exit (ADR-0010 *Amendment (#402)*).
- **In `sync` and `wait`,** a leaver stays in the flow, so a change around it can move it. Its node then slides at its own size from its last box to the new one. Before, it was squashed: a 60 px leaver drawn 30 px tall as its card grew from 60 to 120 px.
  - It slides on the default layout transition: a held leaver doesn't keep its element's `transition`, nor do #169's.
- **The storefront:** `.faq-item` and `.order` are `position: relative`.

## Consequences

- **#407: a behaviour change.** A `layout` element in a leaving child is now corrected for its ancestors' layout animations until the child is removed, its exit drawn on the correction, where it was stretched. With no ancestor animating nothing changes: a carried node is derived only under an active one. Each leave costs one walk of the task's held leavers.
- **#392: a behaviour change.** A plain presence child with Wardic elements inside it now waits for their exits and their twins' handovers, where it went at once. Exits that never ran now play, and a twin inside one now crossfades back to its other twin. A plain child with nothing inside it to wait for is unchanged. A leaver's parts are found in a walk of its own elements, linear in a mass removal (decision 3 of *Plain leaving children*).
- **#286 PR 2:** `ProjectionSystem.rootBoxOf` and `dropLeaver`, and `RegisterNodeOptions.enteredFrom` and `fadeFrom`. A layout node registers through one more guard; nothing else changes without a take-over. On `bench:solid` (N = 1,000, against main `8b8417b`, control −1.5%): Solid 1's Retarget −1.8% warm, mount +0.1%, bytes +0.0%; Solid 2's Retarget +1.2% warm, mount −0.3%, bytes −0.2%.
- **#286 PR 1:** `key` on both bindings' Wardic elements and `use:wardic`. Without a key, nothing changes. Under a presence, each Wardic element's ref tells the presence it was made (a WeakMap entry), and each mount asks for a seed (a WeakMap lookup). Outside a presence, nothing is made or asked: on `bench:solid` (N = 1,000, no presence on the page, against main `b85b742`, control +0.7%), Solid 1's Retarget read −0.7% warm and −4.5% cold, mount −0.6%, bytes −0.1%; Solid 2's Retarget +0.6% warm, mount −0.1%, bytes −0.1%.
- **A behaviour change:** a lone child toggled back mid-exit no longer cuts its leaver short. ADR-0046's "an exit a re-entry interrupts doesn't complete" and ADR-0010 *Amendment (#181)*'s "presence's re-entry interrupts a stale exit" no longer hold: see their *Note (#277)*.
- **No new API in PR 1.** PR 2 adds `mode` (`"sync" | "wait"`) on both bindings, and the `PresenceMode` type.
- **PR 5c:** `propagate` on both bindings' `<AnimatePresence>`. Without it, nothing changes. With it, a nested presence holds its parent's leaving child for its own children's exits.
- **PR 5b:** new API on both bindings: `usePresence`, `useIsPresent`, `usePresenceData` (and Solid 2's `PresenceHold`, `IsPresent`, `PresenceLeaveEvents` types). A child is held while a hook in it holds it.
- **PR 5a: a behaviour change.** A Wardic element inside a leaving child now runs its exit, and the child stays for it. One with an `exit` it never ran before now plays it. Only records under a presence change.
- **PR 4:** dynamic variants, `custom`, exits by name and targets' own transitions. **A behaviour change:** an exit now runs on its transition (its own, else the element's), where every exit ran on a default spring.
- **PR 3:** `mode` takes `"popLayout"`. A leaver's removal from the flow, in any mode, runs a Measure pass at the end of the task, so a `layout` sibling animates where it jumped before.
- **Per Wardic element under a presence (PR 2):** one signal, and its read in the mount effect; outside a presence, a check of a local at mount. Under `wait`, a held child costs an array filter per change while it waits.
- **Per change:** a set of the present nodes, and a record per present node. A list of N items costs N records at each change of the list.

## Pinned by

- **#407, solid (Solid 1):** `test/presence-pop.browser.test.tsx` PL14–PL18, in a positioned `layout` card with `layout="position"` answers:
  - PL14: popped out of the shrinking card, drawn where it was at its own size every frame of its exit;
  - PL15: an `x` exit drawn on the correction;
  - PL16: the card landing first, the leaver at its own box with no transform left (a guard: it passes on `main`);
  - PL17: `sync`, a child entering before it: its own size from where it was to its new place;
  - PL18: `sync`, leaving while the card already grows, with no Measure pass at the leave: corrected from the next frame.
- **#407, solid (Solid 2):** `test/v2/presence-pop.browser.test.tsx` PP3, PL14's case under the diagnostics gate.
- **#407, dom:** `test/projection-leavers.browser.test.ts`:
  - LV10: `keepLeaving` brings a leaver's own node back under its parent's animation, at its own box, its registered values on the correction, and the call it returns ends it;
  - LV11: a Follower taken over late isn't moved by its exit's values.
- **#407 mutation-checked** (`.tmp/407/mutate.py`): seven single-point mutations, six caught:
  - nothing brought back (LV10, PL14, PL15, PL17, PP3);
  - the returned call leaving them in the engine (LV10);
  - no exit values on the correction (LV10, PL15);
  - a Follower's exit values on its handover (LV11);
  - no tree or derive at the leave (PL18);
  - only the nodes inside the leaver, not its own (LV10, PL14, PL15, PL17, PP3).

  One is equivalent: the exit's values over the projection's keys. The patch holds only `@projection` and the scale-corrected keys, and a carried node keeps its own shape, so at a unit scale there are none to overlap. The patch goes on top, as the gate merges a live node's projection after its own values.
- **#392, solid (Solid 1):** `test/presence-plain.browser.test.tsx` PN1–PN9:
  - a Wardic element inside a plain child runs its exit, the child staying until it ends, `onExitComplete` after;
  - with no exit inside it, it goes at once;
  - a Variant child exits on its provider's name;
  - a twin inside it hands back, the child staying for the crossfade;
  - `popLayout` pops it, and a `layout` sibling slides in;
  - `wait` waits for it;
  - a hook's hold and an exit together;
  - the presence unmounted mid-exit;
  - a plain child held only by a hook popped.
- **#392, solid (Solid 2):** `test/v2/presence-plain.browser.test.tsx` PN10–PN11, under the diagnostics gate: the exit inside a plain child, and a twin's hand-back.
- **#392 mutation-checked:** nine single-point mutations, each caught:
  - a plain leaver ignoring what's inside it (PN1, PN3–PN6, PN8);
  - handing back nothing (PN4);
  - popLayout measuring Wardic leavers only (PN5, PN9);
  - `wait` ignoring plain leavers (PN6);
  - no record ever found inside;
  - twins counted as parts (PH6);
  - a twin alone not retaining (PN4);
  - a Wardic leaver's own exit dropped;
  - a plain leaver retained as a hold only (PN1–PN4).
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
- **#286 PR 2, solid (Solid 1):** `test/presence-key-layout.browser.test.tsx` KL1–KL7, each read just after its paint:
  - a `layout` item back elsewhere gliding from where its leaver painted;
  - without `layout`, at its own place;
  - in its own place, nothing moving;
  - from a `popLayout` leaver's box;
  - an inner `layout` element moved within its row, starting where its pair was;
  - a keyed twin back mid-crossfade: its Follower gone, uncompleted, the fade on from where it was;
  - a scrolled page, in the page's coordinates.
- **#286 PR 2, solid (Solid 2):** `test/v2/presence-key.browser.test.tsx` KV4: the glide.
- **#286 PR 2 mutation-checked:** thirteen single-point mutations, each caught:
  - no take-over move;
  - the box dropped by the registration, either binding, or the layout options;
  - no boxes, or none inside (KL5, once its badge moved within its row);
  - the Root frame without the scroll;
  - crossfading leavers not keyed;
  - the Follower not dropped, or completed;
  - the fade from 0 (KL6, once read at the first paint) or from 1.
- **#286 PR 1, solid (Solid 1):** `test/presence-key.browser.test.tsx` PK1–PK17:
  - Motion's case: one node at once, drawn where the leaver was, then at its `animate`;
  - a spring's velocity carried over, and a tween's measured one into a spring;
  - a Variant child inside paired, and a different shape leaving the inside to enter as its own;
  - no `onExitComplete`;
  - `mode="wait"` not holding it, and `popLayout`'s new node in the flow;
  - a list rebuilt in one change with the same keys, nothing exiting;
  - a `usePresence` hold not keeping the leaver;
  - two leavers under one key;
  - a key inside the child doing nothing;
  - `key` kept off the DOM;
  - back after the leaver went;
  - a leaver's key returning to its Base value;
  - one `onAnimationStart`;
  - `use:wardic`'s `key`.
- **#286 PR 1, solid (Solid 2):** `test/v2/presence-key.browser.test.tsx` KV1–KV3, under the diagnostics gate: the take-over, `mode="wait"`, and the handle's `exiting()` with no `exitComplete`.
- **#286 PR 1 mutation-checked:** twenty-three single-point mutations, each caught:
  - no take-over found, or the same change's not found;
  - the seed's values, velocities or returns dropped, or never drawn;
  - a blend's velocity not measured, or a spring's not kept;
  - the inside never paired, or any shape paired;
  - `wait` holding it;
  - the leaver not ended, or completed;
  - the same change's old node exiting;
  - the first leaver under a key kept;
  - the key never told (each binding's ward, `use:wardic`, or at all), or written to the DOM;
  - the exit's drawn values ignored;
  - each binding's seed not read.
- **PR 5c, solid (Solid 1):** `test/presence-propagate.browser.test.tsx` PG1–PG10:
  - Motion's case, the inner exit holding the outer child;
  - without `propagate`, the inner child untouched;
  - an inner list;
  - an inner presence with no children;
  - one removed on its own, torn down;
  - its `onExitComplete`;
  - its own `custom`;
  - two levels;
  - an inner child with no exit;
  - children that had all gone already.
- **PR 5c, solid (Solid 2):** `test/v2/presence-propagate.browser.test.tsx` GV1–GV2, under the diagnostics gate.
- **PR 5c mutation-checked:** ten single-point mutations, each caught:
  - never registering, or not holding;
  - the teardown not deferred, or the deferred one never run;
  - the parent never released;
  - `leaveAll` done at once, or never told with nothing to leave (PG10);
  - no anchor;
  - Solid 1 always propagating;
  - the last leaver not telling (once PG1, PG8 and GV1 asserted the outer child went: `until` doesn't throw).
- **PR 5b, solid (Solid 1):** `test/presence-hooks.browser.test.tsx` PU1–PU12:
  - the callback at the leave, with `custom`, and the hold;
  - the node back in place and popped when it's called;
  - a plain child held;
  - the exit and the release both waited for;
  - `onExitComplete` after the release;
  - nothing at the teardown;
  - a throwing callback letting go;
  - `useIsPresent` read by a handler;
  - `usePresenceData` read where it tracks;
  - outside a presence;
  - `mode="wait"` waiting for a held plain child;
  - a hook in a child `wait` held off the page told at its own leave.
- **PR 5b, solid (Solid 2):** `test/v2/presence-hooks.browser.test.tsx` PV1–PV4, under the diagnostics gate:
  - `next("leave")` with `custom`, and `safeToRemove()`;
  - `useIsPresent()`;
  - `usePresenceData()` where it tracks;
  - a waiting `next("leave")` rejected at the teardown.
- **PR 5b mutation-checked:** fifteen single-point mutations, each caught:
  - the hooks never told, or told without `custom`;
  - holds not counted, or a release that ends nothing;
  - a plain child not held;
  - told before the node is back;
  - told at the teardown;
  - a throwing callback holding the child;
  - each binding's `isPresent` never turning `false`;
  - each binding's data read untracked (once PU9 and PV3 read it where it tracks);
  - Solid 2's waits never ending at the teardown;
  - `wait` ignoring a hook's hold;
  - a held child's hooks pruned.
- **PR 5a, solid (Solid 1):** `test/presence-nested.browser.test.tsx` NE1–NE10:
  - an inside element's own exit (the probe's case), the child going after;
  - a child with no exit of its own staying for it;
  - Variant children on the parent's exit name, staggered;
  - `when: "afterChildren"` and `"beforeChildren"`;
  - an own `exit` winning;
  - the presence's `custom` inside;
  - a nested presence's element left to it;
  - the child back and leaving again;
  - a Variant child joining its provider through a Wardic element that provides none.

  Also `test/presence-hand-back.browser.test.tsx` PH6: a handed-back twin's own exit never runs, and doesn't hold the wrapper.
- **PR 5a, solid (Solid 2):** `test/v2/presence-nested.browser.test.tsx` NV1–NV2, under the diagnostics gate.
- **PR 5a mutation-checked:** twelve single-point mutations, eleven caught:
  - no parts;
  - the independent parts left out;
  - no name handed down;
  - no stagger;
  - `when` ignored, or swapped;
  - the inherited name over an own exit;
  - a part's exit without the presence's `custom`;
  - an empty leaver removed at once;
  - twins running their own exits (PH6, once its twin's exit outlasted the handover; an `x` or opacity exit alone is drawn over by the projection);
  - joining any ancestor record, not a provider (NE10).

  The twelfth, parts' records kept past their leaver, changes nothing a test can see: a detached record is skipped at a later leave and dropped at the next change.
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

## Note (#479, 2026-10-29): page transitions with Solid Router

`<AnimatePresence>` around a router's outlet animates a route change, with no new API (grilled on #479, Q1 A). A navigation to another route disposes the old page's component and inserts the new one's DOM nodes, so a page whose root is a Wardic element leaves by itself, as any presence child whose node goes does (*Many children*, Q2: C): no `key`, where React's pattern keys the page on its path because React reuses an element of the same type. A change of a route's params alone keeps the component and its nodes; a page animates it by keying its content (`<Show keyed>` in a presence of its own).

- **`popLayout` for a shared element between pages** (Q2 A): the leaving page out of the flow where it was drawn, the new one in its place at once, a `layoutId` element flying from the leaving page's twin (a leaver hands back its twins, #181, #402). Under `wait` the new page mounts once the old one has gone, its twins with it, so nothing flies.
- **A route loading its data** (Solid 1's `Suspense`, Solid 2's `Loading`): Solid Router navigates inside a transition, so the old page stays on screen, not leaving, until the data resolves.
  - **A page with a `Loading` of its own** around its data, a skeleton (measured on Solid 2, 2026-10-30): that boundary is new, so it shows its fallback rather than hold the navigation. The page is in at once, the old one leaving, and a `layoutId` element outside the boundary mounts with the page and flies. One inside it mounts with the data, after its twin has gone, so it appears where it is, as a twin that mounts after its partner has gone does anywhere. The storefront's *Waiting for a piece's details* shows both (Solid 2 only).
- **The router's scroll to the top** (Q3 A, measured): from a page scrolled down, a shared element flies in from where its twin was in the page, off-screen, and the leaving page jumps to its top (#480).

**Pinned by** (through the real routers' memory histories, which scroll as the browser's do; `@solidjs/router` 1.0.0 and 2.0.0-next.42, devDependencies of `packages/solid`): Solid 1's `route-transitions.browser.test.tsx` RT1–RT6 (the node swap and the pop; a `layoutId` card into a hero and back; `wait` with nothing flying; a navigation back mid-transition; a keyed params change; a route loading its data) and Solid 2's `v2/route-transitions.browser.test.tsx` RTV1–RTV5 (RTV5: a skeleton in the page, the hero outside it, flying while the data loads). The scroll's frames are in #480 (`.tmp/479/probe-route-scroll*.browser.test.tsx`).

**Mutation-checked** (`.tmp/479/mutate.py`, run alone): the presence behaviours a page transition rests on, each broken at one point, caught by the route tests: `popLayout` popping nothing (RT1, RTV1); a leaver keeping no twin for a later twin (RT3: under `wait`, a stale handover then flew the hero from the card's box, so `keepLeaving` is what keeps `wait` from flying); `wait` holding nothing (RT3).

## Amendment (#486, 2026-10-30): a leaver goes back in Motion's order, and a popped one takes no input

A leaver went back before the node that followed it before the change. Solid inserts the entering child before that same node, so the leaver landed *after* the child that replaced it. Under `popLayout`, an invisible leaving page, absolute and later in the DOM, painted over the new page and took its clicks. Since #482 a leaving page that holds a twin stays for the handover, so that lasted 0.5 s in the storefront's catalogue (#479). Grilled 2026-10-30 (#486, Q1–Q2).

**Motion:** `AnimatePresence` reinserts an exiting child "directly after the child they previously followed" (its #3746): it walks the children as rendered, exiting ones included, and puts each exiting child right after the staying child before it, after the others put there, or first. Its `PopChild` pins a popped child as Wardic's `pin` does and sets no `pointer-events`. A popped leaver is `position: absolute`, and a positioned box paints above in-flow, non-positioned boxes whatever the DOM order. So Motion's order alone puts a positioned new page over the leaver, while a static one stays under it, in Motion too.

**Decisions:**
1. **Motion's order** (Q1: A). A leaver goes back right after the staying child it followed before the change, after the leavers back there already, or first if none did. Entering children come after it, and a leaver from an earlier change, still exiting, keeps its place. A page swap renders `[old (leaving), new]`; `[a, b, c]` to `[a, d, c]` renders `[a, b (leaving), d, c]`. In `sync` the leaver sits above the newcomer in the flow, as Motion's does.
   - Rejected: B, right before its replacement only; C, keeping the order and fixing only the clicks.
2. **A popped leaver takes no pointer input** (Q2: B). `pointer-events: none` goes on with the pin (`!important`), from the pop until it goes, so clicks reach what is under it, static or positioned. This diverges from Motion, whose popped child still takes clicks; its own buttons stop responding as it leaves. A Follower inside it already takes none (ADR-0010 *Amendment (#165)*). A leaver in the flow (`sync`) keeps its input.
   - Rejected: A, Motion's order only, documented; C, every leaver in every mode.

**Built** (`@wardic/solid`'s `presence-controller.ts`, both bindings):
- **`orderOf(before, now)`** is Motion's `nextChildren`. It takes `rendered`, the children as the last change left them (leavers still on the page among them), plus this change's leavers, and puts each leaver into `now` right after the staying child it followed.
- **`present`** walks that order. Each leaver of this change goes back (`left(placed, back)`) right after the nearest child before it on the page, or before the nearest after it (`backPlaceOf`), moved there if Solid left it in. Its place (`places`) is where it now is. `rendered` keeps the order, less what's off the page.
- **`pin`** adds `pointer-events: none`. A popped leaver is never unpinned: a child that comes back is a new element (#414).
- `mode="wait"` is unchanged: its new children mount only once the leavers have gone.

**Pinned by** (real paint):
- `packages/solid/test/presence-order.browser.test.tsx` (Solid 1):
  - PO1: a page swap under `popLayout`: the leaver before the new page, taking no input, and a point over both hits the new page, static as it is.
  - PO2: `sync`: the leaver above the newcomer in the flow, keeping its input.
  - PO3: Motion's list example, `[a, b (leaving), d, c]`.
  - PO4: several leavers keep their order, those that followed no staying child first.
  - PO5: a leaver from an earlier change keeps its place.
- `packages/solid/test/v2/presence-order.browser.test.tsx` (Solid 2): POV1, POV2.
- RT8 / RTV7 (`route-transitions.browser.test.tsx`, `v2/route-transitions.browser.test.tsx`): through the real routers, the leaving list before the new page, and a point over the new page mid-transition hits it.
- Updated to Motion's order:
  - PL17 (`presence-pop.browser.test.tsx`): the leaver keeps its place in `sync`, the child that entered below it.
  - The SU tests of ADR-0010 *Amendment (#482)*: a `layoutId` per mount, and the scroll reset after each, now that `sync` stacks the pages.
  - Solid 2's P10, unchanged, passes again once earlier leavers are in the order.

**Mutation-checked** (`.tmp/486/mutate.py`, run alone): 6 single-point mutations, all caught:
- a popped leaver taking input (PO1, POV1);
- a leaver always going first (PO3, POV2, P10);
- a leaver going after the child after it (PO1, PO2, PL17, RTV7);
- earlier leavers left out of the order, or the order never kept (PO5, P10);
- leavers at one place reversed (PO4, P10).
