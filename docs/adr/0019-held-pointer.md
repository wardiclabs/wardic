# A held pointer stays with its gesture until its release

Once a pointer goes down on a target, its moves, release and cancel keep reaching that target's `InputSource.pointer` stream wherever they land, until it is released: a **Held pointer**. A drag follows it off the element, a release anywhere ends a drag or a press, and a gesture whose release is lost anyway ends at the owning pointer's next unpressed move, or at the next press anywhere by it or by a new primary pointer of its type. `drag` and `press` listen to the **Primary pointer** only. `hover` follows Motion: touch never hovers, no hover starts while a drag is active, and a leave while the pointer is held waits for its release. This fixes #31.

## Why

- **#31, measured with real input.** `packages/solid/test/drag-pointer.browser.test.tsx` drives Playwright's mouse (and Chromium's DevTools touch) through the browser's own input pipeline; a synthetic event dispatched on the element can't show a pointer leaving it. At `e57c54e`, in headless Chromium 147 and Firefox 148 alike:
  - A jump that took the pointer off the dragged element left the element at +12 px while the pointer went on to +240; the release there wasn't seen, so `whileDrag` stayed on. The same held for a `layout` drag and a free one.
  - An x-locked drag whose pointer drifted off the element's edge stopped at that edge, and the release outside never ended it; `press` stayed on too.
  - After that, moves with no button pressed dragged the element 70 px, and a second press didn't start a drag: its offsets were still measured from the first press. A free drag's track rebased on that press anyway, which threw the element 45 px out from under the pointer, so that release was lost as well.
  - A press whose pointer left the element and was released outside left `whileTap` on.
  - A right-button press dragged the element; a second finger landing on a dragged element rebased the drag, so the first finger's next 20 px threw it 40 px further; a second finger dragged the element while the first rested on the page.
