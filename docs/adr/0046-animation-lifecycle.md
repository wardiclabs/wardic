# An animation's lifecycle: Motion's callbacks on Solid 1, async values on Solid 2

An app can now hear when an element's animation starts and when it lands. Solid 1 gets Motion's two props, `onAnimationStart` and `onAnimationComplete`. The Solid 2 binding gets no callbacks; it hands the same facts over as async values (#257, item 1). Both read one signal from the shared spine: each Retarget's start, and its last leg's settle.

It lands in four PRs:
1. The spine's signal and Solid 1's callbacks (this ADR's *Built (PR 1)*).
2. Solid 2's `card.settled()` and `card.next(name)`, with the gesture events.
3. Solid 2's layout callbacks moving to async.
4. Presence exits, on both bindings.

## Why

- **Motion has the callbacks.** `onAnimationStart(definition)` and `onAnimationComplete(definition)` are public props (`.reference/motion` at `16c6122`: `packages/motion-dom/src/node/types.ts:286-313`). `animateVisualElement` notifies the start before it animates and the complete once every value's animation has finished (`animation/interfaces/visual-element.ts:13` and `:35`). A variant's children are told with the variant's name (`visual-element-variant.ts:90` and `:104`).
- **Wardic had no way to hear an animation land,** short of watching `onUpdate` for the target. The only settle points were the layout callbacks (ADR-0039) and `animateLayout`'s `onSettled`.
- **Solid 2 has async values.** A memo can hold a promise, `isPending` says whether it's settling, and `<Loading>` holds UI until it resolves. On Solid 2, "animating" can be a pending value and "landed" can be its resolution, and gesture events can be chained with `await` rather than nested callbacks.

## Decisions (grilled 2026-10-21)

1. **Split by binding.** Solid 1 gets Motion's two callbacks. Solid 2 gets async values only, with no callbacks: `card.settled()` and `card.next(name)`. Its layout callbacks move to async too (PR 3).
   - **`next(name)` names:** `dragStart`, `dragEnd`, `tap`, `tapCancel`, `hoverStart`, `hoverEnd`, `pressStart`, `settled`, and for layout `layoutStart` and `layoutComplete`.
   - **Gesture payloads** are Motion's info objects: `{ point, offset, velocity }` for a drag, `{ point }` for a tap, a press or a hover. No raw DOM event.
   - `next("dragEnd")` on a ward that doesn't drag never resolves. It rejects at unmount.
2. **The definition (Q1): Motion's on Solid 1, richer on Solid 2.** Solid 1's callbacks take Motion's `definition`: a variant name, or the target values. Solid 2's `settled()` resolves to `{ definition, target, gestures }`.
3. **What counts (Q2): every Retarget, as in Motion.**
   - **Counted:** `animate` and variants, the entrance included, and each gesture layer (`whileHover`, `whileTap`, `whileFocus`, `whileInView`, `whileDrag`) turning on or off.
   - **A change that resolves the same target** (a `style` or `transition` change) starts nothing. That's Motion's rule, and Wardic's already (`sameResolution`).
   - **An interrupted animation doesn't complete.** The next Retarget starts again. Motion's `stop()` never resolves the animation's `finished` (`JSAnimation.ts:484-494`), so its complete never comes.
   - **Excluded:** a drag's momentum and its return, which aren't Retargets, and layout animations, which have their own callbacks (ADR-0039).
   - **A Retarget with nothing to animate** starts and completes at once.
4. **On unmount (Q3), Solid 2's pending values reject with a `DOMException` named `"AbortError"`,** as Web Animations' `finished` does on a cancel. On Solid 1, nothing is called.
5. **`animateLayout(fn)` on Solid 2 (Q4)** returns a promise of `fn`'s result, resolving once the flights its change started have landed. `fn` still runs at once, and a throw from it is still synchronous.
6. **Presence exits (Q5)** are the last PR. Solid 1 gets `<AnimatePresence onExitComplete>`. Solid 2 gets a presence handle through `ref`, with `exiting()` and `next("exitComplete")`.

## Built (PR 1)

- **The spine tells a Retarget's start and its settle** through `AnimationHooks`, an option of `makeElementSpine`.
  - **The start** is told once the Retarget's legs are on their way: after the `when` gate lets it start, in the Retarget's own task.
  - **The settle** is told when its last leg settles. A Superseded leg (#200) doesn't count, and neither does a leg that failed.
  - **The settle waits for the gate's flush.** It comes through `FlushGate.afterFlush`, so the element shows where it landed. A leg's last frame is written in the tick and committed at the tick's end; told at the leg's end, `onAnimationComplete` read an opacity of 0.972 for a target of 1. Motion's complete comes after its final value is set.
  - **`afterFlush(fn)`** is new on dom's `FlushGate`. It calls `fn` once after the gate's next flush, scheduling one if none is pending. A call that throws is reported (`wardic.gate: an afterFlush call failed`), and the rest still run. A disposed gate drops its waiting calls, and the inert gate never calls.
- **The definition:** the variant name the base layer resolved, when that name differs from the last started Retarget's; else the target values.
  - That's Motion's rule per animation type. A new `animate` variant animates as its name (`animation-state.ts:357-360`). A gesture turning on animates as its own values. A gesture turning off animates its keys back as a fallback of values (`animation-state.ts:405-434`). So a hover over a variant tells `{ opacity: 1 }` and then `{ opacity: 0.2 }`, not the variant's name.
  - **Two divergences:**
    - Wardic's values are the whole target, where Motion's fallback has only the keys the gesture left.
    - A variant change and a gesture in one task is one Retarget, with one start (the name), where Motion starts one animation per type.
- **The callbacks are read from the config the Retarget read,** as its `transition` is. A callback that throws is reported (`wardic.spine: onAnimationStart failed`), and the element animates on.
- **Solid 1's `wardic.*` props:** Motion's `onAnimationStart` replaces the DOM's CSS `animationstart` handler in their type, as on a Motion component, where it's a motion prop (`valid-prop.ts:22-23`) and never reaches the DOM.
- **On Solid 2,** neither name is a motion prop or a config key. `onAnimationStart` on a `wardic.div` is the DOM's CSS event, and the ward's own animations call neither. `MOTION_PROPS_V2` and `WardicMotionPropsV2` are the Solid 2 binding's lists.

## Consequences

- **New public API:**
  - Solid 1: `onAnimationStart` / `onAnimationComplete` on `WardConfig`, the `wardic.*` props and `createWard`'s config, and the `WardicAnimationDefinition` type;
  - dom: `FlushGate.afterFlush`.
- **Per Retarget:** two assignments and a guard, plus a read of each callback key when it starts and when it settles. A settle with hooks queues one call on the gate.

## Pinned by

- **solid:** `test/animation-callbacks.browser.test.tsx` AC1–AC11:
  - the entrance, landed at its value when told;
  - a variant's name;
  - an interrupted animation's missing complete;
  - a `style` change telling nothing;
  - a hover;
  - a callback that throws;
  - `createWard`'s config;
  - a Retarget to the same values, and one with nothing to animate;
  - two legs completing once;
  - a hover over a variant.
- **solid (Solid 2):** `test/v2/wardic.browser.test.tsx` WC11: `onAnimationStart` is the DOM's event.
- **dom:**
  - `test/gate.browser.test.ts` GA1–GA3: after the flush with the value committed, a flush of its own, a throw reported, and dropped at dispose;
  - `test/services.browser.test.ts` DS4: the inert gate's `afterFlush`.
