# Keyframes

Motion's targets take a list of stops, keyframes, wherever they take a value: `animate={{ scale: [1, 1.2, 1] }}` (`.reference/motion` at `16c6122`).
- **A plain target is two stops:** `animateMotionValue` runs `x: 100` as `[null, 100]` (`motion-dom/src/animation/interfaces/motion-value.ts`). A first `null` is the value now; a later one repeats the stop before it (`keyframes/utils/fill-wildcards.ts`).
- **Its default transition:** more than two stops, with no transition defined, run `keyframesTransition`, a 0.8 s tween, each Segment on the `easeOut` `animateMotionValue` gives every value first (`utils/default-transitions.ts`). Two keep the key's own default: `x: [0, 100]` springs.
- **Springs take two stops:** a spring or inertia given more is a development error, "Only two keyframes currently supported with spring and inertia animations" (`JSAnimation.ts`); in production it springs from the first to the last.
- **The run:** `times` places each stop, used only when there's one per stop (`generators/keyframes.ts`); `ease` may be one per Segment; `repeat`, `repeatType` and `repeatDelay` run the whole sequence, a `"mirror"` pass through the stops reversed on the same easings and `times`.
- **Never already there:** `visual-element-target.ts` skips a value at its target only when the target isn't an array (#448).
- **When it plays again** (`render/utils/animation-state.ts`): an equal array, stop by stop (`shallowCompare`), doesn't, unless the variant changed, or a higher type over the key went inactive (`removedKeys`), when the type below plays it again.
- **`initial`:** an array there renders its first stop, or `animate`'s last when the initial animation is blocked (`framer-motion/src/motion/utils/use-visual-state.ts`).

Wardic had a keyframes machine, `Machine.keyframes`, through numbers, evenly spaced, with no `times` or repeat, and nothing used it. A binding's values took one value a key, and the DOM's Default transition (ADR-0051) had no keyframes default to apply. #429 is the third of 1.0's Motion-parity gaps (#426).

## Decisions (grilled 2026-10-28, Q1–Q6 each A)

