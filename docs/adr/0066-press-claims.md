# Press claims: `propagate={{ tap: false }}`

Motion's `propagate` (`motion-dom/src/node/types.ts:1059-1091`, `.reference/motion` at `16c6122`):
- **What it takes:** `PropagateOptions { tap?: boolean }`, nothing else. By default every gesture propagates.
- **How it works:** with `tap: false`, an element's press adds the `pointerdown` it starts from to a module-level set (`claimedPointerDownEvents`, `gestures/press/index.ts:57-67`), and an ancestor's press skips a down in that set. Nothing else reads the set: a drag of the ancestor still starts from that down.
- **Keys:** Motion's keyboard press dispatches a synthetic `pointerdown` that bubbles (`press/utils/keyboard.ts:14-15`), so Enter on a focused pressable child presses its pressable ancestors too, unless the child claims it. Measured on Motion 14.6 (React 19, real keys and mouse): with no `propagate`, mouse and Enter both told `inner start, outer start, inner tap, outer tap`; with `tap: false`, `inner start, inner tap` only.
- **What's pressable:** the press feature mounts only for `whileTap`, `onTap`, `onTapStart` or `onTapCancel` (`motion/features/definitions.ts:20`), so `propagate` alone does nothing. It's read once, at mount.

Wardic pressed both elements of a nested pair from a pointer, as Motion does, and only the focused element from a key (ADR-0056, `fromTarget`). A Solid 1 app could stop an ancestor's press only with `stopPropagation` in a callback, which stops every listener; Solid 2 has no callbacks. #439 is one of 1.0's Motion-parity gaps (#426).

## Decisions (grilled 2026-10-30, #439)

1. **`propagate={{ tap: false }}`, `tap` only** (Q1: A). Motion's API: an element whose taps don't propagate takes a **Press claim** on the down its press starts from, and no ancestor's press starts from it: no `whileTap`, no tap callbacks, no Solid 2 tap events. On Solid 1 a `propagate` prop on `wardic.*` and in `createWard`'s config; on Solid 2 a ward config key, given to `ward()` or the element.
   - Rejected: B, `hover: false` too, which Motion hasn't (the pointer is over both); C, `drag` too, which #29's innermost-drags rule and `dragPropagation` already cover.
2. **Keys propagate like the pointer** (Q2: A). A **Keyboard press** on a pressable element reaches its pressable ancestors, each pressed too, unless claimed, as Motion's synthetic down does. A key on something inside with no press of its own, a text field or a plain button, still presses none of them.
   - Rejected: B, keys pressing only the focused element, which leaves the keyboard and the mouse disagreeing.
3. **Presses only** (Q3: A). A Press claim stops ancestors' presses and nothing else: grabbing a claiming button on a draggable card still drags the card, and the button's press ends without a tap. A **Drag claim** (ADR-0019, *Amendment (#29)*) stays its own.
   - Rejected: B, a press claim blocking ancestors' drags from that down too.

**Defaults, stated:**
- **Only a press claims:** an element with `whileTap` or a tap callback (Solid 2: a tap event asked for, or `whileTap`). `propagate` alone does nothing, as Motion's.
- **What's claimed:** the down or the key the press starts from. A press that doesn't start (a non-primary pointer, a drag active) claims nothing.
- **Read at each press's start**, not once at mount as Motion's, so a toggled `propagate` counts from the next press.
- **A propagated keyboard press** gives the ancestor's own centre as its point (ADR-0056, decision 4), taps at the key's release, and is cancelled when focus leaves the element the key came from, as Motion's synthetic `pointercancel` bubbles. Space the inner press took (for the page's response) doesn't stop it.

## Built

- **core** (`PressClaims.ts`): the page's **Press claims**, a `Context.Reference` shared by default, as **Drag activity** is, provided fresh by the test Environment. `mark(event, target, claimed)` notes a press's start; `markOf(event, target)` says `"none"`, `"pressed"` or `"claimed"`. A claim stays its target's, and a target never refuses itself: its own claim reads as `"pressed"`, so two presses on one element share it. Marks are kept in a `WeakMap` by the event's `raw`, the platform's event every target's copy carries, which core never reads; an Environment with no `raw` hands every target the same event, which keys it then.
- **core** (`Recognizer.watchPress`):
  - **`PressOptions.propagate`**: a boolean, or a function read at each press's start; default `true`. Each press marks what it starts from, claimed when it doesn't propagate.
  - **A pointer's down** a press elsewhere claimed starts no press.
  - **A key** reaches the target's press when it's the target's own and untaken, as before, or comes from inside with a press there that didn't claim it (`reachesPress`), its `handled` not counted.
  - **A blur** at or inside the target cancels a keyboard press.
- **core** (`InputSource`): `FocusLikeEvent.fromTarget`, `false` for a focus or blur inside the target (absent: the target's own); `Recognizer.focus`, `whileFocus`'s, counts the target's own only, and so does a Reorder item's blur. The keyboard contract says a key reaches the targets it passed through innermost first.
- **dom** (`internal/input.ts`):
  - **Keys** go through one listener per window, which walks the event's path and hands it to each keyed target there, innermost first, as a pointer's down bubbles. A listener per target ran in the order the targets subscribed.
  - **Focus**: a target's own `focus` and `blur`, as before, and the `focusin` and `focusout` that bubble from inside, `fromTarget: false`.
- **solid**: `WardicPropagate` (`{ tap?: boolean }`) and `WardConfig.propagate`, a rare motion prop (#273) on Solid 1 and a ward config key on Solid 2, exported from both bindings. Each element's press reads `propagate.tap` at its start (`tapPropagates`, `watchPressOn`).
- **The storefront** (asked for after the build): the catalogue's cards (`/transitions/catalogue`) squeeze a little as they're pressed, and each has an "Add" on its photo's corner that puts the piece in the cart with `propagate={{ tap: false }}`, so pressing it, or Enter on it, doesn't squeeze the card. It sits beside the card's link, not in it: `propagate` keeps the card's press out, and a click inside the link would still open the piece. All three apps; the Next app's is Motion's own `propagate`, and the three measure the same on the previews.

## Tests

- `packages/test/test/press-claims.test.ts` (two targets, the inner one's events first):
  - PC1: the ledger's marks, a claim its target's, kept by `raw`.
  - PC2: a down inside presses both; claimed, the outer one doesn't, though a down on it alone does.
  - PC3: `propagate` read at each start.
  - PC4: a key from inside presses the outer target only from an unclaimed press inside, Space included; none from a plain element.
  - PC5: a blur from inside cancels it; `focus` counts the target's own.
- `packages/dom/test/input.browser.test.ts`: I18, keys innermost first whatever the subscription order; I19, focus and blur from inside with `fromTarget: false`, the target's own as before.
- `packages/solid/test/propagate.browser.test.tsx` (Solid 1, real mouse and keys): PR1–PR11, both pressed by default; a claim; a down on the outer one; three deep; a key reaching the outer one at its own centre; a claimed key; Space; a Tab away cancelling both; a draggable ancestor; `propagate` toggled; `createWard`'s config.
- `packages/solid/test/v2/propagate.browser.test.tsx` (Solid 2): PRV1–PRV4, `ward()`'s config, the element's prop, and keys.
- `keyboard-press.browser.test.tsx` KB5 now pins decision 2: Enter on a pressable button inside a pressable card presses both, on a plain button neither.

**Mutation-checked** (`.tmp/439/mutate.py`, run alone): 13 single-point mutations, 12 caught.
- A claimed down still pressing, `propagate` ignored, the binding never claiming (PR2, PR10, PR11, PRV2, PC2).
- A target refusing its own claim (PC1).
- Keys from inside never reaching, always reaching, reaching when claimed, or stopped by the inner press's take of Space (PR5–PR7, KB5, PRV4, PC4).
- Keys outermost first (I18, KB5, PR5).
- No focus from inside, a blur inside not cancelling, `focus` counting focus inside (I19, PR8, PC5).
- **Equivalent:** a Reorder item judging blurs from inside. An item lifts only from its own keys, and focus moving into it drops the lift at its own blur, so no blur from inside comes while it's lifted; the filter only skips a judgement that would return at once.

## Consequences

- **Behaviour change:** a key on a pressable element now presses its pressable ancestors too. An app that relied on the old rule gives the inner element `propagate={{ tap: false }}`, which also stops the mouse's.
- **Every keyed target on a window shares one listener**, and every focus target listens for `focusin` and `focusout` too: one call per key per target it passes through, and a focus move inside a focus target reaches it, which only a keyboard press reads.
