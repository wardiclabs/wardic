# Keyboard reorder

`<Reorder>` was pointer-only: an item moved only by dragging it. #43 adds a **Keyboard reorder** built into every Reorder group, on by default. Focus an item, press Space or Enter to lift it, use the arrows to move it one place per press (Home and End to the ends), then Space or Enter to drop it or Escape to cancel. Each step animates as a drag's reorder does, and each is an **Announcement** to assistive technology, which core words and the Environment delivers.

## Why

- **WCAG 2.2 SC 2.1.1 Keyboard (Level A).** All functionality must be operable through a keyboard. Dragging to a place whose path doesn't matter isn't exempt, so a reorder needs a keyboard way.
- **SC 2.5.7 Dragging Movements (Level AA).** It needs a single-pointer way without dragging. The Understanding page's own example is move-up and move-down controls. ADR-0020 already ships `move(value, toIndex)` for an app's visible controls; this decision makes it announce.
- **Motion has neither.** Nothing under `packages/framer-motion/src/components/Reorder/` handles a key or sets `aria-*` (`16c6122`). This is Wardic's own design. ADR-0020's decision D13 deferred it to #43.

Two current patterns were weighed (2026-10-15):
- **[dnd-kit's keyboard sensor](https://dndkit.com/legacy/api-documentation/sensors/keyboard)** (and react-beautiful-dnd's): Space or Enter starts and ends, Escape cancels, the arrows move, a live region announces, and hidden instructions describe the keys.
- **[Atlassian's Pragmatic drag and drop guidelines](https://atlassian.design/components/pragmatic-drag-and-drop/accessibility-guidelines/):** "we recommend not leveraging directional controls (arrow keys)", partly because JAWS users switch modes for arrows to reach a page. Each item gets a button opening a menu of outcomes, focus returns to the trigger, and announcements give the old and new position.

## Decisions (grilled 2026-10-15, all A)

1. **A built-in keyboard reorder with announcements** (Q1). It's the keyboard counterpart of the drag `<Reorder>` already has, in the idiom drag-library users know, and it covers 2.1.1 with no app work. `move()` stays the base for an app's visible controls (2.5.7) and announces too (Q12).
   - Rejected:
     - headless building blocks only (Atlassian's way): a plain `<Reorder>` would stay keyboard-inaccessible until the app built controls;
     - a built-in move menu: Wardic would render UI an app has to style.
   - JAWS's browse mode is the known risk. The announcements and instructions carry it, and the NVDA pass by hand checks it.
2. **Every item is a tab stop** (Q2): `tabindex="0"` unless the app gives its own `tabIndex`, which wins. A key acts only when the item itself has focus, not a field or button inside it.
   - Rejected: a roving tabindex (the arrows would mean two things), and nothing focusable (it undoes Q1).
3. **Space or Enter lifts and drops, Escape cancels** (Q3). A key the page already took (its handler called `preventDefault`) is left alone, so an item that opens on Enter keeps that. The keys aren't configurable for now.
4. **The arrows move by what's on screen, one place per press** (Q4).
   - **A single axis:** only that axis's arrows act. The item takes the place of the neighbour, of the two next to it in the order, whose centre lies the way the arrow points: the **Crossover**'s rule by position. An rtl row, `row-reverse` and `column-reverse` therefore move the way the arrow points.
   - **A grid:** Left and Right step in reading order (flipped in rtl), which wraps across rows. Up and Down take the place of the item in the row above or below whose centre is nearest.
   - **Ends and repeats:** Home and End go to the first and last place. A held arrow repeats, one place per repeat, and its announcements are thinned to the last (spoken once the repeats stop for 150 ms).
   - **A step waits for the Measure pass the last one asked for.** After a step, `values` holds the new order while the boxes are the old one's, so a step read against them could go back. A drag's next reorder waits for the same reason (ADR-0020's guard).
5. **A lifted item looks like a dragged one** (Q5). `whileDrag` applies from the lift to the drop or cancel. The engine raises it (`2`) from the lift, through each step's layout animation, and keeps `1` after the drop until its last one lands, as a drag's release does (`ProjectionNodeHandle.lift`). The lift doesn't take `x`/`y` from the spring, as a drag does; only `whileDrag` turns on.
6. **English defaults, overridable on the group** (Q6). The defaults name the item and its place: "Picked up Milk, position 2 of 6.", "Milk, position 3 of 6.", "Dropped Milk at position 3 of 6.", "Cancelled. Milk is back at position 2 of 6." and, for `move()`, "Moved Milk to position 1 of 6.". The item is spoken as its `aria-label`, else its text with its whitespace collapsed. The group's `announcements` replaces any of them with a function of `{ value, label, position, count }`, and its `instructions` replaces the instructions text.
7. **One live region per document** (Q7). It's visually hidden, `aria-live="assertive"` and `aria-atomic`, and shared by every group. A Reorder group adds it when its element attaches, before the first lift: a screen reader watches a region from when it's in the page. Each announcement replaces the last, and a repeat of the last gets a trailing no-break space, so it changes and is spoken again.
   - Rejected: polite (quick moves queue and lag behind the item), and a region per group (the group would wrap its list in another element).
8. **Items keep their role; instructions through `aria-describedby`** (Q8). An `li` stays a list item. Each item points `aria-describedby` at a hidden instructions element, one per distinct text per document, after the app's own ids. The lifted state has no ARIA attribute: the announcements carry it, and `whileDrag` styles it. On a server an item renders its `tabindex`; `aria-describedby` comes on the client, when the instructions element exists.
   - Rejected: `aria-roledescription` (it replaces "list item" in some readers, and is ignored on an item rendered `as="div"`); `role="button"` with `aria-pressed`, dnd-kit's (a list of buttons loses "2 of 6", and an item's own controls would nest).
9. **An interruption drops the item where it is** (Q9). Focus leaving the item drops it; a step can blur the node it moves, so focus is put back first, and a blur with focus back on the item isn't one. A press on the item drops it too (any drag goes on as usual), and so does the app changing `values` (at its new place). An unmount ends the lift unsaid. Only Escape restores the order from the lift. An arrow at an end re-announces the place, and keys during a pointer drag are left alone.
10. **Core recognizes and decides; the Environment announces** (Q10, ADR-0004, ADR-0035, ADR-0036).
    - **Recognition.** `InputSource.keyboard(target)` replaces the page-wide `keyboard()`, whose only user was its own test. Its events carry `fromTarget`, `defaultPrevented` and `preventDefault()`. The DOM's listens on the target's window, in the bubble phase, so it runs after the page's handlers (the element's, and Solid's delegated ones on the document). Each event is offered and its queue flushed, so a consumer handles it inside the dispatch, where its `preventDefault()` still counts (ADR-0032).
    - **Decision.** Core's `Reorder` gains the pure model: `keyIntent`, `arrowTarget`, and `lift`, `step`, `drop` and `cancel` on the group, each returning the item's `Placement`, plus the wording (`defaultAnnouncements`, `DEFAULT_INSTRUCTIONS`). `Reorder.move` now returns its placement too.
    - **Delivery.** A core contract, `Announcer.Announcer` (`announce(message)`), with a silent Layer for headless Environments. `@wardic/dom`'s `AnnouncerDomLive` is the live region, and `DomLive` provides it.
    - **The response.** `@wardic/dom`'s Reorder controller runs the keys, the announcements, the reveal and the interruptions. Solid adds `tabindex` and `aria-describedby`, feeds each item's keys, blurs and presses to the controller, and sets the spine's `lifted` so `whileDrag` applies.
    - Rejected: plain DOM listeners in the controller (a non-DOM Environment couldn't reuse the logic), and the logic in the Solid binding.
11. **`keyboard: false` on the group turns it off** (Q11): no keys, no tab stop, no instructions. `move()` still announces.
12. **The keyboard reorder and `move()` announce; pointer drags don't** (Q12). A pointer drag is seen by the person making it, and announcing each Crossover would be noise.
13. **Each keyboard move scrolls the item's new place into view** (Q13): as little as needed, instantly, in each scroller that moves it and then the page. Its new place, not where it's drawn: a step's layout animation starts it where it was, so the box is the element's painted one with its own translate and scale undone. It's done after the Measure pass that lays the new order out.
14. **Checked at every tier, in the lab, and with NVDA by hand** (Q14).
15. **This ADR** (Q15), with pointers from ADR-0020 (D13), ADR-0019 and ADR-0004.

Two defaults stated, not asked: the axis and direction are fixed for a lift, as for a drag gesture (ADR-0020); and SSR renders `tabindex` but not `aria-describedby` (decision 8).

## Consequences

- **New public API:**
  - `Reorder.Group`'s `keyboard`, `announcements` and `instructions`;
  - the `ReorderItemSpread`, `ReorderItemUserProps` and `ReorderItemWard` types (`createReorderItem` now returns a `ReorderItemWard`, which takes the app's `tabIndex` and `aria-describedby`);
  - core's `Announcer` module and the keyboard part of `Reorder`;
  - `@wardic/dom`'s `AnnouncerDomLive`, `announceIn`, `prepareAnnouncer`, `instructionsId` and `documentOf`;
  - `ProjectionNodeHandle.lift`.
- **Breaking changes** (allowed before 1.0):
  - `InputSource.keyboard()` takes a target, and its events carry three more fields;
  - `WardicServices` includes `Announcer.Announcer`, so a hand-built Environment provides it (`Announcer.silent`, or `AnnouncerDomLive`);
  - `Reorder.move` returns a placement.
- **Every Reorder item is now a tab stop by default.** An app whose items hold their own focusable controls gets one more tab stop per item, or turns the keyboard reorder off.
- **The lab's scenario 14** records each lift as a keyboard run, read from the live region as a screen reader hears it, and judges it on the Reorder lines, plus `announced` (the lift first, the drop or cancel last, focus kept).
- **Not covered:** a grid in `row-reverse`, whose Left and Right still follow reading order, and configurable keys. A screen reader can't run in CI, so the NVDA pass is by hand.

## Pinned by

- **Core:** `test/reorder-keyboard.test.ts` KR1–KR9:
  - the keys;
  - steps, places and the guard;
  - ends, Home and End;
  - a reversed column and an rtl row;
  - a grid;
  - a cancel;
  - the axis fixed at the lift;
  - the wording.
- **dom:**
  - `test/input.browser.test.ts`: `keyboard(target)` (the target and inside it, after the page's handlers, inside the dispatch);
  - `test/announcer.browser.test.ts` AN1–AN4;
  - `test/projection-handle.browser.test.ts` PH11 (the lift's raise).
- **Solid:**
  - `test/reorder-keyboard.browser.test.tsx` KB1–KB10, with real keys:
    - lift, step and drop, with focus, the raise and `whileDrag`;
    - Escape and Enter;
    - no page scroll;
    - the app's keys and a field's;
    - the interruptions;
    - `keyboard={false}` and `move()`;
    - the ARIA and the overrides;
    - a held arrow's thinning;
    - the reveal in a scroll container;
    - keys during a pointer drag;
  - `test/reorder.ssr.test.tsx` SS7 (the server's `tabindex`).
- **Lab:** `test/reorder-run.test.ts` KR1–KR4.