1. **Keyframes go wherever Motion's do, on both bindings** (Q1): `animate`, `exit`, every `while*`, variants (named and function), and `initial`. `initial`'s renders its first stop, or `animate`'s last when the mount starts at its `animate` (`initial={false}`, a presence's). `style` and `transitionEnd` keep one value. A target key's type is `V | readonly (V | null)[]`; #305's inferred entries are unaffected. Rejected: B, `animate` and variants first; C, none in `initial`.
2. **The first stop is Motion's** (Q2). A first `null` is where the key is, its Snapshot, mid-flight included; a later `null` repeats the stop before it. An explicit first stop is jumped to when its Leg starts, so a delayed or staggered key shows it through its delay. Two stops on a spring keep the key's velocity. Rejected: B, never jumping.
3. **Transitions are Motion's** (Q3). A key with no transition defined runs more than two stops on the Environment's keyframes default, the DOM's Motion's 0.8 s `easeOut` tween; two stops run on the key's own. A spring (or #435's inertia) given more than two stops is Motion's development error: the Retarget fails as a failed Leg does (#257 item 4), reported (ADR-0030), naming the key and the fix, and the key lands on its last stop. Rejected: B, a quiet tween; C, a spring per Segment.
4. **Replays are Motion's** (Q4). Equal Keyframes, stop by stop, are a Carried key (#325). A gesture's entry over the key going inactive plays the Keyframes under it again from their first stop, so a repeating pulse under a hover resumes; a variant change that resolves equal Keyframes plays them again. Rejected: B, playing only when the stops change.
5. **They run in core's Machine** (Q5). `Machine.keyframes` takes `times` and `animate`'s Modifiers, and `Machine.keyframesValues` runs a bag of keys, each through its own stops, on one run through the `InterpolatorRegistry`. Appear samples it as any machine, and #433's `animate()` reuses it. Stops that can't blend fail as such a pair does; Motion's measured unit conversion between stops goes with #430. Rejected: B, in the binding.
6. **Two PRs** (Q6): core and dom first (the machine, the Default transition's keyframes entry, `bench:core`); then both bindings, closing #429. Rejected: B, one PR.

**Not changed:** a Wardic tween passes no velocity to a spring that takes over from it, where Motion samples the value's. That's true of every tween, Keyframes included.

## Built: PR 1, core and dom

- **The run** (`internal/stepper.ts`): `passAt` reads where a run is in its pass, how far into it, whether its time runs backwards and whether it reads its stops from last to first, written in place once a frame. It's `runAt`'s pass math, so `animate`'s repeats now go through it too, their arithmetic unchanged. `stopTimesOf` gives each stop's time in a pass, in seconds, as Motion's `convertOffsetToTimes` does; evenly spaced stops are a whole number of Segments in. `segmentAt` gives the Segment a pass is in (Motion's `interpolate`: the first whose end it hasn't reached), and `segmentProgress` how far through it, all of a Segment with no length.
  - **Seconds, not fractions:** a first version placed the stops by fractions of the pass. `delay-once`'s keyframes test caught 1/3 of 0.75 s landing a 10 at 9.999999999999998.
- **`Machine.keyframes`** takes `times` and the Modifiers. `reverse` reads the stops from last to first, as it swaps `animate`'s ends. A single stop holds, and none holds at 0, as before.
- **`Machine.keyframesValues`** builds a blender for each Segment of each key, through `blenderFor`, the pair blender `blendersFor` now shares. A run that can read its stops from last to first builds a second set for that way, as Motion's mirrored generator builds its own mixers. Each key has its own stops and places; a key with none is left out.
- **The bag** (`KeyframesOptions`): `animate`'s Modifier fields and run are shared (`ModifierFields`, `resolvedRunOf`). `times` decodes as numbers from 0 to 1, in order. Motion takes any, but a stop placed out of order or past the end has no defined place.
- **The Default transition** gains `keyframes`, one for every key, as Motion's is: the DOM's `{ type: "tween", duration: 0.8, ease: "easeOut" }`, and core's `oneSpring`'s `ONE_TWEEN`, core's own tween (0.3 s, linear). The bindings' server Default transitions carry theirs; nothing reads it until PR 2.
- **The lint:** `internal/stepper.ts` joins the per-frame files that keep a loop, for the Segment search.

## Tests

- **`keyframes.test.ts`**, KF1–KF13, against motion-dom 14.6.0's `JSAnimation`, sampled (`.tmp/429/motion-ref.cjs`): even spacing, `times` and `times` of another length, an `ease` per Segment, a Segment with no length (the last one too), `repeat` with `repeatDelay` looped, reversed and mirrored, `reverse`, an infinite run, one stop and none; `keyframesValues` through unit strings, with `times` per key, against `keyframes`, and with a Discrete pair; `delay` once.
- **`options.test.ts`:** `times` out of range, out of order or NaN, a fractional `repeat` and an unknown `repeatType` are rejected, naming the field.
- **`tween-duration.test.ts`:** a missing `duration` is 0.3 s for `keyframesValues` too; the span carries the Modifiers.
- **dom's `default-transition.node.test.ts`**, DD5: the keyframes default is Motion's, sampled; DD3 and DD4 provide it.

**Mutation-checked** (`.tmp/429/mutate.py`): eighteen single-point mutations, each caught by the tests meant for it:
- `reverse`, a `"mirror"` pass or a `"reverse"` pass ignored, the last in `keyframes` alone or in `runAt` too;
- `times` ignored, or used at any length;
- a stop's time read as the Segment before's, and a Segment with no length starting rather than ending;
- one `ease` for every Segment;
- a bag reading its stops forwards on a flipped pass;
- `times` unchecked, or unordered;
- `keyframes` without the Modifiers;
- a key with no stops kept, and one stop not holding;
- the DOM's keyframes default at 0.3 s;
- and in `runAt`: a pass's end read as the next's start, and a reversed pass run forwards.

## Measured

`bench:core` against `main` (`1401894`), 1,000 elements, 11 paired reps: it passed on every engine, with the noise control at +2.4% in Bun, +1.2% in Node and −1.4% in Chromium. `animate`'s repeats, which now go through `passAt`, are within noise. `animateRepeat/loop` is +5.0% [+1.3% – +9.3%] in Bun, at the gate but not past it, where Bun's noise control spans −5.5% to +3.9%; it's −0.7% in Node and −1.6% in Chromium. Node's bytes per frame are unchanged.

The new `keyframesValues` workload is the string workloads' four keys through three stops, with `times`, an `ease` per Segment and an infinite mirrored repeat. It's reported as new, not gated, so the bindings' PR has a base:

| per frame, 1,000 elements | Bun | Node | Chromium |
|---|---|---|---|
| `animateRepeat/loop` (one Segment) | 0.39 ms | 0.44 ms | 0.31 ms |
| `keyframesValues/loop` (two Segments) | 0.48 ms | 0.68 ms | 0.41 ms |

Node allocates 0.85 MB a frame for it, against `animateRepeat/loop`'s 0.80: the Frame's values, as `animateValues`' are.
