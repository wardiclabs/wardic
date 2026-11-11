# A Batch Reorder group: `Reorder.BatchGroup`, a long list reordered as one keyed Batch

A `Reorder.Group` of thousands of like items costs a Wardic element per item (ADR-0020): each item has its own layout projection and drag, and every crossover waits for a Measure pass that measures every item's box. A Batch (ADR-0069, ADR-0070) places every member from its index with nothing to measure, so a reorder can be one Batch change.

#712's prototype (2026-11-11, the Solid 2 binding built for production, headless Chromium 147) measured it: one keyed Batch, one pointer listener on the list, the held item moved through the Batch, the crossover to the nearest place, and the keyboard model of ADR-0037 written again by hand.

| 5,000 items | `Reorder.Group` + `axis` | the Batch, one listener, keyboard |
|---|---|---|
| mount | 1,061 ms | 148 ms |
| a drag: longest frame / main thread per frame | 33 ms / 5.12 ms | 17 ms / 2.91 ms |
| keys: longest frame / main thread per frame | 17 ms / 4.57 ms | 17 ms / 3.03 ms |

At 1,000 items every way held 17 ms frames, and the Batch mounted in 51 to 58 ms against 320 to 440 ms. Keeping the DOM in the list's order cost about 0.45 ms a frame while dragging, outside script. The same prototype found #710.

## Decisions (grilled 2026-11-11, #712)

