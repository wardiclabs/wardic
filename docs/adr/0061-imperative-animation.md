# Imperative animation

Motion starts animations by a call as well as by props (`.reference/motion` at `16c6122`):
- **`useAnimate()`** (`framer-motion/src/animation/hooks/use-animate.ts`, `animate/index.ts`, `subject.ts`) returns a scope ref and a scoped `animate`.
  - `animate(element | selector | value, target, options)` animates the scope's element, any element, or a selector inside the scope.
  - On a `motion` component's element it animates the component's own values (`animateElement`), so a value's latest animation wins. A plain element is driven by its style effect, its state kept per element.
  - It returns playback controls (`AnimationPlaybackControls`): `then`/`finished`, `stop`, `cancel`, `complete`, `pause`, `play`, `speed`, `time`, `duration`, `state`. `finished` resolves at a landing or `complete()`, never at `stop()` or `cancel()` (`JSAnimation.ts`, `WithPromise.ts`).
  - The component's unmount stops its animations.
- **Sequences:** `animate([[a, { x: 100 }], [b, { opacity: 1 }, { at: "-0.2" }]], options)` compiles to one keyframes animation per element and value, with `times` (`sequence/create.ts`).
- **`useAnimationControls()`** (`hooks/animation-controls.ts`, typed `LegacyAnimationControls`): `animate={controls}`, then `start(definition, transitionOverride)`, `set(definition)` and `stop()` on every element given them.

Wardic had declarative props only. On Solid 2, `settled()`, `next(name)` and an awaitable `animateLayout` gave the timing, but nothing started an animation or a sequence by a call. #433 is the seventh of 1.0's Motion-parity gaps (#426), and its largest.

## Decisions (grilled 2026-10-29, Q1–Q8 each A)

1. **One issue, three PRs, in order** (Q1): `createAnimate` and its controls, then sequences, then animation controls. The second and third reuse the first's controls. Rejected: B, one PR; C, animation controls filed for later.
2. **`createAnimate()`, Motion's `useAnimate`, the same on both bindings** (Q2).
   - `const [scope, animate] = createAnimate()`, with `<ul ref={scope}>` (a ref callback with `.current`).
   - `animate(scope.current, target, options)`, `animate("li", …)` (a selector inside the scope) or any element. It returns the **Playback controls**.
   - Its owner's cleanup stops its animations.

   Rejected: B, a ward method as well on Solid 2; C, a ward method only.
3. **Motion's latest-wins** (Q3).
   - An **Imperative animation** on a Wardic element takes the keys it animates from whatever ran them. At its end they stay where it left them.
   - The spine notes the declarative target each key had when it was taken, and a Retarget leaves the key alone until that target changes: a new `animate.x`, a variant that sets `x`, or a gesture turning on that sets it. A re-render that changes only `opacity` leaves `x` where the call put it.
   - The Snapshot follows the imperative values, so a takeback starts from where the key is drawn, with its velocity.

   Rejected: B, an imperative entry on top of the Override stack; C, plain elements only.
4. **Plain elements too** (Q4).
   - They animate under the provider's runtime, through the gate and the DOM renderer, each with a light record of its values: no spine of its own config, no presence and no layout node.
   - A first animate starts from the element's Own value (ADR-0022), and a later one goes on from where the last left it, velocity included.
   - A selector matching both kinds animates each its way.

   Rejected: B, Wardic elements only.
5. **All of Motion's Playback controls** (Q5).
   - Awaitable, `stop`, `cancel`, `complete`, `pause` and `play`.
   - `speed` scales each tick's `dt` (0 holds).
   - `time` get and set: setting it seeks, each key's machine started again partway through with core's `Machine.startAt`, exact for a tween or keyframes and simulated for a spring.
   - `duration` is the longest key's, a spring's by simulating it to rest, as Motion does; and `state`.

   Rejected: B, `time` read-only, with seeking left to `@wardic/timeline`.
