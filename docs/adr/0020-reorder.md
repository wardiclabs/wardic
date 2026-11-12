# `<Reorder>`: drag to reorder, headless first, on the projection engine

`<Reorder>` lets a user drag the items of a list or grid into a new order (#44). It's built in four layers:

- **Core** (`@wardic/core`): `makeReorderGroup`, which has no framework in it. It decides when a dragged item has passed a neighbour (the **Crossover**) and what the new order is.
- **`@wardic/dom`**: `makeReorderController`, the half every DOM binding shares. It owns core's group, reads the group element's `direction`, runs Auto-scroll, routes each item's drag samples, and detects the axis after every Measure pass.
- **`@wardic/solid`**: `createReorderGroup`, `createReorderItem` and `reorderItem`: Solid's reactivity, lifecycle and elements over the controller.
- **Components**: `Reorder.Group` / `Reorder.Item`, built on those.

The items are ordinary `layout` + `drag` elements. The projection engine keeps the dragged item under the pointer and animates the displaced siblings to their new slots (ADR-0016). The group reads each item's box from its projection handle and hands the new order to the app through `onReorder`.

The same work fixes four engine problems that broke a reorder outright. Each has its own amendment:

- a window resize leaves every box stale (ADR-0018, *Amendment (#39)*);
- a plain scroll container leaks its scroll into every box (ADR-0012, *Amendment (Reorder)*);
- a scroll during a drag leaves the item behind, and touch and text selection cancel drags (ADR-0019, *Amendment (Reorder)*);
- the drag handoff gains the box getters and the raise (ADR-0016, *Amendment (Reorder)*).

## Why

- **Motion's `Reorder` is the reference.** `Reorder.Group` owns a controlled `values` / `onReorder` pair and a registry of item boxes. Each `Reorder.Item` is a `layout` + `drag` element that reports its box and asks the group to reorder on each drag update ([Group.tsx:101-169](https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/framer-motion/src/components/Reorder/Group.tsx#L101-L169), [Item.tsx:94-131](https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/framer-motion/src/components/Reorder/Item.tsx#L94-L131)).
- **Measured before designing (2026-09-30, headless Chromium and Firefox, Playwright's real mouse and Chromium's DevTools touch, 2–3 runs per case).**
  - The setup: a throwaway reorder list built from what Wardic already had (`layout` + `drag` under `<LayoutGroup layoutDependency>`, the crossover copied from Motion), run against `motion/react` 13.4.6 and framer-motion 13.4.0 through the same cases.
  - **Fine as it was:**
    - Displaced siblings animated smoothly, moving on their first painted frame and settling in ~546 ms (Motion's 0.45 s tween: ~433 ms, one frame held).
    - A sibling whose flight was reversed turned round more smoothly than Motion's: it ran on 1.8 px, where Motion ran on 5.3 px and then nearly stopped for three frames.
    - The release always ended on the slot.
  - **Broken, fixed in the amendments:** the resize, a plain scroll container, a scroll during a drag, touch, and text selection. The numbers are in each amendment.
  - **Broken, fixed here:**
    - Without a raise, the dragged item was painted under a displaced sibling in 16–23% of a reversal's frames.
    - Motion's single-axis crossover never reorders toward a neighbour in an `rtl` row, `row-reverse` or `column-reverse`, and walks an item dragged the other way to the far end (below).

## Decisions (grilled against Motion @ `16c6122` and `motion/react` 13.4.6 at runtime, 2026-09-30)

- **Headless first (grill decisions 8, 9).** Solid users also work outside JSX (web components, imperative code), so the building blocks come first and the components are thin. Motion has no headless Reorder.
  - `makeReorderGroup` (core) holds the registry, the Crossover, axis detection, the drag direction, the mapping back onto `values`, and the guard below. A binding or Environment reuses it, and only wires it up.
  - `createReorderGroup(config | () => config)` returns a spreadable `{ ref, style }` for the container. `config` is `{ values, onReorder, axis? }`, with static fields reactive through the accessor. The `ref` lets it read the container's `direction`. The `style` carries `overflow-anchor: none`, which the user's style can override, as in Motion (`Group.tsx:187-195`). It triggers a Measure pass whenever `values` changes, including a reorder the app makes itself.
  - `createReorderItem(group, config | () => config)` returns a `Ward`, the same shape as `useWardic`'s, built on it with `layout` and a drag whose axis is decided per gesture. `config` is `{ value }` plus ordinary `WardicConfig` fields.
  - `reorderItem(el, () => ({ group, value, … }))` drives any element it's given through the commit sink, like `use:ward`, and is client-only for the same reason (ADR-0003).
  - `Reorder.Group` (`as`, default `"ul"`) renders the matching `wardic.*` element. `Reorder.Item` (`as`, default `"li"`) renders a plain `as` element wired by `createReorderItem`. Both take the element's props and the motion props, except `layout` / `layoutId` / `drag` on the item.
  - The app renders items with `<For>`, which is React's `key` here. A warning (an Effect `logWarning`, once per group) fires when an item unmounts and one with the same `value` mounts in the same task, the signature of `.map`.
  - `move(value, toIndex)` on the group reorders through `onReorder`, so an app can add buttons or keys (WCAG 2.2 SC 2.5.7; built-in keyboard reordering is #43). *Since ADR-0037, every group has a built-in **Keyboard reorder** (D13's deferral resolved), and `move` announces.*
- **Each item's box reaches the group by pull (decision 2).**
  - The projection handle gains `layoutBox()`, `dragOffset()` and `layoutVersion()` (ADR-0016, *Amendment (Reorder)*). The group reads them on each drag sample.
  - After a reorder it makes no further reorder until the dragged item's `layoutVersion()` has moved, i.e. until a Measure pass has measured the new order. That's Motion's `isReordering` guard, which 13.4.6 clears only when `values` changes.
  - There is no push callback: Motion's `onLayoutMeasure` is undocumented ("Internal", its changelog 2.4.0). A public one later would add one.
- **The Crossover is Motion's rule (decision 3), with two changes (decisions 3 and 4).**
  - The rule, ported with its unit tests:
    - on a single axis, the item swaps with the next neighbour once its leading edge passes that neighbour's centre; *since the Amendment (2026-11-12) below, and past each further neighbour whose centre the edge has passed in the same sample;*
    - in `"xy"`, the item's centre picks a line and the nearest box in it ([check-reorder.ts](https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/framer-motion/src/components/Reorder/utils/check-reorder.ts)).
  - **The direction comes from a 100 ms window.** Motion's single-axis rule does nothing at zero velocity. Core `drag`'s 30 ms window reads zero whenever two moves are more than 30 ms apart: 11–26% of headless mouse moves, and 17 of 18 touch moves. So a slow, careful drag would never reorder. The group computes the direction with Motion's `getVelocity` (`PanSession.ts:383-440`), ported to core, over the gesture's points. `drag` itself is unchanged, so no Fling changes. (A layout node's release takes its velocity from the same window since ADR-0016's *Amendment (velocity family)*, decision 2; a free Fling's window is #139.) *Since ADR-0004's Amendment (#139), `drag`'s own velocity is this window, and the group reads it from each sample: `Reorder.dragMove` takes it, and the group keeps no points.*
  - **The neighbour is chosen by position, not by index.** Motion's single-axis rule takes `order[index ± 1]`, which is only the neighbour on the moving side when the list runs in reading order.
    - In an `rtl` row, `row-reverse` or `column-reverse`, it never reorders toward a neighbour (4/4 runs each, both browsers, 13.4.6). A drag the other way walks the item to the far end (`acbde → acdbe → acdeb`).
    - Motion ≤ 13.0 sorted items by position first and was correct; 13.1.0 dropped the sort while announcing "RTL support".
    - Here the neighbour is whichever of `index ± 1` has its centre on the side of the motion, crossed by the edge facing it. In reading order that's the same neighbour and the same test, so Motion's single-axis tests pass unchanged. A value order shuffled against position (CSS `order`) isn't covered.
    - `"xy"` keeps Motion's rule and its `direction`, read once per drag start (Motion reads it on every update).
- **The axis is detected (decision 5).**
  - `axis` is optional. Without it the group runs Motion's `detectAxis` on the items' boxes at each drag's start: `"x"`, `"y"`, or `"xy"` when they are separated on both axes. An `axis` prop overrides that, and can change at runtime (Motion #3022).
  - The axis is fixed for the whole gesture. The item's drag reads it at the gesture's start, and the public `drag` prop stays static.
  - `touch-action` has to be right before a touch starts, so the controller also detects the axis at the end of every Measure pass, through an engine listener `@wardic/dom` doesn't export: none while the app sets `axis`, and at once when the app clears it. Mount, a reorder and a resize each end in a pass. Motion detects on every item's every measurement (Group.tsx:121-133). Items take Motion's mapping: `pan-x` for `"y"`, `pan-y` for `"x"`, `none` for `"xy"`.
- **The dragged item is raised until it lands (decision 10).** `Reorder.Item` opts its node in, and the engine then writes `z-index: 1` with the node's projection from the drag's start until its release settles (ADR-0016, *Amendment (Reorder)*). Motion raises while its drag offset is non-zero (`Item.tsx:83-85`). Unlike Motion, a user's own `z-index` shows at rest. (Since ADR-0016's *Amendment (velocity family)*, decision 6 (#88), the held item carries `2` and one flying back `1`, so a re-grabbed item paints above the last one.)
- **Auto-scroll (decision 16), Motion's algorithm** ([auto-scroll.ts](https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/framer-motion/src/components/Reorder/utils/auto-scroll.ts)):
  - within 50 px of the scroller's visible edge it scrolls 25 px × (1 − distance/50)² per drag update;
  - it starts only when the drag direction points at that edge;
  - it caps at the scroll range it had when it started;
  - in `"xy"`, the faster axis scrolls.
  - The edge math is in core. `@wardic/dom` finds the nearest `overflow: auto | scroll` ancestor of the group (or the document) once per gesture, not on every update as Motion does, and applies the scroll.
  - It keeps going while the pointer holds still because each scroll becomes a move of the held pointer (ADR-0019, *Amendment (Reorder)*), as Motion's `PanSession` does.
  - It's Reorder-only, as in Motion.
- **The release is unchanged (decision 12):** a FLIP to the latest slot on the item's layout transition, with a Priming step (ADR-0016). Motion's release is an inertia with the drag's velocity. It carried a flick 16–40 px past the release point, and it settles more slowly (a 200/40 bounce spring). That belongs to the velocity grill with #30.
- **No `layout` prop on `Reorder.Item` yet (decision 11).** It always animates like `layout`. Motion's `layout: true | "position"` comes with the engine's layout modes (#42).
- **SSR.**
  - The group renders its items in `values` order, with `overflow-anchor: none` and the drag defaults, as Motion's server markup does (`Reorder/__tests__/server.ssr.test.tsx`). Nothing measures or drags on the server.
  - A server-render test pins it on DomLive (ADR-0021).
- **Traced.**
  - Each reorder decision is a cold-path debug log carrying the value, its old and new index, the axis and the direction.
  - A reorder held back by the guard logs once per wait.
  - Auto-scroll logs when it starts and stops.
  - The per-sample reads and checks stay quiet (the observability convention).

## Considered Options

- **Components only, as Motion ships them.** Rejected (decision 8): no use outside JSX.
- **A single `createReorder()` factory** (group and item from one object). Rejected (decision 9): it drifts from `useWardic` / `use:ward`, and has no element-level form.
- **Only the core helpers, plus public drag callbacks.** Rejected: every user would rebuild the guard, the direction and the axis logic, and engine seams would become public.
- **Push each item's box (Motion's `onLayoutMeasure`).** Rejected (decision 2): the group still needs the dragged item's offset from the engine; the callback would run app code during the pass; and nothing else needs it yet.
- **The binding measuring items itself.** Rejected: a forced layout on every sample, and `offset*` ignores transformed ancestors and scroll containers.
- **The direction from `drag`'s own velocity**, or from each move's delta when that velocity is zero. Rejected (decision 3):
  - the first never reorders a slow drag;
  - the second lets a 1 px wobble right after a swap, in a list with no gaps, swap back (inferred from the thresholds).
  - Widening `drag`'s window for every drag would change every Fling; that's the velocity grill's call.
- **Motion's index-based neighbour.** Rejected (decision 4) as measured above.
- **Sorting items by position first** (Motion ≤ 13.0). Considered; the geometric neighbour was chosen.
- **A static `axis` only**, or a reactive one without detection. Rejected (decision 5): rows and grids wouldn't work without configuration.
- **Raising only while "dragging"** (the flight back can pass under a later sibling), or **raising every dragged `layout` node** (changes stacking beyond Reorder). Rejected (decision 10).
- **A frame-driven auto-scroll** (the same speed at every refresh rate). Considered (decision 16); Motion's per-update steps were kept.
- **A dedicated release spring now** (Motion's feel without velocity), or **the velocity grill now**. Deferred (decision 12).

## Consequences

- **New surface:**
  - core `makeReorderGroup` and its pure helpers (`checkReorder`, `detectAxis`, the 100 ms direction, the auto-scroll math), Tier 2;
  - `@wardic/dom`'s `makeReorderController` and `REORDER_GROUP_STYLE`, Tier 2, and the engine's internal pass-end listener (not exported);
  - `@wardic/solid`'s `createReorderGroup` / `createReorderItem` / `reorderItem`, and `Reorder` (`{ Group, Item }`) with the named `ReorderGroup` / `ReorderItem`;
  - the handle's three getters and the raise option (ADR-0016);
  - core's `DragSample` gains a required `timeStamp` (the triggering event's; a scroll-driven move carries the scroll event's). A hand-built sample must carry one.
- **The group's own cost:** per drag sample, it reads n handles and runs the Crossover (a single axis is constant time after a `findIndex`; `"xy"` is O(n)). At each drag start it runs `detectAxis` over pairs, stopping once both axes are found (≤ 4,950 comparisons at 100 items; Motion runs it on every item's every measurement). Auto-scroll finds its scroller once per gesture, then reads a container scroller's rect on every drag update (the page needs none), as Motion's does (`auto-scroll.ts:64-69`). After each Measure pass, one `detectAxis` (none while the app sets the axis). Nothing at rest. *(Benchmarks, 2026-09-30, medians: a drag sample costs the group 0.3–0.7 µs on a single axis at 10–100 items and 2.2 µs in `"xy"` at 100 items; `detectAxis`'s worst case, 100 items in one column, is 6.9 µs; bun, `.tmp/reorder/bench-group.ts`.)*
- **Deferred:**
  - #30 (a grab mid-flight jumps to the slot plus the pointer offset: 8–11 px off for a settling item, 34–38 px for a displaced sibling, where Motion slides) and the release velocity, together as the velocity grill;
  - #28's nested-child case;
  - #41, #42, #43;
  - #32 (one frame behind the pointer with a browser's scheduler) and #29 (the design stays compatible with Motion's `setDragLock`) are out of scope.
- **Pinned by:**
  - core: `check-reorder.test.ts` (CR1–CR11, Motion's own five cases among them), `trailing-velocity.test.ts`, `auto-scroll.test.ts` and `reorder-group.test.ts`;
  - `@wardic/dom`: `reorder-controller.browser.test.ts` (RC1–RC8) and `projection-pass-end.browser.test.ts` (PE1–PE5);
  - `packages/solid/test/reorder.browser.test.tsx` (RO1–RO21), `reorder-headless.browser.test.tsx` (RH1–RH10) and `reorder-engine.browser.test.tsx` (RE1–RE10: through a resize, a scroll, Auto-scroll, touch and text selection), with Playwright's real mouse and Chromium's DevTools touch;
  - the server-render test `packages/solid/test/reorder.ssr.test.tsx` (SS0–SS6);
  - the layout lab's scenario 14, with its checks in `lab/reorder-run.ts` (`test/reorder-run.test.ts`): headless, every layout on the page and in a scroll container, 48/48 clean in Chromium and in Firefox.

## Note (#171, 2026-10-14): the siblings land on Motion's 0.45 s tween

A layout animation now defaults to Motion's 0.45 s tween (ADR-0009 *Amendment (#171)*). Re-measured with a real mouse (`.tmp/171/reorder-timing.ts`, scenario 14): a displaced sibling lands exactly on its slot in 451 ms, against 751 ms on the old spring by the same measure (the 546 ms above settled by a looser one), and Motion's 433 ms plus its held frame. A release's Release offset stays a spring (ADR-0016, *Note (#171)*).

## Amendment (#257 item 3, 2026-10-23): `reorderEnd`, saving a new order

An app that saves a new order wants it shown at once, and put back if the save fails: Solid 2's optimistic writes inside an action (#257 item 3). `onReorder` doesn't fit a save. It's called at each Crossover while the user drags, so the order it carries is the one to show, not to keep. And a keyboard drop (ADR-0037) had no event at all.

**Grilled 2026-10-23:**
1. **An end-of-reorder hook on the group (Q1: A).**
   - Solid 2 gets an event, as a ward's are (ADR-0046): `list.next("reorderEnd")` / `list.each("reorderEnd")`.
   - Solid 1 gets a prop, as `onReorder` is: `onReorderEnd` on `Reorder.Group` and in `createReorderGroup`'s config.
   - Rejected: each item's `dragEnd` (no keyboard drop, wired per item); Wardic owning the save (`save: (order) => Promise`), where Solid 2 has optimistic writes for it.
2. **Only a user's reorder that changed the order (Q2: A):** a pointer drag released, or a keyboard lift dropped (by key, by a press, by focus leaving, or by the app changing `values`), with the item at another index than at the gesture's start.
   - A drag dropped back where it began tells none.
   - Nor does a keyboard cancel, which puts the order back, nor `list.move`, which is the app's own code.
   - Rejected: every gesture's end with a `changed` flag; A plus `move`.
3. **`{ values, value, from, to }` (Q3: A):** the final order, the item the user moved, and its index at the start and at the end. That fits a whole-order endpoint and a moved-item endpoint alike. Rejected: `{ values, previous }`; `values` alone.
4. **`Reorder.Group`'s `groupRef` on Solid 2 (Q4: A)** hands the group over once, as it's made, as `wardRef` hands over a ward. Rejected: an `onReorderEnd` callback prop on Solid 2's component; both.

**Probed first** (Solid 2 rc.15, in the browser), with Solid's docs (`createOptimistic`, `createOptimisticStore`, the *Mutations* guide, `createSignal`'s writable memo):
- **The drag can't write an optimistic store.** An optimistic write lives in an action's transaction: one made outside any action "is discarded at the end of the current update" (the docs' pitfall), and the probe's store showed its source again at once. `onReorder` runs at each crossover, outside any action.
- **The save can write one.** In the guide's shape, `createOptimisticStore(() => api.listTasks(), [])` is the durable order. A save action makes the optimistic write, `yield`s the request, and calls `refresh(tasks)`. A rejection drops the overlay when the action settles, with no rollback code.
- **The drag writes a writable memo of the store,** `createSignal(() => [...tasks])`. It follows the store (its load, the save's optimistic write, the overlay dropped, the refresh), and each `onReorder` write overrides it until the next change. A failed save takes it back to the server's order, and the item glides back to its slot.
- **No loop, no callback:**
  - A memo over `list.each("reorderEnd")` holds the latest reorder as an async value. Solid consumes the iterable and owns its lifetime, and the pending memo doesn't hold the first render.
  - An effect saves each one. Its compute reads the ids (a tracked scope: Solid's strict mode warns of store reads in an apply), and its apply calls the action, which is allowed there.
  - Two drops in quick succession each save.
- **The failure goes in state.**
  - The docs' "an error the action does not catch … still reaches `Errored`" doesn't hold for an action an effect starts: with no catch, the probe's failure was an unhandled rejection, and its `<Errored>` never showed.
  - So the pattern keeps it in state the page renders (`save(ids).catch(setSaveError)`), as the guide's *Layer state by lifetime* keeps its errors.
- **Two earlier answers were wrong.** A first answer in the grill held that optimistic updates couldn't handle a reorder: they handle the save. A first draft of this PR rolled back by hand in a `catch`.
- **The documented pattern** is in the README and the group's `each` doc. RE5 runs it as written.

**Built:**
- **`@wardic/dom`'s `ReorderController`** takes `onReorderEnd`, exported as `ReorderController.End<V>`.
  - An item's index in `values` is recorded at a drag's start and at a lift.
  - It's compared at the drag's end and at the lift's drop, and told when they differ.
  - An item disposed mid-gesture, or unmounted while lifted, tells none.
- **Solid 1** passes `onReorderEnd` through the group's config and `Reorder.Group`'s props.
- **Solid 2:**
  - The group keeps a `Waiters` of its events, disposed with it. `next` rejects with an `AbortError`, and `each` ends.
  - On a server, `next` never settles and `each` ends at once, the helpers moved to `waiters.ts` and shared with the ward's.
  - `Reorder.Group` takes `groupRef`.

**Pinned by:**
- **Solid 2,** `v2/reorder-end.browser.test.tsx` RE1–RE6, RE1–RE4 through both `groupRef` and `reorderGroup`:
  - a drag's one end;
  - a drag dropped back;
  - keyboard drop, cancel and drop in place;
  - `move`;
  - the README's save pattern as written, against an async fake server: a failed save puts the order back, the item gliding between its slots, and shows its failure from state, with no unhandled rejection; a successful one keeps the order, reconciled, and clears the failure;
  - disposal.
- **Solid 2,** `v2/reorder.ssr.test.tsx` RS6: the server's.
- **Solid 1:** `reorder.browser.test.tsx` RO22–RO23 and `reorder-keyboard.browser.test.tsx` KB13.

**Mutation-checked:** eleven single-point mutations, all caught:
- a drag's or a drop's end never told;
- told when unmoved;
- a drag's or a lift's start index lost;
- Solid 2's events never told, `groupRef` never called, or its disposal leaving them;
- the server's `each` never ending;
- Solid 1's prop or config never wired.

## Amendment (#348, 2026-10-24): a hold, from its start to its end

A group told a reorder's end, but not when an item was taken in hand, nor a hold that ended with nothing changed. A pointer drag had its item's `dragStart` and `dragEnd`; a **Keyboard reorder**'s lift told nothing. The storefront's shared wishlist (#296) keeps the piece in your hand where you put it while other visitors' moves arrive. It could do that for a drag, but not for a lift. CONTEXT.md names it: a **Hold**.

**Grilled 2026-10-24, all recommended options:**
1. **On the group (Q1),** beside `reorderEnd`. One pair for any item, pointer or keys, built once in `@wardic/dom`'s `ReorderController` (`onHoldStart`, `onHoldEnd`).
   - Solid 2: `list.next` / `list.each("holdStart" | "holdEnd")`.
   - Solid 1: `onHoldStart` / `onHoldEnd` on `Reorder.Group` and in `createReorderGroup`'s config.
   - Rejected: the items' wards, wired per item; both.
2. **A pointer hold starts at the drag's start (Q2),** past its threshold, with its Drag claim: the item's `dragStart`, Motion's `onDragStart`. A press that never drags is no hold, nor is a drag a parent claims. A keyboard hold starts at the lift.
   - Rejected: the press, which makes every click a hold.
3. **Every hold ends exactly once (Q3),** whatever ends it:
   - a release, moved or not;
   - a pointer cancel or a lost release;
   - a keyboard drop (key, focus leaving, a press, the app changing `values`, lifting another);
   - Escape;
   - the item unmounting mid-hold.

   The group's own disposal ends `each` as before, with no end. Rejected: a user's ends only, which leaves an app's held state set after an unmount.
4. **Payloads (Q4):**
   - start: `{ value, from }`;
   - end: `{ values, value, from, to, how }`, `reorderEnd`'s fields plus `how`:
     - `"drop"`: any release or drop, a pointer cancel included;
     - `"cancel"`: Escape, the order put back;
     - `"unmount"`, with `to` `-1` once the item is out of the values.

   Rejected: the input (`"pointer" | "keyboard"`) too; the value alone.
5. **`reorderEnd`, then `holdEnd` (Q5),** in one task, when the order changed. An app that saves on the first and clears its held state on the second never shows the old order between them.
6. **`holdStart` / `holdEnd` (Q6).** Rejected:
   - `reorderStart` / `reorderStop`: Stop and End read alike;
   - `grab` / `release`: pointer words, and a release is already a drag's.
7. **One at a time (Q7),** as core's single gesture slot already is.
   - A hold's start ends the open one first: a lift is dropped where it is (its `reorderEnd` if it moved, then its end), and another item's drag ends as if released.
   - That drag's later release tells nothing more.
   - Keys during a drag were already left alone, so only a drag after a lift meets this, and only when its press didn't move focus (focus leaving had dropped the lift).

**Built:**
- `@wardic/dom`'s controller keeps the open hold, its item, its input and its start index. It tells the start at a drag's start sample and at a lift.
- It tells the end in each of a lift's ends: `dropLifted`, Escape, an unmount. For a drag, at its end sample or its unmount; a drag a later hold took over tells nothing more.
- The types are `ReorderController.HoldStart<V>`, `HoldEnd<V>` and `HoldHow`.
- Solid 1 passes the two props through; Solid 2 tells them on the group's `Waiters`, as `reorderEnd`.

**Found on the way: a lift dropped by its own values.** A lift ends when the app changes `values` (ADR-0037), told by the binding re-reading them: Solid 1's `on(() => values)`, Solid 2's effect. Both re-read when anything the values are made of changes, even if the array comes out the same. The controller counted any array but the last one it handed out (`asked`) as the app's, and a lift with no move yet had handed none out. So the first harmless re-read dropped it. The storefront's wishlist re-reads them at each hold's start, and its keyboard reorder stopped working. Now the values a lift begins with count as the group's own.

**Pinned by** `reorder-hold.browser.test.tsx` (Solid 1, HO1–HO11) and `v2/reorder-hold.browser.test.tsx` (Solid 2, HD1–HD11), with the real mouse and keys:
- a drag's start at the drag, not the press, then `reorderEnd` and its end;
- a click is no hold; a drag dropped back ends with no `reorderEnd`;
- a lift dropped elsewhere; Escape as a `cancel`; focus leaving;
- a drag after a lift whose press moved no focus ends the lift first, each hold ending once;
- the dragged item unmounting, its release telling nothing more; another item unmounting, leaving the hold be; an item unmounting after its hold ended, telling nothing more;
- a lift outlives a re-read of the values that changes nothing (HO11, HD11, which fail before the fix above).

On the controller before this change, all but "a click is no hold" fail in both. Mutation-checked: 11 single-point mutations of the controller (`.tmp/348/mutate.py`); 10 fail the tests meant for them. The one that survives drops the guard on a drag another hold took over. That needs two drags at once, which the Drag claim refuses on a group's axis (ADR-0019, *Amendment (#29)*), unless the items take none (`dragPropagation`).

## Note (#349, 2026-10-24): a group and its items, made outside the components

On Solid 2, `Reorder.Group`'s `groupRef` takes a group made with `reorderGroup()` as well as a function, and `Reorder.Item`'s `wardRef` takes an item made with `reorderItem(list, …)`. The components then render them. Their config props go beside them, laid over their config, and a key set in both places is an error (ADR-0046, *Amendment (#398)*). A plain ward, or another group's item, is an error, and a plain ward is a type error too (`reorderItem` returns a `ReorderItem<V>`). `reorderItem(list, config, { parent })` takes a variant parent, as `ward()` does. The decisions are ADR-0046's, *Amendment (#349)*.

## Amendment (#618, 2026-11-05): the controller hears each Measure pass through a service

The controller found the engine's pass-end listeners in a WeakMap keyed by the engine object. A binding that wrapped or replaced the `ProjectionSystem` in the controller's context got a silent no-op: no axis re-detected, no scroll into view after a keyboard step.

**Decision (2026-11-05, #618 decision 12):** the engine's pass ends are a `@wardic/dom`-internal service, `PassEnds` (`internal/pass-ends.ts`), which `DomProjectionSystem.make` and `layer` provide beside the engine, and `ReorderController.make` requires. Its tag isn't exported, so decision 2's reason holds: there's still no public push hook. The WeakMap goes. Rejected: keeping the WeakMap and documenting the wrapper case.

**Tests:** DS8 (`services.browser.test.ts`), a controller over a wrapped `ProjectionSystem` detects the row, and a type check that `make` takes `PassEnds` from its context.

## Amendment (#710, 2026-11-11): `detectAxis` in linear time

With no `axis`, a group runs `detectAxis` at each drag's start, each keyboard lift and the end of every Measure pass, which a drag runs at each crossover. Ported from Motion's, it built every unordered pair of boxes before checking any: 12.5 million at 5,000 items, every one of them checked in a column, where no two boxes are apart across. A 5,000-row list stalled for up to 1.8 s at a crossover.

- **Each box is compared with the one that ends first,** which is enough: if `a` ends at or before `b` starts, so does that box, unless it's `b`, and then `a` is apart from it. One pass finds it, among the boxes whose end is a number, and one more compares; nothing is made per pair.
- **The answers are Motion's** for every list: CR12 holds them to Motion's own loop over every pair, `NaN` and infinite coordinates included.
- **The docs** say what `axis` takes: `"y"`, `"x"` or `"xy"`, found from the items' boxes when it's left out, as Motion's is. They called `"y"` the default.

## Amendment (#712, 2026-11-11): a Batch Reorder group's items are Batch members

"The items are ordinary `layout` + `drag` elements" holds for `Reorder.Group`. `Reorder.BatchGroup` (ADR-0072) reorders a long list of like items as one keyed Batch: its items are Batch members, each at the place its index gives, so their boxes are computed, never measured.

- **Core's group is the same,** fed an `ItemSource` whose `layoutBox` is the item's place, and whose `layoutVersion` rises once the Batch has placed a new order: the guard after a reorder waits for that, not for a Measure pass.
- **The DOM controller takes a structural item handle:** a source and how to raise its item. A projection handle is one, and so is a Batch member's.
- **What tells the controller its boxes are fresh** is the Measure pass's end for `Reorder.Group`, and the Batch's placing for a `BatchGroup`; a stepped item is revealed from its place there.

## Amendment (2026-11-12): a single axis's Crossover keeps up with the item

A row dragged past its scroller's edge, held while Auto-scroll ran, then brought back and let go, flew back up the list: on the Reorder guide's 1,000-row `Reorder.BatchGroup`, held 30 px past the edge for 1.5 s and let go over Row 335's place, it landed at index 260, 2,400 px out of view.

- **Why:** the single-axis rule moved the item one place a drag sample, and the guard then waits for the new order's boxes. Auto-scroll's step, 25 px × (1 − distance/50)², grows past the edge, where the distance is negative: 64 px a drag update at 30 px out, 121 at 60. With two updates a frame, Chromium scrolled 128 px a frame over 42 px rows and the order moved two places, falling a row behind every 1.6 frames. A release ends no check, so the item went to the trailing index. `"xy"` already moves an item several places when it changes rows, so the guide's grid kept up.
- **Decision:** on a single axis, past the first neighbour, the item goes on past each further item on that side whose centre its edge has passed. That's where one-place moves would take it over enough samples, each over the order laid out again: the items past the ones it passes keep their places, so each next comparison is against a centre that hasn't moved, and the item's edge is where the drag holds it whatever its slot. Only the lag goes; where an item lands with time to catch up doesn't change, and neither does a sample that crosses one centre. The search runs from the dragged index with `Arr.findFirstIndex` or `findLastIndex`, no copy: O(n), as the `indexOf` before it already is.
- **Rejected:** capping Auto-scroll at 25 px an update. It slows the scroll Motion's users know, and any item smaller than an update's step still trails.
- **Tests:** CR14 (past three centres in one sample, down, up, and in a `column-reverse` column), CR15 (400 seeded columns of mixed sizes against one-place checks over the order laid out again each time), and BG10 (`Reorder.BatchGroup`, 400 items, held 60 px past its scroller's edge, brought back and let go: its place keeps up and it lands under the pointer). All three fail before this change; BG10 had it at 221 while it was held over 276.
