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

## Built: PR 2, both bindings

- **Types** (`config.ts`): `WardicKeyframes<V>`, a list of `V | null`, and `WardicTargetValues`, each key a value or its Keyframes (CSS's own `transition` string one value). Every target takes them: `WardicVariant`, so `animate`, `exit`, each `while*` and a variant, and `initial`; #305's checked and inferred targets too. `style` and a Transition end keep one value. A tween takes `Machine.KeyframesOptions`: `times`, and an `ease` per Segment.
- **The Starting style** (dom, `Style.valuesAt`, `Style.keyframesOf`): `resolveInitial` reads `initial`'s Keyframes at their first stop and, with `initial: false`, `animate`'s at their last that isn't `null`. A Keyframes value with no stop that isn't `null` drops out.
- **A target** (`variant-target.ts`) keeps each Keyframes key's last stop as its value, Motion's final keyframe, so the Override stack, a Base value and a Transition end read it as any target's, and its stops beside (`Target.keyframes`). A list's later name setting a key to one value ends an earlier name's Keyframes for it.
- **The Override stack** (`spine.ts`): each layer carries its target's Keyframes, and a Resolution each resolved key's (`KeyframesAt`: the stops, and the place and name of the layer that drives the key), made only when an active layer has some. `sameResolution` compares them, stop by stop.
- **The Retarget:**
  - **Carried:** a key carries on (#325) only toward the same `KeyframesAt`. So new stops, another layer driving the key (a hover over it ending) or a new name for its layer plays them again, where an equal list a re-render makes runs on, as Motion's `animation-state.ts` has it.
  - **Never there:** Keyframes are never already at their target (#448).
  - **A quiet mount:** an element whose mount starts at its `animate` (#448) keeps them where they start, as Motion animates nothing at that first render.
  - **The start** (`keyframesFrom`, shared with exits and the server): a first `null` stop is the key's Snapshot, coerced as any start is; a later one, the stop before. An explicit first stop is the key's start, so its leg jumps there, and a delayed or staggered one shows it through its delay. Two stops then run as a target from the first, so a spring keeps the key's velocity; more are handed to the legs.
- **The legs** (`retarget-legs.ts`):
  - With no transition defined, a key through more than two stops runs on its Environment's keyframes default.
  - A tween runs every key through `keyframesValues` when one has more than two stops, or its options have `times` or an `ease` per Segment, which `animateValues` doesn't take; a key without Keyframes as its two stops.
  - A spring given more than two stops snaps those keys to their last stop and adds a leg that fails as it's built with Motion's error, naming each key, its stops and the fix (`transition: { "x": { type: "tween" } }`). It's reported as any failed leg is (ADR-0030); Solid 2's waits reject with it, and Solid 1's `onAnimationComplete` isn't called.
  - Under reduced motion, a positional key's Keyframes snap to where their run would end: their last stop, or their first after a turned odd `repeat`.
- **Exits:** a presence exit carries its target's Keyframes (`PresenceExit.keyframes`) and starts from them as a Retarget does.
- **Appear** (ADR-0044): a mount animation carries its stops, part of its key, so the Handoff matches the client's spec. On a server, a Keyframes key always plays, never left out as at its target, unless its mount starts quiet, which the server now knows (`ServerElement.quiet`).
- **A layout transition** with an `ease` per Segment is passed to core as one, which rejects it: a layout animation has no stops.

**Found in the build:**
- **The server needed the quiet rule too.** `initial={false}` with Keyframes in `animate` rendered their last stop, then played them in CSS; AR22 caught it.
- **A tween's snap reads its `delay` alone,** through `resolveTween`: an `ease` per Segment isn't a tween's, and would have failed the snap.

### Tests (PR 2)

- **Solid 1** (`keyframes.browser.test.tsx`), KS1–KS11:
  - KS1: through their stops on a tween, landing on the last, told with its last stop;
  - KS2: Motion's 0.8 s default for three stops, and a transform's spring from the first of two;
  - KS3: `times` placing a stop;
  - KS4: a first `null` stop from where the key is, an explicit one jumped to;
  - KS5: a spring given three stops: reported once, naming the key and the fix, landed on its last stop, never told complete;
  - KS6: an equal list a re-render makes runs on; a new variant name, or a list's change that moves the same name to another layer, plays them again;
  - KS7: a hover over a repeating pulse ending: from its first stop, pulsing again;
  - KS8: `initial={false}` drawn at `animate`'s last stop, nothing played or told; an `initial`'s first stop;
  - KS9: reduced motion snapping a positional key to its last stop;
  - KS10: an exit's Keyframes, and an exit list's later name ending an earlier one's;
  - KS11: new stops with the same last one playing again, and a list's later name's one value ending an earlier name's Keyframes.
- **Solid 2** (`v2/keyframes.browser.test.tsx`), KW1–KW4: `next("settled")` at the last stop; it rejecting with the spring error; `initial: false` landing nothing; new stops with the same last one a new target (`sameResolution`).
- **The server:** AR22 (`appear.ssr.test.tsx`): the rule through every stop, a first `null` one from `initial`; Keyframes ending at `initial`'s value still played; two lists differing in their middle stop, two rules; `initial`'s first stop and `initial={false}`'s last in the markup, with no rule.
- **The Handoff:** AH14 (`appear.hydrate.browser.test.tsx`, fixture A10): handed off mid-flight, on `keyframesValues`' machine throughout.
- **dom:** ST1b (`starting-style.node.test.ts`): `valuesAt` and `keyframesOf`, and `resolveInitial`'s first and last stops.
- **Types:** IK9 (`wardic.*`, `createWard`) and TK10 (`ward()`): Keyframes on every target, `times` and an `ease` per Segment, their keys the element's; none in `style` or a Transition end.
- **Changed:** `v2/lifecycle.browser.test.tsx`'s hand-built resolutions carry `keyframes`.

**Mutation-checked** (`.tmp/429/mutate2.py`): twenty-one single-point mutations, each caught by the tests meant for it:
- Keyframes carried whatever they are, or counted as already there;
- a quiet mount playing them, on the client or the server;
- a first `null` stop from 0, an explicit first stop not jumped to, or two stops not run from the first;
- no keyframes default;
- a tween's Keyframes run as a target, or a spring's run with no error, or with no snap;
- `sameResolution` ignoring them;
- a `KeyframesAt`'s layer place, or its name, dropped, or its stops compared by identity;
- the server leaving Keyframes at `initial`'s value out, or a mount's key without its stops;
- `initial` read at its last stop, and `valuesAt` reading any array;
- an exit's Keyframes dropped;
- and a list's later name's one value keeping an earlier name's Keyframes, which first survived: lists resolve a layer a name, so only an exit list reads the merged target. KS10 pins it.

### Measured (PR 2)

`bench:solid` against `main` (`8343627`, 1,000 elements, 11 paired reps) passed on both bindings, with the noise control at +0.1%. The workload has no Keyframes, so these numbers are only the checks' cost.

| warm, change against `main` | Solid 1 | Solid 2 |
|---|---|---|
| mount | +0.1% | −1.1% |
| Retarget | +3.2% [−0.2% – +3.5%] | +2.7% [−0.1% – +4.3%] |
| at-rest Retarget | +2.0% | +1.8% |
| bytes per element per round | +2.3% | +2.2% |

Retained memory and the layout scenes are flat.

The bytes aren't attributed, as `.tmp/87/alloc.ts`' page copy is stale (#448). One candidate: a target's resolution now asks twice whether it has Keyframes, once each in `Style.valuesAt` and `Style.keyframesOf`, and Effect's `Record.some` builds an `Object.keys` array each time.