6. **PR 2: Motion's sequences, less MotionValue segments** (Q6).
   - Segments `[subject, target, options]`; `at` as a time, `"+0.2"`/`"-0.2"`, `"<"`, or a label.
   - Per-segment transitions, a spring sampled into an easing over its duration.
   - Function segments `[(progress) => …, options]` stand in for MotionValue segments: Wardic has no MotionValue.
   - Sequence options `duration`, `delay`, `defaultTransition`, `repeat`, `repeatType` and `repeatDelay`.

   It compiles to keyframes with `times` (#429), run on PR 1's controls, so a sequence seeks, pauses and awaits. Rejected: B, tweens only and no function segments.
7. **PR 3: Motion's `animate={controls}`** (Q7).
   - `createAnimationControls()` is made outside, needing no owner, and given as `animate={controls}` on `wardic.*`, in a ward's config or on a `Reorder.Item`, on both bindings.
   - `start(definition, transitionOverride)` sets the element's `animate` entry, so it Retargets, staggers its Variant children and settles as a prop change would, and returns a promise of the landing. `set` lands at once, and `stop` stops where it is. Every element given the controls follows.
   - `animate`'s type widens to take them.

   Rejected: B, an `animationControls` prop of its own.
8. **Solid 2's scope has `settled()`** (Q8): an async value, pending while any animation the scope started runs, its last landing otherwise, `undefined` before the first, as a ward's (ADR-0046). On both bindings the controls are awaitable. Rejected: B, the awaitable controls alone.

**Defaults, stated rather than asked:**
- **Reduced motion** applies to an Imperative animation as the provider says (ADR-0029: positional keys snap), as Motion's `useAnimate` takes its config's.
- **Targets and options** are what `animate` takes: Keyframes, per-value transitions and the Default transitions. `delay` may be a function of an element's index and count, as Motion's. `stagger()` itself is #436.
- **On a server** `createAnimate` animates nothing.

## Built (PR 1)

- **core, `Playback`** (new): a **Playhead** the machines of one animation share, its `time`, `speed` and `paused`, and `drive(head)`, a machine run through it.
  - It starts at the head's time, through `Machine.startAt`, so a seek starts every machine again there.
  - Each tick's `dt` is scaled by the speed and added to its time, which it sets on the head.
  - It holds while paused. Below speed 0 each tick starts it again at the time it went back to, settling at 0.
- **core, `Machine.durationOf`:** a machine stepped from its start at 60 Hz until it settles, at most 20 s (Motion's `maxGeneratorDuration`). `Infinity` for one that doesn't settle.
- **The spine** (`spine.ts`):
  - **`animate(target, transition, head, hooks)`** takes the target's keys: each owner gives it up, and each key is noted in `taken` with the target its Override stack has for it now.
  - **Its legs** start where the keys are drawn, through the same per-key start, Keyframes, Measured pairs, reduced motion and leg builder a Retarget uses. A Retarget's leg program and end handling are now shared with them (`legProgram`, `legEnded`, `startKey`).
  - **Built once:** the legs are built at the call and mapped through `Playback.drive` (`mapMachine`, which `startingAt` now uses too), so a seek or a replay runs the same legs from the same start.
  - **A Retarget** drops a taken key whose target changed, and strips the rest from its target, its returns and its give-ups, so a running Imperative animation runs on through a Retarget of other keys.
  - **The returned track** runs, stops, cancels (its keys written back where it started them) and measures its duration on the unwrapped legs. Measuring the driven ones moved the live Playhead.
- **`imperative.ts`** (shared by both bindings):
  - Each mounted Wardic element registers its spine. A plain element gets a spine of its own per provider, with no config, in the gate only while it animates. Back in the gate, it writes every value it holds first, so a transform keeps the keys it isn't animating.
  - It resolves subjects: an element, a selector in the scope (else the page), a list.
  - It runs a `delay` function per element and builds the Playback controls over every element's track, through one Playhead.
  - **`finished`** resolves at a landing or `complete()`. **`play()`** after a finish or a cancel plays again from the start, its end when backwards, and does nothing after `stop()`. Setting **`time`** on one that isn't running holds it there, paused, as Motion's.
- **Both bindings:** `createAnimate()`. Solid 2's scope adds `settled()`, which holds its landing in an object (`{ animation }`): the controls are awaitable, so an async value holding them would wait on them and read `undefined`.

## Tests (PR 1)

- **core** (`packages/test/test/playback.test.ts`), PB1–PB6: `drive` at speed 1, paused, at speed 2 and 0, from a seek, backwards; `durationOf`.
- **Solid 1** (`create-animate.browser.test.tsx`), CA1–CA10:
  - a plain element, its other keys kept and a spring's velocity carried into the next call;
  - a selector's scope and a staggered `delay`;
  - latest-wins on a Wardic element, a running call through a Retarget of another key;
  - pause, play, speed, seeks and `duration`;
  - `complete`, `cancel` and `stop`;
  - reduced motion;
  - the owner's cleanup;
  - Keyframes and `height: "auto"`;
  - `onComplete`, an empty selector and `animations`;
  - a key taken mid-return to its `style` value, kept through a later landing.
- **Solid 2** (`v2/create-animate.browser.test.tsx`), CV1–CV3: `scope.settled()`, a selector and a ward's latest-wins, the owner's cleanup.
- **Mutation-checked** (`.tmp/433/mutate.py`): 21 single-point mutations, each caught by the tests meant for it. One first survived: the guard that keeps a taken key out of a Retarget's returns. The strip after it already keeps the key out of the target, so it shows only where the Base value is the element's `style`, which a landing hands the key back to. CA10 pins it.

**Found along the way, and left alone:** a tween's leg keeps no velocity on the Snapshot, so a spring that takes a key over from a tween starts it at rest, declaratively as well as here. Motion carries it.

## Measured (PR 1)

`bench:solid` against `main` (`69bef66`, 11 paired reps, noise control +0.1%) passed on both bindings. The workload makes no Imperative animation, so this is what every element pays. Solid 1 / Solid 2:
- **Warm:** mount +0.7% / +1.3%, Retarget +0.5% / −0.9%, rest Retarget +0.4% / +1.2%, unmount +3.3% / +0.6%.
- **Bytes per round:** +0.0% / −0.1%.
- **Layout scenes:** flat. **Left after the unmount:** unchanged.
- **Retained at rest:**
  - hover + press +1.9% / +1.7% (19.60 → 19.96 KB, 18.89 → 19.20);
  - a Reorder item +1.3% / +1.1%.

  Each spine holds its `taken` Map, its `animate` closures and its registration. A `taken` made at the first call is the obvious cut, left for #460.
