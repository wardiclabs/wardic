# Measured pairs

Motion animates a positional value whose two keyframes differ in type, `height: "auto"` (the accordion), `width: "50%"` from a px width, `x: "100%"`, by measuring them (`animation/keyframes/DOMKeyframesResolver.ts`, `.reference/motion` at `16c6122`):
- **When:** `readKeyframes` finds the two types differ on a key of `positionalKeys` with a measurement (`utils/unit-conversion.ts`, `positionalValues`).
- **How:** `measureInitialState` reads the start in px and sets the value to its target; a render; `measureEndState` reads the target in px and sets the start back.
- **The batch:** every resolver of a frame measures in one batch, its writes and reads apart (`KeyframesResolver.ts`, `measureAllKeyframes`), before the render, with the page's scroll kept (`suspendedScrollY`).
- **The run:** the animation runs px to px, and its last frame writes the target as given (`finalKeyframe`), so `auto` follows its content afterwards.
- **Keyframes:** only two are measured; more that mix types aren't (its TODO).

Wardic had none of it. A start that couldn't take its target's shape (`valueLike`: `auto` for a numeric target, a length in another unit) fell back to its start links and then to its target, so the key switched at its leg's first frame (ADR-0024's switch, ADR-0022's links). #430 is the fourth of 1.0's Motion-parity gaps (#426).

## Decisions (grilled 2026-10-28, Q1–Q4 each A)

1. **Motion's positional keys** (Q1): `width`, `height`, `top`, `left`, `right`, `bottom`, `x`, `y` (`translateX`, `translateY`), when the start and the target differ in type. The types are `auto`, a `calc()` or `var()` on one side, `%` against px, `em`, `vh` and the rest. Both ends are measured in px, and the leg runs between them. Two stops only: Keyframes of more that mix types switch, as Motion's do. Every other key keeps ADR-0024's switch for two units. Rejected: B, `width`/`height` with `auto` only; C, `width`/`height` with any two units.
2. **Batched at the end of the task** (Q2), in ADR-0018's microtask timing, as Motion's `measureAllKeyframes`:
   - every start read;
   - every target written inline;
   - the page laid out once, and every target read;
   - every style restored.

   The legs start from px at their first frame. Nothing paints the target, and a `ResizeObserver` never reports it. A key read from the box (`right`, `bottom`) is read with the element's transform off, as Motion takes its non-translate transforms off. Rejected: B, a read at each Retarget, a layout an element.
3. **Landing on the target as given** (Q3): the last frame writes `auto`, `50%` or the `calc()`, Motion's `finalKeyframe`, and the Snapshot holds it, so closing again measures `auto` as its start. Rejected: B, landing at the px; C, re-measuring mid-leg and chasing.
4. **A `layout` element animating its own size** fought its projection on `main`: its own bug, #453, fixed first (ADR-0018, *Amendment (#453)*), which the accordion inherits (Q4).

**Defaults, stated rather than asked:**
- **The server:** a key to or from `auto` can't play before hydration, as before (ADR-0044's `unplayable`), so its element keeps its Starting style until mount.
- **An interrupted leg** starts from the px it's drawn at, so only a target of another type is measured again.
- **Reduced motion:** a Measured pair is positional, so it snaps to its target as given, nothing measured. A transition that opts out of reduced motion leaves its pairs switching (ADR-0024).

**Settled in the build:**
- **An end already in px is taken as given,** a number or a px length; only `auto`, a percentage, a `calc()` or another unit is read from the layout.
  - **A divergence from Motion:** Motion's `measureInitialState` reads the element for the start whatever it is, so `[0, "auto"]` on a key resting at `auto` starts from its current height there. Here it starts at its first stop, 0, as Keyframes' explicit first stop does everywhere else (ADR-0058, Q2). MS5 pins it.
  - **What it saves:** a target in px (an accordion closing to 0) is never written to be read.

## Built

