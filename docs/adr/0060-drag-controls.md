# Drag controls

Motion starts a drag from outside its element with drag controls (`framer-motion/src/gestures/drag/use-drag-controls.ts`, `VisualElementDragControls.ts`, `.reference/motion` at `16c6122`):
- **`useDragControls()`** returns controls. An element given `dragControls={controls}` subscribes while it's mounted.
- **`start(event, { snapToCursor, distanceThreshold })`** starts a pan session on each subscribed element from that pointer event, so a handle, a track or a list's grip begins the drag. An element that is exiting starts none.
  - **`snapToCursor`** moves the element's centre under the pointer as the session starts. It reads the projection's layout box, so it works only where there is one.
  - **`distanceThreshold`** replaces the session's 3 px.
- **`stop()`** ends a drag as a release would: the inertia at the last pan's velocity, and `onDragEnd`. **`cancel()`** ends it where it is: no release, no `onDragEnd`, `whileDrag` off, its drag lock opened.
- **`dragListener={false}`** stops the element's own `pointerdown` starting one, and with it the drag defaults (`touch-action`, `user-select`, `draggable`; `render/html/use-props.ts`).

Wardic's drag listened only to presses on its own element: core's `Recognizer.watchDrag` folds `InputSource.pointer(target)`, a target's **Held pointer** feed (ADR-0019). #431 is the fifth of 1.0's Motion-parity gaps (#426).

## Decisions (grilled 2026-10-28, Q1–Q4 each A)

1. **Motion's controls, the same on both bindings** (Q1). `createDragControls()` makes them outside the element, and they're given in, as Solid 2's `wardRef` and `groupRef` are (#349):
   - `dragControls={controls}` on a `wardic.*` element, in a ward's config, or on a `Reorder.Item`, with `dragListener={false}` to stop the element's own presses;
   - `controls.start(event, options)` begins the drag on each element given them, from a pointer that went down anywhere. The element's drag recognizer adopts that pointer and follows it as if it had pressed the element.

   Rejected: B, a method on Solid 2's ward; C, a declarative `dragHandle`.
2. **The item keeps its keys, and claims are as for any drag** (Q2).
   - A `Reorder.Item`'s keyboard reorder (ADR-0037) is unchanged: the item stays the tab stop, and a handle is pointer-only.
   - A drag the controls start takes its axis's **Drag claim** (ADR-0019, *Amendment (#29)*) as any drag does, and `dragPropagation` opts out. So of two elements given the same controls on one axis, the first drags and the second is refused, as Motion's global drag lock refuses it.

   Rejected: B, moving the keys to a handle ref.
3. **`snapToCursor` and `distanceThreshold`** (Q3).
   - `snapToCursor` puts the element's centre under the pointer at the press. It's measured from the element's box now, so it works on any element, where Motion's needs a projection layout.
   - `distanceThreshold` replaces the 3 px a drag moves before it starts.
   - Neither changes a drag the element's own press starts.

   Rejected: B, `snapToCursor` only.
4. **Motion's `stop()` and `cancel()`** (Q4).
   - `stop()` ends a drag as its pointer's release would: its release runs at the drag's velocity, and `onDragEnd` and Solid 2's `dragEnd` are told.
   - `cancel()` ends it where it is: no release, no `onDragEnd`, `whileDrag` off, its claim given back.
   - Both do nothing with no drag running.

   Rejected: B, `cancel()` springing back.

**Defaults, stated rather than asked:**
- **An exiting element starts no drag,** as Motion's doesn't.
- **One PR.**

## Built

- **core, adopting a pointer** (`InputSource`):
  - **`InputSource.adoptPointer(target, raw)`** hands a pointer pressed elsewhere to the target. Its down is delivered on `pointer(target)` inside the call, marked `adopted`, and held from there as the target's own downs are, so its moves, release and cancel reach the target's feed wherever they land. It returns the down, or `undefined` for what isn't a pressed pointer's event.
  - **`heldPointer`'s `adopted` feed** carries those downs. A press that reaches the target too (a handle inside it) keeps the one hold. Only the down is marked; the pointer's later events aren't.
  - **Only a drag starts from an adopted down.** A press, a hover and a pan leave it out, as Motion's press and pan listen on the element and never hear a controls' start.
  - **The DOM** (`internal/input.ts`) adopts any `PointerEvent` with a button pressed, at its viewport point. The **Test Environment**'s pushable source adopts a pressed pointer event as its `raw`, pushing it on its hub.
- **core, the drag** (`Recognizer.watchDrag`):
  - **`listen: false`:** only an adopted down claims a gesture. A down the drag doesn't claim is left out, so the same press adopted after its own down (a handle inside the element) claims from the adopted one.
  - **`threshold(down)`,** read at the down, gives the gesture its own threshold, else 3 px. A direction lock waits for it as well as its 10 px on one axis.
  - **`watchDrag` returns the watch** (`WatchedDrag`), whose `stop()` and `cancel()` end its gesture from outside its pointer, inside the call. The end is at the last point, with that event's time and platform event. `stop`'s has the moves' velocity, as a cancel's (Motion's `latestPanInfo`). `cancel`'s has none and is marked `cancelled` (`Drag.Sample.cancelled`). A gesture that hasn't started just resets. Either way the pointer's later events are left out, and nothing is told once the Scope has closed.
- **The bindings** (`drag-controls.ts`, `drag-track.ts`):
  - **`createDragControls()`** on both, needing no owner, with `WardicDragControls` and `WardicDragControlsOptions`.
  - **The drag track subscribes** to its element's controls while its watch Scope is open. An element an `<AnimatePresence>` is taking out has been disposed, so it starts none.
  - **A start** adopts the pointer with the controls' `distanceThreshold` set for the length of the call, so only that gesture takes it. The adopted down's grab stops a running release, as Motion's session start stops the animation.
  - **The snap** follows: a plain element's `x`/`y` move by the pointer's distance from its box's centre, on the axes it drags. A layout node begins its projection drag at that offset (`dragStart`, `dragMove`), which the drag then starts from, or which ends (`dragEnd` at rest, back on its slot) when the press ends with no drag.
  - **`stop()` and `cancel()`** call the watch's. A cancelled end starts no release and hands `x`/`y` back. A layout node goes back on its slot at rest, as its drag always ends. The Reorder group still hears the end; the app's callbacks don't (Solid 1's `onDragEnd`, Solid 2's `dragEnd`).
  - **`dragListener={false}`** passes `listen: false` and grabs only adopted downs, so a press on the element doesn't stop its release. It also drops the drag defaults, the `Reorder.Item`'s group `touch-action` among them, as Motion's go with its listener, so a list dragged by its handles scrolls by touch. The handle wants `touch-action: none`, as with Motion.
- **The props:** `dragControls` and `dragListener` on `WardConfig`, the `wardic.*` props (rare keys, read only when given, #273) and Solid 2's ward keys, read once at mount as the rest of the drag config.

**A divergence from Motion, kept:** `whileDrag` stays on through `stop()`'s release tail, as it does through every Wardic release, where Motion's `stop` turns it off before the inertia. Wardic's `dragging` holds `x`/`y` for the drag until the release rests (ADR-0004, ADR-0016).

## Tests

- **core** (`packages/test/test/drag-controls.test.ts`), DC1–DC6:
  - DC1: an adopted down drags; a press and a pan leave it out;
  - DC2: `listen: false`;
  - DC3: the threshold, read at the down, with a lock;
  - DC4: `stop`, a release at the last point with the moves' velocity, the claim given back before the end is told;
  - DC5: `cancel`, and nothing after the Scope's close;
  - DC6: `heldPointer`'s adopted hold.
- **Solid 1** (`drag-controls.browser.test.tsx`, real mouse), DCS1–DCS11:
  - a handle's drag with `whileDrag` and the callbacks, a second element refused its claim and one with `dragPropagation` following;
  - `dragListener={false}`, its drag defaults dropped;
  - `snapToCursor`, a plain element's and a layout node's (back on its slot);
  - `distanceThreshold`;
  - `stop()` and `cancel()`;
  - an exiting element neither dragging nor snapping;
  - a `Reorder.Item` by its handle;
  - a listener-less element's release going on through a press on it;
  - an unmounted element collected while its controls live on (DCS11), through a `collectGarbage` command the Solid browser projects now share with @wardic/dom's (#418).
- **Solid 2** (`v2/drag-controls.browser.test.tsx`), DV1–DV6: the same through a ward's config and a `wardic.div`'s prop, with `next("dragStart")` and `next("dragEnd")`.

A test that presses a listener-less element and moves leaves a text selection, which the next press drags natively, cancelling the pointer. The tests clear it, and the element in DCS10 sets `user-select: none`.

**Mutation-checked** (`.tmp/431/mutate.py`): twenty single-point mutations, each caught by the tests meant for it:
- core: an adopted down unmarked; a press or a pan taking one; `listen` or the threshold ignored; a lock ignoring the threshold; `stop` with no velocity; `cancel` unmarked; an end from outside after the Scope's close;
- the bindings: the track never subscribing, or never unsubscribing; no snap; a layout node's snap left at the press end; a cancel releasing; either binding telling a cancelled end; the drag defaults, or a Reorder item's `touch-action`, kept with no listener; an own press grabbing with no listener.

Two first survived, and their tests were tightened:
- **Never unsubscribing** changes nothing visible: a disposed element's watch is closed, so a start reaches nothing. It only keeps the element, so DCS11 reads it through a `WeakRef` after a full collection.
- **An own press grabbing with no listener:** DCS10 compared the position after the press with one read before it, and the release moved on while the real press was on its way. It now compares frames after the press lands.

## Measured

`bench:solid` against `main` (`cc1781e`, 11 paired reps) passed on both bindings, with the noise control at +0.0%. The workload uses no drag controls, so these are what every element pays. Solid 1 / Solid 2:
- **Warm:**
  - mount +1.9% / +2.6%;
  - Retarget +1.6% / +2.1%;
  - rest Retarget +0.1% / +1.2%;
  - unmount +0.4% / −0.2%.
- **Bytes per element per round:** −0.2% / −0.2%.
- **Layout scenes:** flat.
- **Left after the unmount:** unchanged.
- **Retained at rest grew:**
  - hover + press: +1.6% / +1.3% (19.29 → 19.60 KB, 18.61 → 18.85);
  - a Reorder item: +2.6% / +2.6% (27.15 → 27.84 KB, 26.10 → 26.77).

  The heap probe hasn't attributed it. The likely part is what each pointer target now holds for adoption: its `heldPointer` subscribes the adopted feed, a `Set` in the DOM's registry and a few closures, whether or not anything adopts. A drag adds its watch's outside ends and the track's snap and threshold closures. It's for the final review's performance pass (#460).

## Amendment (#507, 2026-11-03): adoption, and the track's controls, only for an element given them

**What happened.** Found by #460's review, as *Measured* above left it:
- **Every pointer target paid for adoption:** its `heldPointer` subscribed the adopted feed, a `Set` in the DOM's registry and its closures, about 0.25 KB at rest.
- **Every drag track paid for controls:** it made `threshold`, `snapTo` and `unsnap`, about 0.45 KB, whether or not anything controlled it.

Motion's elements subscribe to their `dragControls` only when given them.

**Decided (#507's grill).**
1. **Adoption only with controls (Q1).** `InputSource` gets an optional `adoptablePointer(target)`: `pointer(target)` with the downs `adoptPointer` hands it.
   - **The plain feed** subscribes no adoption. An Environment without `adoptablePointer` delivers them on `pointer` itself, as the Test Environment does (`adoptablePointerOf`).
   - **A drag given controls** (`watchDrag`'s `adoptable`) and its track's grabs read the adoptable feed. Hover, press, pan and a plain drag read `pointer`, and `createDrag`'s sensor too.
   - **The DOM** makes the two from the same Held pointer, one with the adopted feed. An element with controls has two listener sets, its drag's beside its hover's and press's.
   - **Held twice:** both hold a press on it, and the auto-scroller's scroll shift stays right, as each hold clears only its own entry.
2. **The track's controls only when given (Q2).** `threshold` is made only for a track given controls, which both bindings read once at its start. `snapTo` and `unsnap` are module functions taking the track's state, so no track makes them.

**Rejected:**
- *Q1:* a cheaper adoption for every feed, a `WeakMap` entry each; leaving it.
- *Q2:* building them at the first adopted down; leaving it.

**A limit:** a `createDrag` sensor on an element that also has Drag controls no longer hears their adopted downs. They're meant for its drag.

Pinned by:
- `dom/test/input.browser.test.ts`'s **I20:** a down `adoptPointer` hands a target reaches its adoptable feed alone, not its plain one.
- DC1–DC6 and the binding's controls tests, unchanged and passing.

Mutation: adoption back on the plain feed, caught by I20.

**Measured.** `bench:solid --base main --features`, 11 paired reps, passes; the noise control +0.0%.
- **Held at rest,** Solid 1 / Solid 2:
  - hover + press −1.5% / −1.5% (17.73 → 17.47 KB, 17.18 → 16.93);
  - a Reorder item −1.3% / −1.3% (29.40 → 29.03 KB, 27.65 → 27.29).
- **Everything else is flat:** warm tasks within −0.6% and +0.9%, bytes per element within −0.2% and +0.1%, the layout scenes and the feature pages.

The hover + press saving, 0.26 KB, is the adopted feed's, as estimated. A Reorder item's is 0.37 KB, so the track's own controls were about 0.1 KB, not 0.45. What #431 added to a Reorder item beyond the two, about 0.34 KB, is left. The likeliest part is the drag watch's ends from outside (`stop`, `cancel`), which every drag makes.