- **#31 on a desktop.** In the layout lab (Chrome 153 on Windows, log `2026-09-29T16-07-41-550Z`, scenario 13), 4 of 26 flicks lost the pointer after one or two moves: the next move, 590–1,390 px/s, missed the item. Each lost release left the gesture on: hovering with no button pressed then dragged the item (it moved 19–55 px between presses), the next press was ignored, and a click ended it.
- **The cause.** The DOM input source listened on the element only (`packages/dom/src/input.ts:76-87` at `e57c54e`). Mouse input has no implicit pointer capture, so its moves go to whatever is under the pointer. Touch does: in Chromium, a touch that went down on the element kept delivering its moves out to x=300 (the element spans 40–160) and its release to the element, with `touch-action: none`; with `touch-action: auto` the browser took the touch for scrolling and cancelled it after the first move.
- **Motion keeps the pointer.** framer-motion 13.4.0 passed every case above in both browsers. Its `PanSession` listens on `window`, in the capture phase, for the rest of a gesture after its `pointerdown` ([PanSession.ts:150-175](https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/framer-motion/src/gestures/pan/PanSession.ts#L150-L175)), and `press` hears its release on `window` ([press/index.ts:118-123](https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/motion-dom/src/gestures/press/index.ts#L118-L123)).

## Decisions (grilled against Motion @ `16c6122`; runtime checks on framer-motion 13.4.0)

- **Window listeners after the down, not pointer capture (issue decision 1).** Motion's model (`PanSession.ts:150-175`, `press/index.ts:118-123`). `setPointerCapture` at the down redirects a click on a child `<button>` to the draggable in Chromium and Firefox, and allows one capturer per pointer, which nested draggables (#29) would fight over.
- **The Environment delivers it, inside `pointer(target)` (decision 2).** The target's own `pointerdown` listener adds the page-wide listeners before the down's dispatch returns. A core recognizer subscribing to a window stream after it sees the down would lose the first 8–16 ms (Chromium) or 16–32 ms (Firefox) of input under a browser's scheduler, and the test tier hides that gap. The `InputSource` type is unchanged. DOM touch already holds pointers this way.
- **Core's `heldPointerSource` implements the contract for any Environment (decision 6a).** An Environment supplies its target's events and, where its platform doesn't hold pointers itself, its page-wide ones. The helper owns the page-wide subscription, forwards each event once, and ends a held pointer at its release, its cancel, or a move with no button pressed.
- **Every pointer consumer gets it; `hover` takes Motion's three rules (decision 3).** Motion's rules: `hover.ts:26-28, 67-107`, pinned by `hover.test.tsx:216-345`. Without the deferred leave, a flick that outruns the dragged element flips its hover off and on (≥1,200 px/s one frame behind the pointer, ≥600 px/s two frames).
- **Drag activity (decision 3b).** One core `Context.Reference`, shared by default like Motion's `isDragging`, counts the active drags. `drag` claims it past its threshold and releases it at its end or when interrupted. While it is non-zero, no hover and no press starts.
- **A stale gesture ends as a cancel (decision 4).** This departs from Motion. After a lost release, Motion's drag follows the unpressed pointer anywhere, and every other hover and press stays dead until a click, which it eats. A second press compounds its two sessions. Wardic ends the gesture at the owning pointer's first move with `buttons === 0`, or its next down, at the last pressed point with no velocity.
- **Only the primary pointer counts (decision 5).** Motion's `isPrimaryPointer`, applied to `drag`, `press` and both grab streams. `PointerLikeEvent` gains required `pointerType`, `button` and `isPrimary`, and core ships a builder with mouse defaults. (In core's own words since #189: `kind`, `button` and `primary`, ADR-0036 *Amendment (#189)*.)
- **A press anywhere ends a held pointer whose release was lost (decision 7, from the review).** The owning pointer can't always end its own Stale gesture: a lifted finger sends no more moves and the next finger has a new pointer id, and a mouse pressed again elsewhere stays pressed (`buttons ≥ 1`; `pressed` since #189). So while a pointer is held, `heldPointerSource` also listens for page-wide downs: a down by the held pointer, or by a new primary pointer of its type, ends the hold with an unpressed move at its last position (rule A's signal), before the down reaches any element. Measured before it, in Chromium: after a touch drag's lost release, a tap on another element never pressed it, since the Drag activity stayed claimed until unmount, and a new touch drag on the element did nothing; after a mouse drag's lost release, a press on an element laid out under the still pointer was blocked, and the stale drag followed that element's whole drag. Motion ends its session at the next primary release anywhere (`PanSession.ts:150-175` filters no `pointerId`), which eats that press; this ends it one event earlier, and the press works.

The rest of the grill, for the record:

- **A drag rebases at its `"start"` sample, not at the grab.** The Solid drag track and `withMomentum` merge the drag's samples with bare pointer-downs ("grabs"), which interrupt a running release or fling. A grab used to rebase the next drag too. Rule B's `"end"` and the grab of the same down arrive through two subscriptions in no set order, and a grab that ran first rebased before the release, the 45 px throw above. The grab now only interrupts, and the `"start"` rebases to wherever the element rests.
- **A layout drag's restart starts from the slot until #30 lands.** Rule B ends the old gesture, so a `layout` node's release flight begins, and the new drag grabs mid-flight, which jumps to the slot plus the pointer offset (#30). The path needs a lost release and a new press on the element with no move in between.
- **A gesture's release can't be dropped by the grab of the same down.** The drag track's `switchMap` let a grab interrupt the old gesture's `"end"` inner before it ran, so after a lost release a click with no move left a `layout` node dragging off its slot and a free drag's `whileDrag` on (the lab's hand run R10). A gesture's start and end bookkeeping (`dragEnd`, handing `dragging` back) now runs as each sample passes, before the merge; a grab still interrupts a running free release, and with no gesture held it hands `x`/`y` back to the spring.
- **The helper returns a `Stream`**, built on one ordered callback, so an Environment's shared lookup is `Effect.succeed(heldPointerSource(...))`. `pointerType` is a `string`, so an Environment names its own input kinds.

## Considered Options

- **Pointer capture** (`setPointerCapture` at the down, at the drag's 3 px start, or with window listeners too). Rejected (decision 1). A raw-DOM probe (Chromium 147, Firefox 148, real mouse) showed capture at the down retargeting a click on a child `<button>` to the draggable in both browsers, and capture at 3 px retargeting the click after a drag. Capture does hold the element's `pointerleave` and `:hover` until the release, which is Motion's deferred hover end; the hover recognizer now does that itself.
- **A core recognizer reading a window-level `InputSource` accessor**, subscribed after the down. Rejected (decision 2): under a browser's own scheduler (each Effect scheduler batch is its own `setTimeout(0)`), it lost every page-wide move for the first 8–16 ms in Chromium and 16–32 ms in Firefox; the test tier's microtask scheduler lost only the down's own task, so tests would pass and pages fail. Kept subscribed for the recognizer's whole life, it cost about 6 µs per subscriber on every pointer move on the page in Chromium (0.5 ms at 50 recognizers, 1.2 ms at 200) and 1–3 ms in Firefox, with nothing pressed.
- **A separate `pointerSession(target)` accessor**, keeping `pointer(target)` for events over the target. Rejected (decision 2): every Environment would implement two pointer streams, an element would need two listener sets, and DOM touch already holds its pointers, so the plain stream would have to undo that. Adding it later on top of this contract stays additive.
- **Hover as it was, or with only the deferred leave.** Rejected (decision 3): a flick flips a dragged element's `whileHover` off and on, and every touch fires `pointerenter` before its down and `pointerleave` after its lift (Chromium), so a tap played `whileHover` for its length.
- **Drag activity as a module-level object** (Motion's shape), **a sixth Environment service**, or **a field of `InputSource`**. Rejected (decision 3b): the first can't be scoped per test or per surface; the other two make every Environment build it and widen the recognizers' types.
- **For decision 7: a primary down of the pointer's type ending the gesture in the recognizers**, which only helps a press on the same element (a tap elsewhere stays blocked, and the mouse case is unchanged); **Motion's next-release rule**, which eats the next press and, for a mouse, lets the stale drag follow it until the release; or **documenting it**, which leaves one swallowed touch release blocking every press on the page.
- **Neither stale-gesture rule** (Motion's behaviour), or **rule A alone**. Rejected (decision 4). Motion after a release swallowed by an earlier window listener: its drag followed the unpressed pointer 280 px onto another element, that element neither hovered nor pressed, the next click ended the drag and was eaten, and a second press with no move compounded the two sessions (+75 px where +70 was expected). Rule A alone leaves a lost release followed by a press with no move, where a free drag's rebase threw the element off the pointer.
- **The first down on the target owns the gesture**, with a left-button filter and per-owner release. Rejected (decision 5): it lets a second finger drag while the first rests on the page, which Motion ignores, and it works against #29's single-drag lock.

## Consequences

- **Behaviour changes.**
  - A right-click, a middle-click or a second finger no longer drags or presses.
  - Touch never plays `whileHover`.
  - `whileHover` stays on while a pressed pointer is off the element, until its release.
  - No hover and no press starts on another element while something is dragged, so a drop target can't use `whileHover` mid-drag (Motion's behaviour too).
  - After a lost release, the gesture ends at the first unpressed move, or at the next press anywhere by the same pointer or a new primary pointer of its type.
  - A click on a free drag in the middle of its fling now ends `whileDrag`: the grab hands `x`/`y` back to the spring when no gesture follows it.
  - `hover` and `press` emit only transitions from their initial `false`, as their docs said: a first event that changes nothing no longer emits `false`. `focus` and `inView` keep emitting their first value (an `inView` observer's first report says whether the target starts in view).
  - A synthetic `PointerEvent` built without `pointerType: "mouse"` and `isPrimary: true` is not a Primary pointer, so it drives no drag or press (a bare `new PointerEvent(...)` has `pointerType ""` and `isPrimary false`); Motion's own tests set `isPrimary` the same way (`framer-motion/src/jest.setup.tsx:9-11, 69-90`).
- *Note (#43, 2026-10-15):* `InputSource.keyboard()` became `keyboard(target)`, the keys at an element, with core's own key names (`InputSource.Key`), `fromTarget`, `handled` and `handle()`; the DOM's runs after the page's handlers and inside the dispatch (ADR-0037).
- **Every Environment maps three more fields** (`pointerType`, `button`, `isPrimary`); `makePointerLikeEvent` fills a mouse's for test scripts and mouse-only Environments. A pressed pointer's moves must carry `buttons ≥ 1`: an Environment that reports 0 there ends every drag at its first move. (Since #189, in core's words: `kind`, `button`, `primary`, and moves that are `pressed`; ADR-0036 *Amendment (#189)*.)
- **Cost.** Per press, four page-wide listeners are added and removed (move, up, cancel, down). Per event, a map lookup and a reference compare; a held pointer's event over the target is mapped twice (once per listener) and the target's copy dropped. Nothing while no pointer is held.
- **The hit box no longer matters after the down.** A slot move seen only by the engine's `ResizeObserver` leaves the item's hit box off by the move until the next frame's Measure pass (ADR-0018). In the layout lab's resize mode, `e57c54e` lost the pointer in 2 of 8 held runs there (scenario 11, R1, Chromium); since this change, 0 of 8, and 0 of 48 ordinary runs across Chromium and Firefox. A press still hit-tests, and a move still paints one frame behind with a browser's own scheduler (frames behind: median 1 before and after), so #32 is unchanged.
- **The layout lab reads a release in the same frame as a slot move.** That timing lost the release before; now Chromium runs the release's input task between a frame's paint and its read, and the recorder notes the release as a layout change so that read isn't counted as a held frame.
- **Pinned by** `packages/solid/test/drag-pointer.browser.test.tsx` (P0–P7 for layout and free drag, R1, M1, M3, Q0–Q2, H0–H3, S1, S2; M1, M3, H2 and S1 need Chromium's DevTools touch), `packages/dom/test/input.browser.test.ts` (I1–I10), `packages/core/test/pointer.test.ts` and `held-pointer-source.test.ts` (C1–C14), and `packages/test/test/pointer-rules.test.ts` (N1–N13) and `drag-activity.test.ts` (A1–A6). The layout lab's drag scenarios (11–13) show #31 by hand: the `gesture ends` line, the L toggle that loses the next release, and hand runs R8–R11; headless, every run of them passes in Chromium and Firefox (66 each), where `e57c54e` failed every #31 case.

## Amendment (Reorder, 2026-09-30): a scroll moves a held pointer; drag elements get their defaults

**A scroll during a gesture.**
- A page or container scroll of 60 px in the middle of a drag left the dragged item 60 px off the pointer: 8 of 8 runs, page and plain container, Chromium and Firefox, 2026-09-30. The offset only knew about pointer moves.
- Motion compensates inside its gesture ([PanSession.ts:176-263](https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/framer-motion/src/gestures/pan/PanSession.ts#L176-L263)): a window scroll shifts the last point, an element scroll shifts the origin, and either schedules a move.
- Now, while a pointer is held, the Environment also reports scrolls of the window and of the target's scrollable ancestors. The DOM wires one capture-phase `scroll` listener on the window plus the window's own `scroll`, the two Motion uses, only while a pointer is held.
- `heldPointerSource` records those scroll positions at the down. At each scroll, once the pointer has moved since its down, it emits a move of the held pointer, shifted by the distance scrolled, so `drag`'s offset includes it and every drag, free or layout, stays under the pointer.
- Before that first move a scroll only adds to the shift, which the first move carries. Motion updates nothing until the first pointermove ([PanSession.ts:271-272](https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/framer-motion/src/gestures/pan/PanSession.ts#L271-L272)), so a press held still while the page scrolls stays a press.
- A plain `position: fixed` element stops the feed. The ancestor walk ends at it (its own scroll still counts) and the window isn't tracked, because neither moves the element. Motion's walk records every scrollable ancestor and the window ([PanSession.ts:185-222](https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/framer-motion/src/gestures/pan/PanSession.ts#L185-L222)), so by its source a scroll under a fixed draggable shifts its drag.
- The move also counts toward the drag's velocity, as a window scroll does in Motion.
- An Environment whose scroll views own their gestures supplies nothing.
- It's also what keeps `<Reorder>`'s auto-scroll going while the pointer holds still (ADR-0020).

**Drag elements get Motion's defaults (#36).**
- With `touch-action: auto`, Chromium takes a touch drag for scrolling and cancels it after its first moves (3/3 runs).
- The first mouse drag of an element with text selects that text. In Chromium, a second drag that starts on it becomes a native `dragstart`, which cancels the pointer (6/6); Firefox only highlights it.
- Every `drag` element now gets, as Motion's draggables do (`render/html/use-props.ts:57-73`):
  - `touch-action: none`, or `pan-y` for `drag="x"` and `pan-x` for `drag="y"`;
  - `user-select`, `-webkit-user-select` and `-webkit-touch-callout` set to `none`;
  - `draggable="false"`.
- The style map is a `@wardic/dom` helper any DOM binding reuses. `@wardic/solid` merges it under the user's style (`{ ...defaults, ...user, ...animated }`) and renders the attribute, so both are in SSR markup.
- Unlike Motion, which writes them after the user's style, the user's `style` can override them (for example to keep text selectable). `Reorder.Item` sets its `touch-action` from its axis through that same layer.

**A cancelled drag ends where the pointer was.**
- Chromium's `pointercancel` carries (0, 0), so a drag the browser took over (a touch scroll, a native `dragstart`) ended with its last sample at (0, 0).
- A cancel now ends at the last move's point with a zero delta, and its velocity comes from the moves, as Motion's pan session does ([PanSession.ts:329-333](https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/framer-motion/src/gestures/pan/PanSession.ts#L329-L333)). A release is unchanged.

**Pinned by:**
- a scroll during a hold: `packages/core/test/held-pointer-source.test.ts` (C15–C24), `packages/test/test/pointer-rules.test.ts` (N14–N15), `packages/dom/test/input.browser.test.ts` (I11–I17), `packages/solid/test/drag-scroll.browser.test.tsx` (DS1–DS4) and `reorder-engine.browser.test.tsx` RE3–RE4;
- the drag defaults: `packages/dom/test/drag-defaults.browser.test.ts` (DD1–DD3), `packages/solid/test/drag-defaults.browser.test.tsx` (E1–E9), RE8–RE9, and the server-render test's SS1 and SS3–SS4;
- the cancel point: `packages/test/test/drag.test.ts` ("a cancel ends at the last move's point").

## Amendment (#32, 2026-10-11): a Held pointer's events are handled inside their dispatch; one event's samples before its grab

- **`InputSource.heldPointer` flushes its queue at the end of each feed callback** (ADR-0032, decision 1), so its consumer, dom's Shared source pump and every recognizer behind it, handles the events before the platform's dispatch returns. Before, `Queue.offerUnsafe` released the consumer in a `setTimeout(0)` task in a browser. The helper's "one ordered callback" stays one queue in the platform's order. The flush comes after the hold's state is updated, and an event emitted from inside a consumer's handling stays queued for its next take. *Consequences*' "a move still paints one frame behind with a browser's own scheduler ... so #32 is unchanged" is fixed. Pinned by `held-pointer-source.test.ts` C25–C28.
- **The rest of the grill's "Rule B's `"end"` and the grab of the same down arrive through two subscriptions in no set order" now has a set order.** The drag track subscribes its samples before its grabs (ADR-0032, decision 2), so on an Environment with no page-wide feed the stale gesture's `"end"` starts its release and the grab of the same down stops it before its first frame. On main the grab came first and the release ran, so a `dragSnapToOrigin` element sprang back toward its origin while the pointer was down again (H7). In dom, decision 7's unpressed move already splits the two into separate emits, in that order.
- **"A gesture's release can't be dropped by the grab of the same down"** holds, and more simply: a gesture's bookkeeping and its response run in one handler per sample, in place. The grab handler stops a running release and, with no gesture held, hands `x`/`y` back to the spring.
- **N6 and N7 go with `Drag.fling`** (ADR-0032, decision 3). Their rules, a non-primary press doesn't stop a release and rule B rebases once, are pinned on the drag track by `drag-hops.browser.test.tsx` H6 and H7.

## Amendment (#29, 2026-10-12): a drag claims its axes; of nested draggables the innermost drags

**What was wrong.** A `pointerdown` on an inner draggable bubbles to its draggable ancestors, and every drag recognizer on the way took the gesture. Grabbing the inner element dragged the outer one too, and a free inner element rode its ancestor as well as following the pointer, so it moved twice as far.

Measured 2026-10-12 with Playwright's real mouse, in Chromium 147 and Firefox 148 (both gave the same rows). `.tmp/29-nested/` drives the same scenes on a Wardic page and a framer-motion 13.4.0 page (motion-dom 13.3.0, the reference at `16c6122`). The scene is an outer draggable O holding an inner draggable I; each gesture grabs I and moves +60,+30, and the cells show each element's movement while held:

| Scene (O / I) | Motion 13.4.0 | main at `a663972` |
|---|---|---|
| free / free | O `0,0` · I `60,30` | O `60,30` · I `120,60` |
| layout / layout | O `0,0` · I `60,30` | O `60,30` · I `60,30` |
| free / layout, layout / free | O stays | both drag (I `120,60`) |
| `x` / `x` | O `0,0` · I `60,0` | O `60,0` · I `120,0` |
| free / `x`, `x` / free | O stays | both drag |
| `x` / `y` | both drag, each on its axis | the same |
| free / free with `dragPropagation` on I | both drag | the same (no such prop) |
| `x` card / `<Reorder>` list on y | both drag | the same |
| free card / `<Reorder>` list on y | the card stays | both drag |

While I was dragged, Motion's O kept its `whileHover` and its `whileTap` (the press started at the bubbled down, before any drag), but not its `whileDrag`. Grabbing O after I's release dragged O alone, and grabbing I again dragged I alone, in every scene. Motion's mechanism is a lock on each axis, taken when the drag passes its threshold: "If we don't have the lock, don't start dragging" ([VisualElementDragControls.ts:119-128](https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/framer-motion/src/gestures/drag/VisualElementDragControls.ts#L119-L128), [set-active.ts](https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/motion-dom/src/gestures/drag/state/set-active.ts)).

**Decisions** (grilled 2026-10-12; each matches Motion unless it says otherwise):

1. **The lock lives in core's Drag activity (decision 3b), claimed by `Recognizer.drag`.**
   - Claiming a gesture is recognition (ADR-0004). The Drag activity is already page-wide by default and per runtime in tests.
   - Every consumer of the recognizer gets the lock: the drag track, `createDrag`, and `<Reorder>` items, which run through the track.
   - *Rejected:*
     - the `InputSource`, whose pointer stream hover, press and drag share, so it can't tell which targets drag;
     - the binding's drag track, which `createDrag` would bypass;
     - a second `Context.Reference` beside the Drag activity, two page-wide references that change together.
2. **It's claimed at the drag's `"start"`, and a refused drag stays refused until its gesture ends.**
   - The first drag to start claims. A refused drag emits nothing for that gesture, as a tap emits nothing, and doesn't retry if the claim frees mid-gesture. Motion's `onMove` returns early without the lock in the same way.
   - **No explicit innermost rule; it comes from listener order.**
     - The down bubbles innermost first, so the inner target adds its page-wide listeners first (`InputSource.heldPointer`, inside each target's down).
     - Each move then reaches the inner target's listener first and, since ADR-0032, is handled inside it.
     - The inner and outer drags share a down point and a threshold, so they start on the same move and the inner one claims first.
     - Motion's pan sessions update in the order their window listeners were added, which is the same mechanism.
   - *Rejected:* claiming at the down. It gives the same outcome in every case constructed, but a `<Reorder>` item's axis is decided at the gesture's start (ADR-0020, D5).
3. **The target holds the claim (CONTEXT.md **Drag claim**).**
   - Every drag subscription on one target shares its claim, and a target never refuses itself. An element's drag track and a `createDrag` on the same element both see its gestures, whichever subscribed first.
   - The axes free at the last of the target's claims' releases.
   - The glossary avoids "drag lock", Motion's word, because `Drag.axisLock` used "lock" for a drag kept to one axis.
4. **Claims are per axis.**
   - A drag claims the axis of an `x` or `y` drag, or both for a free one. It's refused if another target holds any axis it needs, so `x` around `y` drags both, as Motion's does.
   - **`Recognizer.drag(target, { axis })` is the one input.** `axis` is a `Drag.Axis` (`"x" | "y" | "xy"`), or a function read at each gesture's start, which a `<Reorder>` item passes. The recognizer keeps the samples to the axis (off-axis offset, delta and velocity zeroed) and claims it.
   - **`Drag.axisLock` goes, with no alias** (`pipeable.md`: a combinator needs a caller).
   - *Rejected:* keeping `axisLock` as shaping beside a claim-only `axis`. The two inputs could disagree: `Recognizer.drag(el).pipe(Drag.axisLock("x"))` would claim both axes while moving on one, and an `x` card would silently block a `y` list inside it.
   - *Rejected:* one claim for the whole page. It would stop `x` around `y` from dragging both, which Motion and main both allow.
5. **An opt-out: `dragPropagation` in the binding, `claim: false` in core.**
   - The drag neither claims nor is refused, so an element with it drags with its draggable ancestors (Motion's `dragPropagation`).
   - `createDrag(el, { claim: false })` also lets an app watch a pan over an area without blocking the draggables in it, the role of Motion's `onPan`, which takes no lock.
   - **A non-claiming drag still counts in the Drag activity** (`DragActivity.count()`), so no hover or press starts while it runs, as decision 3b decided. *This departs from Motion,* whose `isDragActive` is the lock itself, so a propagating drag there blocks nothing.
6. **`<Reorder>` and layout drags need nothing more, and a grab on a child still stops an ancestor's release.**
   - **Reorder items:** the item's per-gesture axis becomes the recognizer's `axis`. A `y` list in an `x` card drags both; an `"xy"` grid claims both axes and refuses its card.
   - **Layout drags:** a refused projection node gets no `"start"`, so no `dragStart`, no `whileDrag` and no release.
   - **The grab:** a bare primary down on an element stops its running release (ADR-0032, decision 2). That down comes before any claim and bubbles, so grabbing a child mid-fling catches the ancestor where it is. Motion stops it too: every pan session calls `onSessionStart → stopAnimation()` at its down ([PanSession.ts:147-149](https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/framer-motion/src/gestures/pan/PanSession.ts#L147-L149)).
   - *Rejected:* a grab that waits for the claim, which adds a hop between the down and the decision.
   - *Not changed here:* after a click that stopped it, Motion restarts a `dragSnapToOrigin` element's snap-back at the release ([PanSession.ts:322-325](https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/framer-motion/src/gestures/pan/PanSession.ts#L322-L325)). Wardic leaves it where the grab stopped it, both for a direct click and for a grab on a child. That belongs to the release and velocity work (#30, #38).
7. **A claim is released at the gesture's end, or when the drag is interrupted, and never held through the release.**
   - The end is a release, a cancel or a Stale gesture's end. An interruption is an unmount mid-drag.
   - Nothing holds the claim through a fling, a snap-back or a layout node's flight to its slot, so the outer element can be grabbed while the inner one still flies.
   - A lost release can't leak a claim: this ADR's rules end a Stale gesture by the next press at the latest.
   - *This departs from Motion,* which keeps its pan session, and so its lock, across an unmount until the pointer's release ([drag/index.ts:45-58](https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/framer-motion/src/gestures/drag/index.ts#L45-L58)), because React 19 briefly remounts Reorder items mid-drag. Solid's `<For>` moves an item's node without remounting it, and a claim held for an element that is gone would only block other drags. The refused ancestors still stay put until the release (decision 2).
8. **The outer element's hover and press stay as they were.** Its press starts at the bubbled down, before any drag, and the Drag activity only stops a hover or press from *starting*. So a card's `whileTap` shows while a slider inside it is dragged, as in Motion.
   - *Not copied:* when two drags run at once (`x` around `y`, `dragPropagation`, the `<Reorder>` row), Motion leaves the inner element's `whileTap` on after the release, because its press end is ignored while any lock is held. Here a press ends at its pointer's release whatever the Drag activity says.

**Consequences.**
- **Behaviour.** Grabbing a draggable inside a draggable that needs one of its axes drags the inner one alone. Two nested drags on different axes, or with `dragPropagation`, still drag together. Hover, press and `whileTap` on ancestors are unchanged.
- **API.**
  - Core:
    - `Recognizer.drag(target, { axis?, claim? })` and `Recognizer.DragOptions`;
    - `Drag.Axis`;
    - `DragActivity.Shape`'s `claim(target, axis): Option<release>` (refused: `None`) and `count()`, in place of the argument-less `claim()`;
    - `Drag.axisLock` removed.
  - Solid:
    - `dragPropagation` on `wardic.*`, `useWardic`, `use:ward` and `Reorder.Item`;
    - `createDrag`'s `claim` option.
- **Cost.**
  - Per gesture, at the drag's start and end, the claim reads and writes one `MutableRef` per axis, and the count.
  - Per drag sample, the stage after the fold is now a `Stream.filterMapEffect` that keeps or drops the sample, where it was a `Stream.tap` that claimed the Drag activity. A one-axis drag loses `axisLock`'s `Stream.map`.
  - Nothing is added per Clock tick. See *Measured* below.
- **Found, not fixed here.** A `<Reorder>` item that reorders while its card is dragged on the other axis loses the card's offset on that axis: main and this change both paint it `30,60` where Motion paints `60,60`, and then `-60,60` on the next grab (`.tmp/29-nested/`, `DY=60`). It happens with no claim refused, so it isn't the claim's: #136, fixed by ADR-0012, *Amendment (#136)*.
- **Pinned by:**
  - `packages/core/test/pointer.test.ts`: C3 and C4 (the count), and C5–C8 (claims per axis, refused for another target, shared by one target, a count that claims nothing);
  - `packages/test/test/drag-activity.test.ts` A7–A13 (the drag that starts first claims, refused for the whole gesture, an unmount mid-gesture, the axis table, one target's subscriptions, `claim: false`, an axis read per gesture, a Stale gesture's release), and `drag.test.ts`'s two `axis` tests;
  - `packages/solid/test/drag-nested.browser.test.tsx` NC1–NC10, with the real mouse: free, layout and mixed nesting; per-axis rows; presses after two drags; `dragPropagation`; `createDrag`'s claim; an unmount mid-drag; the grab; `<Reorder>` in a card.
    - On main, NC1–NC4.3, NC7, NC8 and NC10.1 fail.
    - NC4.4, NC5, NC6, NC9 and NC10.2 pin what main already did, and fail under a whole-page claim, a `dragPropagation` that's ignored, or a grab that's ignored.

**Measured** (2026-10-12, the bench server, `wardic-quiet` first):
- **`bun run bench:core --base main`** (11 paired reps):
  - Every timing gate is `ok` in Bun, Node and Chromium. The noise controls were Bun +0.8%, Node −1.1% and Chromium +0.9%.
  - Node's bytes gate flagged `animateValues/loop` (0.73 → 0.80 MB, +9.5%) and `springBlend/loop` (0.69 → 0.76 MB, +9.9%). These two flap on identical code (#94), so the steps-only probe (`.tmp/94-bytes/`, 1,000 machines over 2,000 frames, 11 reps, Node, `--expose-gc`) decided them:
    - `springBlend`: 480,295 bytes per frame on main and on this change.
    - `animateValues`: main's median was 672,525 [640,334–704,383] and this change's 688,305 [640,339–736,350]. An A/A run of main against main gave 688,305 against 672,521: the same swing.
  - None of the changed code runs per frame. `Recognizer`, `DragActivity` and `Drag` run per pointer event, and the bench's workloads use none of them.
- **The layout lab** (`.tmp/73-proto/drive.ts`, headless Chromium, k = 5, cold and warm, main against this change): identical.
  - Drag scenarios 11–14 (40 runs each): 0 frames behind, 0 release held, every run settled.
  - Scenarios 1–10: the same held frames, first steps and verdicts.