- **dom** (`internal/measured-pairs.ts`, `@wardic/dom/MeasuredPair`):
  - **`isMeasuredPair(key, from, to)`:** a measurable key whose two ends are lengths, `auto` or a `calc()` of different types. A number and a px length are one type. A number makes nothing, so `x` and `y`, on nearly every element, ask cheaply.
  - **`measure(element, pairs, values)`:** queues the pairs for the end-of-task batch and returns each pair's handle, its `fromPx` and `toPx` filled in by the batch.
  - **The batch reads** a size from the computed style, which a transform doesn't change, else from the box, as Motion's `measureDimension` does for an element with no box of its own. It reads an inset from the computed style, else, for `right` and `bottom`, Motion's sum of the opposite inset and the box. A translate comes from the computed transform's matrix.
  - **The batch writes** a translate's target through the element's whole transform (dom's `project` over the values it draws), and a length's target as its CSS. The page's scroll is put back if a target moved it.
- **`valueLike`'s miss** (`own-values.ts`): a start that can't take its target's shape keeps its value, rather than falling back to its links, when the two make a Measured pair (the spine's `keepsStart`).
- **The Retarget** (`spine.ts`):
  - **Finding them:** it finds its Measured pairs in its per-key pass, so a Retarget with none builds nothing for them. Keyframes of two stops are checked again once their first stop is the start.
  - **Asking:** unless reduced motion is on, it asks the batch.
  - **Exits** (`presence-controller.ts`) ask it too, so an accordion's `exit={{ height: 0 }}` from `auto` animates.
- **The legs** (`retarget-legs.ts`):
  - **Its own leg:** a Measured pair runs on its transition, in a leg of its own (`measuredLegOf`), whose machine makes its step at its first step, a tick after the batch.
  - **The run:** a tween runs a 0 → 1 progress on `keyframes`' options, so `times`, an `ease` per Segment and the Modifiers apply. A spring springs the px.
  - **The landing:** the last frame writes each target as given, or each start as given when a turned `repeat` ends there.
  - **A failed read:** a pair its batch couldn't read switches.

## Tests

- **Solid 1** (`measured-pairs.browser.test.tsx`), MS1–MS8:
  - MS1: the accordion opening through the px between, with no frame or `ResizeObserver` delivery at its full height first, landed on `height: auto` and growing with content added later;
  - MS2: closing from its height with no jump, and re-opened mid-close from where it is;
  - MS3: `width: "50%"` from 120px, then following its container;
  - MS4: `x: "100%"` sliding by its own width, on a tween and on a transform's Default transition, a spring;
  - MS5: Keyframes `[0, "auto"]`, from a key resting at `auto`, starting at its first stop;
  - MS6: reduced motion's snap;
  - MS7: an exit from `auto`;
  - MS8: twenty opened in one task, each to its own height.
- **Solid 2** (`v2/measured-pairs.browser.test.tsx`), MW1: `next("settled")` landing on `{ height: "auto" }`.

**Mutation-checked** (`.tmp/430/mutate.py`): ten single-point mutations, each caught by the tests meant for it:
- the start falling back as on `main`, and no Measured pair at all;
- landing at the px, on a tween or a spring;
- an exit not measuring;
- two-stop Keyframes not checked once their stops resolve;
- targets not restored, or read before they're written;
- a translate read from the box;
- a px start read from the layout, Motion's way.

Two first survived. A spring's landing was checked after an `until` that never throws, and MS5's first version had a start whose type already differed from its target's; both tests were tightened.

## Measured

`bench:solid` against `main` (`bbe877f`, 11 paired reps) passed on both bindings, with the noise control at −0.3%. The workload has no Measured pair, so these numbers are only the per-key check's cost.

| warm, against `main` | Solid 1 | Solid 2 |
|---|---|---|
| Retarget | −0.4% | +2.7% |
| at-rest Retarget | +0.6% | +0.9% |
| bytes per element | +1.0% | +1.0% |

The layout scenes and retained memory are flat. The bytes aren't attributed; `.tmp/452`'s probe can attribute them.
