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
3. `mode="popLayout"`.
4. `custom`, with dynamic (function) variants.
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

## Consequences

- **A behaviour change:** a lone child toggled back mid-exit no longer cuts its leaver short. ADR-0046's "an exit a re-entry interrupts doesn't complete" and ADR-0010 *Amendment (#181)*'s "presence's re-entry interrupts a stale exit" no longer hold: see their *Note (#277)*.
- **No new API in PR 1.** PR 2 adds `mode` (`"sync" | "wait"`) on both bindings, and the `PresenceMode` type.
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
