# `<Reorder>`: drag to reorder, headless first, on the projection engine

`<Reorder>` lets a user drag the items of a list or grid into a new order (#44). It's built in three layers:

- **Core** (`@wardic/core`): `makeReorderGroup`, which has no framework in it. It decides when a dragged item has passed a neighbour (the **Crossover**) and what the new order is.
- **`@wardic/solid`**: `createReorderGroup`, `createReorderItem` and `reorderItem` bind it to elements.
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
  - `move(value, toIndex)` on the group reorders through `onReorder`, so an app can add buttons or keys (WCAG 2.2 SC 2.5.7; built-in keyboard reordering is #43).
- **Each item's box reaches the group by pull (decision 2).**
  - The projection handle gains `layoutBox()`, `dragOffset()` and `layoutVersion()` (ADR-0016, *Amendment (Reorder)*). The group reads them on each drag sample.
  - After a reorder it makes no further reorder until the dragged item's `layoutVersion()` has moved, i.e. until a Measure pass has measured the new order. That's Motion's `isReordering` guard, which 13.4.6 clears only when `values` changes.
  - There is no push callback: Motion's `onLayoutMeasure` is undocumented ("Internal", its changelog 2.4.0). A public one later would add one.
- **The Crossover is Motion's rule (decision 3), with two changes (decisions 3 and 4).**
  - The rule, ported with its unit tests:
    - on a single axis, the item swaps with the next neighbour once its leading edge passes that neighbour's centre;
    - in `"xy"`, the item's centre picks a line and the nearest box in it ([check-reorder.ts](https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/framer-motion/src/components/Reorder/utils/check-reorder.ts)).
  - **The direction comes from a 100 ms window.** Motion's single-axis rule does nothing at zero velocity. Core `drag`'s 30 ms window reads zero whenever two moves are more than 30 ms apart: 11–26% of headless mouse moves, and 17 of 18 touch moves. So a slow, careful drag would never reorder. The group computes the direction with Motion's `getVelocity` (`PanSession.ts:383-440`), ported to core, over the gesture's points. `drag` itself is unchanged, so no Fling changes.
  - **The neighbour is chosen by position, not by index.** Motion's single-axis rule takes `order[index ± 1]`, which is only the neighbour on the moving side when the list runs in reading order.
    - In an `rtl` row, `row-reverse` or `column-reverse`, it never reorders toward a neighbour (4/4 runs each, both browsers, 13.4.6). A drag the other way walks the item to the far end (`acbde → acdbe → acdeb`).
    - Motion ≤ 13.0 sorted items by position first and was correct; 13.1.0 dropped the sort while announcing "RTL support".
    - Here the neighbour is whichever of `index ± 1` has its centre on the side of the motion, crossed by the edge facing it. In reading order that's the same neighbour and the same test, so Motion's single-axis tests pass unchanged. A value order shuffled against position (CSS `order`) isn't covered.
    - `"xy"` keeps Motion's rule and its `direction`, read once per drag start (Motion reads it on every update).
- **The axis is detected (decision 5).**
  - `axis` is optional. Without it the group runs Motion's `detectAxis` on the items' boxes at each drag's start: `"x"`, `"y"`, or `"xy"` when they are separated on both axes. An `axis` prop overrides that, and can change at runtime (Motion #3022).
  - The axis is fixed for the whole gesture. The item's drag reads it at the gesture's start, and the public `drag` prop stays static.
  - `touch-action` has to be right before a touch starts, so the group also resolves the axis after the first Measure pass after mount, after each reorder, and after a resize. Items take Motion's mapping: `pan-x` for `"y"`, `pan-y` for `"x"`, `none` for `"xy"`.
- **The dragged item is raised until it lands (decision 10).** `Reorder.Item` opts its node in, and the engine then writes `z-index: 1` with the node's projection from the drag's start until its release settles (ADR-0016, *Amendment (Reorder)*). Motion raises while its drag offset is non-zero (`Item.tsx:83-85`). Unlike Motion, a user's own `z-index` shows at rest.
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
  - A server-render test pins it with a server-safe environment until `DomLive` builds on a server (#41).
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
  - `@wardic/solid`'s `createReorderGroup` / `createReorderItem` / `reorderItem`, and `Reorder` (`{ Group, Item }`) with the named `ReorderGroup` / `ReorderItem`;
  - the handle's three getters and the raise option (ADR-0016);
  - core's `DragSample` gains a required `timeStamp` (the triggering event's; a scroll-driven move carries the scroll event's). A hand-built sample must carry one.
- **The group's own cost:** per drag sample, it reads n handles and runs the Crossover (a single axis is constant time after a `findIndex`; `"xy"` is O(n)). At each drag start it runs `detectAxis` over pairs, stopping once both axes are found (≤ 4,950 comparisons at 100 items; Motion runs it on every item's every measurement). Auto-scroll adds one rect read per update while in an edge zone. Nothing at rest. *(Benchmarks, 2026-09-30, medians: a drag sample costs the group 0.3–0.7 µs on a single axis at 10–100 items and 2.2 µs in `"xy"` at 100 items; `detectAxis`'s worst case, 100 items in one column, is 6.9 µs; bun, `.tmp/reorder/bench-group.ts`.)*
- **Deferred:**
  - #30 (a grab mid-flight jumps to the slot plus the pointer offset: 8–11 px off for a settling item, 34–38 px for a displaced sibling, where Motion slides) and the release velocity, together as the velocity grill;
  - #28's nested-child case;
  - #41, #42, #43;
  - #32 (one frame behind the pointer with a browser's scheduler) and #29 (the design stays compatible with Motion's `setDragLock`) are out of scope.
- **Pinned by:**
  - core: `check-reorder.test.ts` (CR1–CR11, Motion's own five cases among them), `trailing-velocity.test.ts`, `auto-scroll.test.ts` and `reorder-group.test.ts`;
  - `packages/solid/test/reorder.browser.test.tsx` (RO1–RO18), `reorder-headless.browser.test.tsx` (RH1–RH9) and `reorder-engine.browser.test.tsx` (RE1–RE9: through a resize, a scroll, Auto-scroll, touch and text selection), with Playwright's real mouse and Chromium's DevTools touch;
  - the server-render test `packages/solid/test/reorder.ssr.test.tsx` (SS0–SS6);
  - the layout lab's scenario 14, with its checks in `lab/reorder-run.ts` (`test/reorder-run.test.ts`): headless, every layout on the page and in a scroll container, 48/48 clean in Chromium and in Firefox.
