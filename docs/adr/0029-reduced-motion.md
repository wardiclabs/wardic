# Reduced motion snaps an animation's positional keys, on by default

The bindings honour the user's `prefers-reduced-motion` (#98). Under it, an animation's **Positional keys** (its transforms, and the box's position and size) **Snap**: they land where the animation would end. Its other keys (opacity, colour, filters) animate as they would, and a layout animation lands on its new box at once. It's on by default. An app sets it on the provider, and a transition opts out on its own. Core's `ReducedMotion` module holds the DOM-free policy and the Snap, and the binding applies it when each run starts.

This replaces CONTEXT.md's earlier resolution, which nothing applied: a Stream combinator that snapped every key. `ReducedMotion.respect` is removed, which supersedes ADR-0028's `ReducedMotion` row (decision 12).

## Why

- **The glossary promised what no binding did.** CONTEXT.md's *Flagged ambiguities* said the bindings apply a `respectReducedMotion` combinator by default, and none imported it (found in #93's grill, ADR-0028 decision 12). `createReducedMotion` exposed the preference as a signal, and the combinator's only callers were its tests.
- **A Stream combinator can't reach the binding's runs.** Since #74 the binding runs machines on the Frame loop (ADR-0027): the spine's legs, presence's exit and the projection's coordinator.
- **Its snap didn't snap.** Under the preference it ran the whole Stream to its last Frame (`Stream.runLast`) before emitting. Driven by the Clock, the "snap" landed when the animation would have ended.
- **What Motion does,** at 16c6122:
  - **Setting:** `MotionConfig`'s `reducedMotion` is `"user"`, `"always"` or `"never"`. Its default is `"never"` (`MotionConfigContext.tsx:72`), and an element resolves it once, at mount (`VisualElement.ts:472-480`).
  - **What snaps:** under it, an animation's `positionalKeys` (the transforms, and `width`, `height`, `top`, `left`, `right`, `bottom`) run with `type: false`, an instant animation. Every other key animates (`visual-element-target.ts:138-150`, `keys-position.ts`).
  - **Delay:** an instant animation keeps its delay (`motion-value.ts:89-98`), and lands on its final keyframe (`getFinalKeyframe`).
  - **Layout animations** snap with their delay zeroed (`create-projection-node.ts:567-573`).
  - **Drag's release** (inertia, snap to origin) doesn't consult it (`VisualElementDragControls.ts:458-530`).

## Decisions (with the maintainer, 2026-10-10)

1. **On by default, with an app-wide setting and a per-transition opt-out.**
   - `WardicProvider` takes `reducedMotion: "user" | "always" | "never"`, Motion's names. Its default is `"user"`, not Motion's `"never"`: accessibility first, as the glossary had it.
   - A transition opts out with `respectReducedMotion: false`, on both arms. A layout element reads its own transition's opt-out.
   - Presence's exit has no transition, so it follows the provider alone.
2. **Positional keys only, Motion's rule.** These snap:
   - the transforms, which are `BaseValue.TRANSFORM_IDENTITY`'s keys;
   - `width`, `height`, `top`, `left`, `right` and `bottom`.
   - *Since ADR-0036 these six are the DOM Environment's (`@wardic/dom`'s `PositionalKeysDomLive`); core names only the transforms, through the `ReducedMotion.PositionalKeys` service.*

   Opacity, colours, filters and shadows animate: a fade moves nothing.