1. **Its own component pair:** `Reorder.BatchGroup` and `Reorder.BatchItem`, on both bindings (Q7, Q10). An item is typed as a **Batch member**, so a prop only a Wardic element takes (`layoutId`, `variants`, `drag`) is a type error, not a silent no-op. `Reorder.Group` is unchanged.
2. **`BatchGroup` takes `Reorder.Group`'s props and events** on each binding (Q11): `values` and `onReorder`; `onReorderEnd` and the hold callbacks on Solid 1; `keyboard`, `announcements`, `instructions`, `direction` and `as`. On Solid 2, `reorderGroup()` builds its controller over the projection system as it's made, so a `BatchGroup` can't take one: its `groupRef` is a callback handed the group, with `reorderGroup()`'s `next`, `each` and `when` of `reorderEnd`, `holdStart` and `holdEnd`, its `move` and its `axis` (Q25). No primitives like `createReorderGroup` or a `batchReorderGroup()` in the first version.
3. **Places, not boxes** (Q2, Q12, Q16). Every item is one size, and its place comes from its index:
   - `axis` picks the shape: `"y"`, a column, the default (there's nothing to detect from); `"x"`, a row; `"xy"`, a wrapping grid.
   - `itemSize={{ width, height }}`, `gap` (a number, or `{ x, y }`), and a grid's `columns`, a number, or, left out, as many as the group's width holds, measured once and again on a resize.
   - `direction="rtl"` mirrors a row's and a grid's places.
   - The word is *place*: **slot** is a Projection node's box.
   - Items of different sizes, each measured once, are #714.
4. **The group lays its items out** (Q13): it's `position: relative`, sized to its places, so a scroller around it scrolls; each item is `position: absolute` at its top-left, sized from `itemSize`, placed by its transform. The app styles the rest.
5. **The DOM follows the list's order** (Q3), always: Tab and a screen reader read the DOM. The app renders its items with `<For each={values}>`, as a `Reorder.Group`'s, so Solid moves one node a reorder (Q29); the group moves none itself, as the prototype's `insertBefore` did.
6. **Built on Reorder's layers** (Q5, Q6):
   - **Core's `Reorder.Group` as it is,** fed an `ItemSource` whose box is the item's place. The **Crossover** is Reorder's, Motion's, so both forms feel the same; a reorder waits for the Batch to place the new order, not for a Measure pass.
   - **The DOM controller without a projection system:** items register a plain handle (their source, and how to raise them), the Batch's placing stands in for the Measure pass, and a stepped item is revealed from its place.
   - **The keyboard, its announcements and their overrides, right-to-left, Auto-scroll and `reorderEnd`** are the code `Reorder.Group` runs.
7. **The drag** (Q14, Q17): the group hears a member's press through the delegated feed over its members (ADR-0055 *Amendment (#665)*), then core's drag recognizer runs for that one member: the threshold, samples and 100 ms velocity of a `Reorder.Item`'s. The item in hand follows the pointer through the Batch, its `x` and `y` set at each move with no spring, over its Override stack, and through Auto-scroll; no Wardic element and no `createAnimate` (Q26). Let go, it springs to its place at its release speed, which the Batch takes as its start speed, as #665's hand-back does. **Its keys, blurs and presses** come through the feeds over the members too (Q28): focus through `focusAmong`, the focused item's own keys from its focus to its blur, as a Batch's press holds them (#460), and presses through `pointerAmong`. No item listens at rest, and no `keyboardAmong` feed is added.
8. **The motion config is the group's** (Q22), as `createBatch`'s is: `initial`, `exit`, `transition`, `whileDrag`, `whileHover` and `whileTap`, each values or a function of the item and its index. `BatchItem` takes its `value`, `as` (an `li`, as `Reorder.Item`), `ref`, `style`, its element's attributes and children. The group animates `x` and `y` to each place; a gesture's keys join them (Q23). Each item starts at its place, `initial` giving only the keys it names.
   - **`whileDrag`** is a layer over `whileTap` in each member's Override stack (ADR-0070 decision 12): on as an item is taken in hand, by a drag or a keyboard lift, off at its drop, back on the Batch's transition (Q27).
   - **One keyed Batch over `values`,** keyed by the value itself, each its own, as `Reorder.Group` needs. Its geometry is read where its places are: a change of it places every item again in one change, on the group's transition (Q30).
9. **In the first version** (Q4): `whileDrag` as Batch keys, with the item in hand raised by `z-index` on its element; `whileHover` and `whileTap`; items coming and going under `<AnimatePresence>` with `exit`; the server's start (#707). Out: variants, a layout projection, and anything else only a Wardic element has.
10. **A member's keys** (Q8): with the keyboard reorder on, Space and Enter lift and drop it, as on `Reorder.Item`, and don't press it; a pointer's press still runs `whileTap` and the tap events. With `keyboard={false}`, the keys press as on any Batch member.
11. **Gated** (Q20): a `bench:solid` page pair, the Batch group against `Reorder.Group` at 1,000 and 5,000 items: mount at most 0.3× and a frame while dragging at most 0.75× of `Reorder.Group`'s.
12. **Shipped in 1.0.0** (Q1, Q9), in four stacked PRs (Q21): core's drag among members and the controller without a projection system; the components, with drag, keyboard, DOM order and `whileDrag`; hover and press, `exit`, the server's start, right-to-left and columns from the width; the docs, a sample and the bench pages.

## Considered Options

- **An option on `Reorder.Group`** (`batch={…}`), its `Reorder.Item`s becoming members (Q7 A). One prop to switch, but `Reorder.Item`'s props stay a Wardic element's, so a prop a member can't take is caught only at runtime.
- **A `reorder` option on `createBatch`'s keyed form** (Q7 B). It sits with the Batch, but the keyboard, announcements and Reorder's other props would get a second home.
- **A separate, smaller implementation**, as the prototype is (Q5 B): its own crossover, keyboard, live region and Auto-scroll. Faster to write, a second copy of all of it, and the overrides, right-to-left and reduced motion left out.
- **The nearest place as the crossover** (Q6), the prototype's: it agreed with Reorder's on the prototype's drags, and may differ on a diagonal one; one crossover for both forms won.
- **The app's own `place(i)`** (Q2 B): finding the place under the pointer would search them, or need the app's inverse too. **Items measured once** (Q2 C) is #714.

## Consequences

- **ADR-0020's "the items are ordinary `layout` + `drag` elements"** holds for `Reorder.Group`; a `BatchGroup`'s are Batch members (ADR-0020, *Amendment (#712)*).
- **ADR-0070 decision 12's "still none: drag, focus"** holds for a plain Batch; a `BatchGroup`'s members are dragged and focused through the group (ADR-0070, *Amendment (#712)*).
- **The DOM controller gains a second wiring:** its items' handles are structural (a projection handle is one), and what tells it the boxes are fresh is a Measure pass or the Batch's placing.
- **Uniform places are a limit:** a list of items of different sizes keeps `Reorder.Group` until #714.
