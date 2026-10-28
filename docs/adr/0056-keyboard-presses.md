# Keyboard presses

Motion's press gesture is keyboard accessible (`motion-dom/src/gestures/press/index.ts`, `utils/keyboard.ts`, `.reference/motion` at `16c6122`):
- **The keys:** once an element has focus, Enter's keydown starts a press (`whileTap` on, `onTapStart`), its keyup taps (`onTap`), and a blur cancels it (`onTapCancel`).
- **Focus:** an element with a press that can't take focus gets `tabIndex = 0`.

Wardic's press recognizer read pointers alone, so `whileTap` and the tap events never came from a keyboard. #427 is the first of 1.0's Motion-parity gaps (#426).

Core already had what a keyboard press needs: the keyboard and focus Input feeds (ADR-0037, ADR-0055). The keyboard feed delivers a key at its target after the page's own handlers, says whether it came from the target itself (`fromTarget`) and whether something took it first (`handled`), and lets a consumer take it (`handle()`).

## Decisions (grilled 2026-10-28, Q1, Q2, Q4–Q6 A, Q3 B)

1. **Enter and Space both press** (Q1: A).
   - **How:** keydown starts the press, keyup taps, and a blur cancels.
   - **Why both:** Motion reads Enter alone. Space is the platform's button key, WAI-ARIA's button pattern, and Wardic's own reorder key (ADR-0037).
   - **Taking Space:** Wardic takes it (`preventDefault`) only where its target does nothing with it, since there the page would scroll. A native `<button>` keeps it: a probe in Chromium and Firefox showed a prevented Space keydown stops the button's own click.
   - Rejected: B, Enter only.
2. **Motion's focus rule** (Q2: A). A non-focusable HTML element with no `tabindex` gets `tabindex="0"` at mount, on the client, when it has a press:
   - `whileTap`;
   - Solid 1's tap callbacks;
   - a Solid 2 press event asked for;
   - `createPress`.

   Once added, it stays. Ported code keeps working with nothing added. axe's best-practice rule `focus-order-semantics` may flag a role-less `<div>`. Rejected: B, never adding it.
3. **Every press event says how it was made,** `input: "pointer" | "keyboard"` (Q3). On Solid 2, the press also becomes an async value, `card.tapped()`, as an animation is `settled()` (ADR-0046):
   - the last tap, `undefined` before the first;
   - pending while a press is held, so `isPending(() => card.tapped())` is "pressed";
   - a tap resolves it; a cancel keeps the last.

   It comes in the second PR (Q6). Rejected: A, the events only; C, a `pressStart` carrying its end as a promise.
4. **A keyboard press's point is its element's centre** in the viewport, measured at the key (Q4: A), so code that places something at a press (a ripple, a popover) works for one. On Solid 1, the callback's `event` is the real `KeyboardEvent`, or the blur's `FocusEvent` for a cancel, so `stopPropagation` works. Rejected: B, Motion's page origin, which its synthetic pointer event gives; C, no point.
5. **A taken key doesn't press** (Q5: A).
   - **The page's key:** a key the page prevented before Wardic heard it starts none.
   - **A Reorder item's:** its Enter and Space are its Keyboard reorder's, so its lift is no press, its drop no tap.

   Rejected: B, Motion's: a key always presses.
6. **Two PRs** (Q6: A): keyboard presses on both bindings first, Solid 2's `tapped()` second.

**Defaults, stated rather than asked:**
- **Only the element's own keys press** (`fromTarget`). Enter in a text field, or on a button inside a pressable card, doesn't press the card. That's Motion's too, as focus doesn't bubble.
- **Space types in a text field** (an `input` that takes text, a `textarea`, an editable region), so it doesn't press there. Enter still presses, as on Motion.
- **One press at a time:**
  - a held key's repeats are ignored;
  - a key while a pointer presses starts nothing, nor a pointer while a key presses;
  - the other key's up ends nothing;
  - a second down of the same key without its up (a lost keyup) keeps the press, as a pointer's second down does.
- **Drags:** no keyboard press starts while a drag is active, and one a drag became active during ends `"dragged"`, neither a tap nor a cancel.
- **Escape doesn't cancel,** as on Motion.

## Built (PR 1)

- **core** (`InputSource`):
  - a key event carries `action: KeyAction` (`"type" | "activate" | "none"`): what its own target does with it, which each Environment says of its own targets, so core needs no platform's element kinds;
  - key and focus events carry the platform's `raw` event, as a pointer event does (#273).
- **core** (`Recognizer.watchPress`): one fold over the target's pointer, keys and focus.
  - **One state, three steps:** each feed is watched with its own step over the one state, so a pointer's move allocates nothing for the keys.
  - **Press events** are a union on `input`: a pointer's carries its pointer event, a keyboard press's its key event, or the blur that cancelled it.
  - **The watch ends** only once every feed has run out (a test's scripts), not at the first.
  - **`keys: false`** leaves the keys and the blur out (`PressOptions`, also on `press` and `pressEvents`).
  - **Space's down** starting a press is taken where its target's `action` is `"none"`.
- **dom** (`DomInput`):
  - a key's `action` comes from the element it came from: an editable region and a `textarea` type both keys; an `<input>` that takes text types Space and submits on Enter; a button, a `select`, a `summary` and an acting `<input>` (a checkbox, a submit…) act on both; a link acts on Enter, and Space scrolls;
  - `makeFocusable(element)` gives an HTML element that doesn't take focus of itself, with no `tabindex`, `tabindex="0"`. SVG elements are left, as Motion leaves them.
- **solid** (`press.ts`): `watchPressOn(element, handlers, keysTaken)` makes the element focusable, unless its keys are taken, then watches its press with or without keys. Both bindings' elements and their `createPress` watch through it. A Reorder item's internals say `keysTaken`.
- **The info** (`gesture-info.ts`): `pressInfoOf(press, element)`, `WardicPressInfo` with its `input`, and `WardicPressEvent` (`PointerEvent | KeyboardEvent | FocusEvent`).
  - Solid 1's `onTapStart`, `onTap` and `onTapCancel` take `(event: WardicPressEvent, info: WardicPressInfo)`.
  - Solid 2's `pressStart`, `tap` and `tapCancel` resolve with `WardPressInfo`, the same with its `element`.
  - **Breaking, in types only:** a callback typed `(event: PointerEvent) => …` no longer fits. An inline handler is inferred as before.
- **Test Environment:** `TestInput.layer` takes a key script, and `pushable()` gains `pushKey`.

## Tests (PR 1)

- **Core** (`packages/test/test/keyboard-press.test.ts`), KP1–KP8:
  - KP1: Enter and Space press and tap, with their key events;
  - KP2: what doesn't press (a repeat, a key from inside, a taken key, another key, a typed Space), and Enter in a text field does;
  - KP3: a blur cancels, with the blur, and a pointer's press goes on through one;
  - KP4: one press at a time, and none during a drag; one a drag took ends `"dragged"`;
  - KP5: Space taken only where its target does nothing, Enter never;
  - KP6: `keys: false`;
  - KP7: the Stream ends once every feed has run out;
  - KP8: a lost keyup keeps the press.
- **dom** (`input.browser.test.ts`):
  - KA1: each element kind's action for Enter and Space, and the raw event;
  - KA2: `makeFocusable` on each kind.
- **Solid 1, the browser's own keys** (`keyboard-press.browser.test.tsx`):
  - KB1: Enter held, `whileTap` and the callbacks, from the centre;
  - KB2: Space: no scroll on a `div`, a button's own click kept;
  - KB3: a blur's cancel;
  - KB4: which elements get `tabindex`;
  - KB5: a child's key, and a text field's Space and Enter;
  - KB6: a Reorder item's lift is no press.
- **Solid 2** (`v2/keyboard-press.browser.test.tsx`):
  - KB7: `next("pressStart")` and `next("tap")` from the keyboard, and `whileTap`;
  - KB8: a press event asked for makes the element focusable;
  - KB9: a blur's cancel;
  - KB10: a Reorder item;
  - KB11: an effect over `when("tap")` hears Enter's and Space's taps, and asking makes the element focusable.

**Mutation-checked:** twenty single-point mutations, each caught by the tests meant for it:
- core:
  - keys never pressing;
  - Space pressing in a text field;
  - a key from inside, a taken key or a repeat pressing;
  - a blur not cancelling;
  - a pointer pressing during a key's press, or the reverse;
  - a key pressing during a drag;
  - Space always taken, or never;
  - `keys: false` ignored;
  - the watch ending at its first feed's end;
- dom:
  - nothing made focusable, or a given `tabindex` overwritten;
  - a text field's or a link's Space acting;
- solid:
  - a keyboard press placed at the origin;
  - either binding's Reorder item not taking its keys.

## Built (PR 2): Solid 2's `tapped()`

`card.tapped()` (Q3) is built as `settled()` is (ADR-0046, `lifecycle.ts`):
- **What it keeps:** counts and references until it's asked for. The presses started and ended are counted, and the last tap's press event and element are kept. Its info (`WardPressInfo`) is built from them the first time it's read.
  - **Once it's been read,** its memo pends at each press's start, whether or not anything reads it then. So the tap's info is built when that pending read resolves, at the tap, and a keyboard press's centre is measured at the key. Before the first read, nothing is allocated for a tap.
  - A draft also built the info at the tap when there was a reader. Its mutation survived a test with no read during the press, since the memo had already pended, so it went.
- **The memo:** made at its first read, over a count of the presses started. It returns the last tap while every press has ended, else a pending promise.
  - **A press's start** sets the count, so the read pends.
  - **Its end** resolves the promise: with the new tap for a tap, or the last tap for a cancel or a press a drag took over.
  - **The first read is never pending.** A press held at it pends from a microtask on, as `settled()`'s first read during a Retarget does.
- **The first read asks for the press,** as `next("tap")` does. The ward runs its recognizer on its element (and on later mounts), and the element is made focusable.
- **The lifecycle hears every press:** it keeps a press's state before its early return for a ward with no `next`, `each` or `when` waiting.
- **On a server,** `tapped()` is `undefined`, as `settled()` is.

## Tests (PR 2)

`test/v2/tapped.browser.test.tsx`:
- TP1: `undefined` and not pending before the first tap; pending through a pointer's press, the read keeping its value; then the tap;
- TP2: a keyboard press's tap, at its centre measured at the key, unmoved by the element moving after, read during the press or not;
- TP3: a cancel keeps the last tap: a release elsewhere, and a blur;
- TP4: the first read asks for the press: the element made focusable, and a tap heard;
- TP5: a reader in JSX beside `isPending`, with no `<Loading>` and no diagnostic;
- TP6: a press a drag took over keeps the last tap;
- TP7: a tap before the first read is kept;
- TP8: a press held at the first read: not pending at that read, pending from a microtask on.

**Mutation-checked:** eight single-point mutations of `tapped()`, each caught by TP1–TP8:
- a press's start not pending;
- a cancel taking the tap's place;
- the first read asking for nothing;
- presses heard only with events waiting;
- the first read pending on a held press;
- a held press at the first read never pending;
- a tap before the first read forgotten;
- the pending read never resolved.