3. **Reach.**
   - **Reduced:** the spine's legs; presence's exit; layout animations (a crossfade's new Lead, a Switch seed, a box change, a promote).
   - **Not reduced:** drag's release, meaning snap-to-origin's spring, momentum's decay, and the projection's FLIP from a dragged position back to the slot. It continues the user's own gesture, as Motion's release does. *Since ADR-0016's Amendment (#140) all three run on the drag transition, Motion's inertia; still not reduced.*
4. **The binding snaps; core holds the policy.**
   - `ReducedMotion` becomes `Config`, `applies`, `POSITIONAL_KEYS` and `isPositional`, `split`, `endOf` and `snap`.
   - The binding runs a run's positional keys as one Snap leg beside its usual legs.
   - `ReducedMotion.respect` is removed, with no alias, as in ADR-0028's slices.
5. **A Snap waits out its leg's delay, Motion's way.**
   - It holds the key where it is through the delay the leg would hold, stagger included.
   - It lands on the tick a `Machine.delay` of the same length starts its run, so it lands with the keys that fade in.
   - A layout animation lands at once. Its spring starts at 1 and at rest, so a delay in its transition only keeps the node active, at its new box, until the delay passes. Motion zeroes that delay.
6. **Where a Snap lands.**
   - For a spring, its target.
   - For a tween, `ReducedMotion.endOf`, Motion's `getFinalKeyframe`: `to`, or `from` with `reverse`. `yoyo` with an odd finite `repeat` swaps it again. A run that repeats forever lands where its first run does.
   - The tween's end follows the options the tween actually runs with.
7. **When it's read.**
   - At each run's start: each Retarget's legs, each exit, and each layout animation's (re)start. A change applies from the next one, and a run in flight keeps going. Motion reads it once per element, at mount.
   - The provider's setting is read untracked, so changing it never Retargets.

## Consequences

- **Under reduced motion, a positional key costs one leg:** one Frame, or the held Frames through its delay. A layout animation settles at its Priming step.
- **Breaking:** `ReducedMotion.respect` is gone. Core is unpublished.
- **CONTEXT.md** gains **Positional key** and **Snap**, and its flagged ambiguity is resolved again. `createReducedMotion`'s comment ("animations honour the preference either way") now holds.
- **Found here, fixed in #107:** a tween transition with no `duration` ran on `animateValues`' defaults, which dropped its `delay`, `easing`, `repeat` and `yoyo`, and a stagger (`use-wardic.tsx`, `UndefinedOr.map(options.duration, …)`). A tween's `duration` is now optional in core (0.3 s when it's missing), and the spine passes its options, so the Snap's delay, as they are.

## Implementation in #98

### Core (`f096a04`)

`packages/core/src/ReducedMotion.ts`:
- `Config`, and `applies(config, prefersReducedMotion)` as a `Match`.
- `POSITIONAL_KEYS`, `isPositional`, and `split`, which returns `{ positional, rest }`.
- `endOf(from, to, modifiers)`.
- `snap(from, to, { delay })`: a leaf built with `Machine.make`, which holds `from`, then settles at `to`. Its hold counts at most `MAX_DT` per tick, as `Machine.delay`'s does, and its span is `wardic.reducedMotion.snap`.
  - **Why a leaf:** composed as `succeed(from)`, then `holdAfter(delay)`, `concat` and `succeed(to)`, it lands two ticks late. `holdAfter` counts from the tick after its input settles, and `concat`'s seam costs a tick, so the key would land after its fade had started.

### dom (`238178e`)

- **`makeProjectionSystem(runtime, sink, { reducedMotion })`:** the accessor, read when a layout animation starts. By default, never.
- **`RegisterNodeOptions.respectReducedMotion`:** default `true`.
- **The four starts** put the progress spring at 1 and at rest. A drag release's start is left as it is, with a comment.

### solid (`d7bd157`)

- **`WardicProvider`'s `reducedMotion`:** the provider resolves the Probe and the registry once, and reads the atom at each call. Its context carries the accessor, and it passes the accessor to the projection system.
- **The spine (`runSpine`):**
  - It splits each Retarget's target and runs the positional keys as a Snap leg, then the rest as before.
  - A snapped key's velocity is set to 0.
  - With every key snapped, no tween leg runs.
- **Presence's exit:** it snaps its positional keys with no delay, and its span gains `snapped`.
- **The rest:**
  - A layout member passes its transition's opt-out.
  - `WardicReducedMotion` is exported.
  - The browser project gains an `emulateReducedMotion` command, as the hydrate project has.

### Tests

- **`packages/test/test/reduced-motion.test.ts`** (rewritten):
  - the policy's functions;
  - `endOf` against `Machine.animate`'s own last Frame, across `reverse`, `yoyo`, `repeat` and `repeatDelay`;
  - `snap` through both drivers, including its landing tick against a delayed tween's start.
- **`packages/dom/test/projection-reduced-motion.browser.test.ts`**, six cases on the fake-sink harness:
  - a move lands at once;
  - without reduced motion, the same move FLIPs;
  - the accessor is read at each start;
  - a node's opt-out animates;
  - a crossfade's Lead lands on its own box;
  - a release still springs.
- **`packages/solid/test/reduced-motion.browser.test.tsx`**, ten cases end to end: Playwright emulates the preference, and each case reads painted frames.
  - **The spine's legs:**
    - `x` snaps while opacity fades;
    - `x` animates without the preference, under `"never"`, and with the opt-out;
    - `"always"` snaps without the preference;
    - a tween's `x` waits out its delay and lands as its fade starts;
    - a change in the preference applies from the next Retarget.
  - **Presence's exit:** its `x` snaps while it fades, and the node goes.
  - **Layout animations:** a move lands at once, and FLIPs with the opt-out.
  - **Mutation check:** with the provider's accessor forced to `false`, the six Snap cases fail and the four controls pass.

### The gate run

`bench:core --base main` on `d7bd157`, with 11 paired reps on the bench server.

- **Time:** every workload passes in Bun, Node and Chromium. Noise controls: Bun +0.9%, Node +2.5%, Chromium −0.5%.
  - Core's only per-frame change is `snap`'s step, which runs only under reduced motion, and no workload runs it. `Machine.ts` is unchanged.
- **Node's bytes:** one flag, `springBlend/loop` at 1.05 → 1.12 MB (+6.5%), inside the range the same workload reads on identical code (1.05–1.12, #94). It isn't this change:
  - **The steps-only probe** (`.tmp/94-bytes/`: 1,000 machines stepped by hand over 2,000 frames, 11 reps) reads the same median on both cores. That's 872,589 bytes per frame for `springBlend`, and 610,027 for `springValues`.
  - **A Node-only rerun** of the gate passes every workload, with `springBlend/loop` at 1.12 → 1.12.

## Note (#171, 2026-10-14): a reduced layout animation takes no delay

A layout animation's transition can now be a tween and can have a delay (ADR-0009 *Amendment (#171)*). When reduced motion applies, it still lands at once, and its delay is dropped, as Motion's `animationOptions.delay = 0`.
