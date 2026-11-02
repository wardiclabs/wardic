# Transition end

Motion's targets take a `transitionEnd`: values set at once, with no animation, once the animation to the target ends (`.reference/motion` at `16c6122`).
- **When:** `animateTarget` splits it off the target and sets it once `Promise.all` of the target's own animations resolves, on the next frame; at once with nothing to animate (`motion-dom/src/animation/interfaces/visual-element-target.ts`).
- **Interruption:** a stopped animation never resolves its promise (`JSAnimation.stop` tears down without `notifyFinished`). So an interrupted target never sets its `transitionEnd`.
- **Layers:** its keys are its layer's (`animation-state.ts` folds `{ ...target, ...transitionEnd }`), so a higher layer's value wins over them, and a layer turned off returns them to their base.
- **First render:** the target an element renders first applies its `transitionEnd` at once (`use-visual-state.ts`), so a server renders it.

Wardic had none. A target's keys all animated, and dom's `visibility` Key rule (ADR-0024, decision 4) held `display` and `visibility` only until their own leg's end. #428 is the second of 1.0's Motion-parity gaps (#426).

## Decisions (grilled 2026-10-28, Q1–Q4 each A)

1. **A target's `transitionEnd` applies when that target's own keys land** (Q1), as Motion's does.
   - **Other entries' keys** running on don't hold it back: a hover's sets `cursor` as the hover's scale lands, while a longer entrance runs on.
   - **A target whose keys carry across later Retargets** (#325) still applies it, unless its own target changed, which drops it.
   - **A target interrupted** before it lands never applies it.
   - **A target with nothing to animate** applies it at once.

   Rejected: B, waiting for the whole Retarget's landing.
2. **Its keys belong to the target's entry in the Override stack** (Q2), as Motion's. Before the landing a key keeps its previous value, then takes its end value. A higher entry's value wins over it, and when the entry goes inactive the key returns to its Base value (ADR-0022). Rejected: B, written once and kept.
3. **The first target's `transitionEnd` joins its Starting style** (Q3): `initial`'s, or `animate`'s with `initial={false}`. A server renders it, and a hydration finds it: a closed panel renders hidden. With an Appear animation (ADR-0044), the server's CSS plays the entrance, and the client applies `animate`'s at the landing it takes over. Rejected: B, never at first render.
4. **The landing includes it** (Q4). A Retarget lands only once its targets' `transitionEnd` values are written:
   - `settled()`, `next("settled")` and Solid 1's `onAnimationComplete` see them;
   - the landing's `target` has them.

   Motion tells `onAnimationComplete` first and writes on the next frame. Rejected: B, Motion's order.

**Defaults, stated rather than asked:**
- **Where it's allowed:** every target (`initial`, `animate`, `exit`, each `while*`, every variant and a dynamic variant's result), on both bindings and `use:wardic`.
- **Types:** a typo in it is an error (#305). Its keys aren't animated keys for the transition-entry check: an entry for a key only `transitionEnd` sets never runs, so it's rejected. `read(key)` offers them.
- **Reduced motion:** a target whose keys snap lands at once, and its `transitionEnd` applies then.
- **`display` and `visibility`:** dom's `visibility` Key rule is unchanged.
- **An exit's:** an exit's `transitionEnd` isn't applied. The element leaves when its exit lands, so there's nothing to see it on.

## Built

- **Types** (`config.ts`):
  - `WardicTransitionEnd` (a values map without `transition`), on both arms of `WardicVariant`;
  - `ward-keys.ts` skips `transitionEnd` as a value name and checks its own map's names. `read()`'s keys include its keys (`AnimatedKey`); the transition check's don't (`DrivenKey`).
  - For #305's inference, `TargetKey` takes `"transitionEnd"`, so a target with one doesn't widen `K`.
- **A target** (`variant-target.ts`) is `{ values, transition, transitionEnd }`. `transitionEnd` is split off as `transition` is, and merged a later name's over an earlier's in a list (#297).
- **The Override stack** (`spine.ts`): each Layer carries its target's `ends`.
  - **Resolution:** when an active layer has ends, `resolvedOf` resolves the stack over each layer's ends and values, its values winning a key both set. So a key only an end sets is the layer's, highest active layer first, as any key.
  - **What a Resolution keeps:** its `Ends`, each end-only key with the layer that drives it, and each layer's end values for the keys it drives.
  - **Groups:** `keysByLayerOf` puts an end-only key in its layer's group.
  - **The common case,** no end, resolves as before and allocates nothing for it.
- **The Retarget:** an end-only key starts no leg of its own. Each layer whose end starts anew gets an end leg, built in the spine, not in `legsOf`, so a server's Appear sampling never sees it:
  - **What it owns:** its end-only keys, through the `owners` map. So a later Retarget carries it when their values are the same and gives them up when not (#325), and a given-up end never writes.
  - **The hold:** it holds its keys where they are. A key with nothing to start from (it would start at its target) is left unset until its end.
  - **The wait:** it waits, a gate machine read each frame, until the legs drawing the layer's animated keys are all done, whether this Retarget's or carried.
  - **The write:** then it writes its end values in one frame, the keys the layer also animates among them (`{ x: 100, transitionEnd: { x: 0 } }` animates, then rests at 0).
  - **The landing:** it counts toward the landing, so the landing includes it (Q4).
- **The first render** (`variant-tree.ts`, `startingValuesOf`): the first target's `transitionEnd`, resolved as any target, is merged into the Starting style's values. They're the client's seed, the server's markup and the start's Base-value links.

## Tests

- **Solid 1** (`transition-end.browser.test.tsx`), TE1–TE9:
  - TE1: closing fades displayed, then hides, `onAnimationComplete` already seeing it; reopening shows at once;
  - TE2: a hover's end waits for the hover's keys alone;
  - TE3: a press's end wins over a hover's, the hover's comes back, and leaving returns the key to its `style`;
  - TE4: an interrupted target never sets its end, nor does a new target with none;
  - TE5: the first target's end before any frame;
  - TE6: nothing to animate;
  - TE7: a key both animated and ended;
  - TE8: an entrance's end carried past a hover's Retarget;
  - TE9: a variant's and a list's.
- **Solid 1's server** (`transition-end.ssr.test.tsx`), TS1–TS4:
  - `initial`'s end in the markup;
  - with `initial={false}`, `animate`'s, through a name and on `createWard`;
  - after an `initial`, the client's;
  - a list rendered first, its later name's end winning.
- **Solid 2** (`v2/transition-end.browser.test.tsx`, ET1–ET3; `v2/transition-end.ssr.test.tsx`, ET4):
  - `next("settled")` resolving with the element hidden and the end in its `target`;
  - `settled()` pending until the end is set;
  - a `wardic.div`'s;
  - the server's markup.
- **Types:** IK8, KI8, TK9 and WK8.

**Mutation-checked:** fourteen single-point mutations, each caught by the tests meant for it:
- ends never written, or written without waiting, or waiting for every key;
- end keys not the entry's;
- an end owning nothing, so an interrupted end still wrote;
- no end at first render;
- a key with nothing to start from held at its end;
- the landing not waiting for an end;
- an end writing only its end-only keys;
- a list's later end losing;
- `transitionEnd` read as a value name;
- its names unchecked;
- it widening #305's inferred keys;
- its keys read by no ward.

Two first versions were caught only by the type left unused, so they were rewritten to keep it used. E10 survived TE9, as a list's names resolve as separate entries, so TS4 pins the first render's merge.

**Found:** with `initial={false}`, an element's mount still runs a leg from each value to itself for its transition's duration, where Motion skips a value already at its target. A target change in that time waits for it, its `transitionEnd` included. TE6 waits for rest. *Fixed by #448* (ADR-0005, *Amendment (#448)*): a quiet mount starts no leg, and TE6 no longer waits.

## Note (#470, 2026-10-29): a new end alone is a new target

A change to a target's `transitionEnd` alone counts as a change, as Motion compares a target's `transitionEnd` with its values. A key only an end sets was a resolved value already. A key a layer both animates and ends now starts again when its end changes, from where it's drawn, and its end applies once it lands: `{ x: 100, transitionEnd: { x: 0 } }` to `transitionEnd: { x: 30 }` animates `x` back to 100 and rests at 30, as Motion's does. Before, Solid 2 compared nothing of it, and Solid 1 ran a Retarget whose `x`, its last Leg landed at 100, started nothing, so the new end was never set. See ADR-0046, *Amendment (#470)*; ST8 and STV4 pin it.
