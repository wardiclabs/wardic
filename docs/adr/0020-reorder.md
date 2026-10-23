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
    - on a single axis, the item swaps with the next neighbour once its leading edge passes that neighbour's centre;
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
