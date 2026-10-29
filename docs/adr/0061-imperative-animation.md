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

## Built (PR 2)

- **core, `Sequence`** (new, CONTEXT.md **Sequence**): `compile(steps, options)`, Motion's `createAnimationsFromSequence`, pure and over any subject. A binding hands it each Segment's subjects, values and each value's transition; it returns each subject's Keyframes per key, on a tween over the whole sequence, with `times`.
  - **Time:** each Segment starts where the one before ended, its longest key's delay and duration. `at` takes Motion's forms (a time, `"+0.5"` / `"-0.5"`, `"<"`, `"<+0.5"`, a label), never before 0. A label is a string at the end of the Segment before, or `{ name, at }`.
  - **A key's stops** are placed in its Segment by its `duration`, `delay` (each subject's, when a function), `times` and `ease` per part, and merged in time order, a later Segment's erasing what it overlaps. A single value starts from `null`; a first stop after 0 is held from 0, and the last to the end.
  - **A spring through two stops or fewer** is sampled into an easing over its time to rest: `Machine.spring` over the move between its stops (100 when they aren't two numbers), `Machine.durationOf` for the time, 240 samples a second. Its rest thresholds are the move's (#344), so a longer move takes longer. A spring set by time ends at its duration (#359).
  - **A Segment's `repeat`** below 20 is unrolled into stops, with `repeatDelay` holding the last stop between passes, and `"mirror"` / `"reverse"` turning every other pass.
  - **The sequence's options** (`duration`, `delay`, the repeat) are laid over each key's tween.
- **`Easing.reverse`** is exported: Motion's `reverseEasing`, which the sequence's `"reverse"` uses.
- **`imperative.ts`:** `animate(sequence, options)`, told apart as Motion's is (a list with a list in it).
  - **Each element Segment's** elements are found as a call's, a selector looked up once a sequence. Each value's transition is the Segment's with the value's own laid over it, over the sequence's `defaultTransition` less its delay, times and repeat. It is a spring or a tween by Wardic's rule (ADR-0051), and Motion's 0.3 s `easeOut` tween when it defines neither.
  - **A function Segment** is a subject of its own (a `Callback`): its value from 0 to 1, or through its own stops (a first `null` is 0), runs through `Machine.keyframesValues` on the runtime's frame loop, through the Playhead, its callback told each frame. Its `cancel` tells it its first stop again, as Motion's motion value is set back.
  - **Each element's animation** runs as a call's does (`trackOf`: its spine, or its plain one), its Keyframes and per-value transitions as given. The controls are PR 1's, over every subject's track.
  - **A list's missing members** are left out, as Motion's, for a call and a sequence.
- **Types,** from both bindings: `WardicAnimationSequence`, `WardicSegment` (`WardicElementSegment`, `WardicFunctionSegment`, `WardicSequenceLabel`), `WardicSegmentOptions`, `WardicSegmentTarget`, `WardicSequenceOptions` and `WardicSequenceTime`. `WardicAnimate` takes either form.

**Settled while building it:**
- **A value's own transition is laid over its Segment's,** as Motion's sequences do (`getValueTransition` in `sequence/create.ts`). A declarative transition's entry stands alone (ADR-0049).
- **A Segment's transition is a spring or a tween by Wardic's rule** (ADR-0051): `{ stiffness: 300 }` with no `type` is a spring, as it is everywhere else in Wardic. Motion's sequences read only `type`.
- **`defaultTransition`'s `duration` is a Segment's, never the sequence's.** Its `delay` and repeat are the sequence's, under the sequence's own options, as Motion's. CS9 caught the first build taking its `duration` as the sequence's.
- **Where Motion's compiler slips, Wardic's doesn't:**
  - one easing, or a list shorter than a Segment's parts, is spread over them before a `repeat` unrolls. Motion's misaligns them past two stops: `ease: "easeIn"` through three stops eases the first pass's second part linearly;
  - `"reverse"` plays named easings backwards too, as a reversed run does. Motion's reverses only functions;
  - a bézier's four numbers stay one easing under a `repeat`. Motion's spreads them into four numbers, none of them an easing;
  - `times` that don't give one per stop are spread evenly, as a key's Keyframes are (ADR-0058). Motion's place a stop with no time at `NaN`.

  Two smaller differences: a spring's time to rest is `Machine.durationOf`'s, at 60 Hz, where Motion's steps 50 ms; and a Segment's `repeat` of 20 or more is left out without Motion's development warning.

## Tests (PR 2)

- **core** (`packages/test/test/sequence.test.ts`), SQ1–SQ13: Motion's own sequence cases (`sequence/__tests__/index.test.ts`), each key's transition given as a binding resolves it.
  - Single values, explicit stops and easings, Segments in order;
  - every `at` form and both label forms;
  - the longest key, staggered subjects, the sequence's options;
  - springs sampled (time-based, Motion's default, a longer move);
  - `repeat`, `repeatDelay`, `"mirror"` and `"reverse"` (named easings too);
  - Segments with no subject or no length;
  - a later Segment erasing the stops it spans, and a `null` after a value at one time.
- **Solid 1** (`create-animate-sequence.browser.test.tsx`), CS1–CS9:
  - Segments in order, and `duration`;
  - `"<"`, `"-0.2"` and a label;
  - seeking as one;
  - a function Segment's values, colours through the Interpolators, `cancel`;
  - a spring Segment overshooting, the next waiting for it;
  - a Wardic element's keys taken until its own target changes;
  - the sequence's `duration`, `repeat`, `delay` and `onComplete`;
  - a selector staggered and a Segment's `repeat`;
  - a value's own transition laid over the Segment's, `defaultTransition`, and a list's missing members.
- **Solid 2** (`v2/create-animate.browser.test.tsx`), CV4: a sequence with a function Segment, and `scope.settled()` holding it once it lands.
- **Mutation-checked** (`.tmp/433/mutate2.py`): 34 single-point mutations, each caught by the tests meant for it. Two first survived: a later Segment erasing the stops it spans, and a `null` after a value at one time. SQ13 pins both.

## Measured (PR 2)

`bench:solid` against `main` (`38f2da9`, 11 paired reps, noise control +1.0%) passed on both bindings. Nothing on an element's path changed: a sequence is compiled at its call. Solid 1 / Solid 2:
- **Warm:** mount −0.2% / −1.2%, Retarget −0.4% / −1.5%, rest Retarget +0.0% / −1.9%, unmount −1.1% / +0.3%.
- **Bytes per round:** +0.0% / +0.0%.
- **Retained at rest:** −0.0% / −0.1% for hover + press, +0.1% / +0.0% for a Reorder item.
- **Layout scenes:** flat. **Left after the unmount:** unchanged.

## Settled for PR 3 (asked 2026-10-29, both A)

Q7 left two of Motion's details open; both take Motion's (`animateVariant`, `animateTarget`, `setValues` in `motion-dom`):
- **A transition override reaches down the tree.** `controls.start("open", { duration: 1 })` beats `variants.open`'s own transition on the element and on each Variant child it reaches, and is their orchestration for that change: no stagger unless the override gives one. Rejected: B, the element only; C, the override as the element's `transition` prop, which a variant's own still beats.
- **`set` lands the element and its Variant children.** `controls.set("hidden")` is a start on an instant transition handed down the same way, so a staggered list jumps whole. Rejected: B, the element only, its children animating to the name.

## Built (PR 3)

- **`animation-controls.ts`** (Solid-free, both bindings; CONTEXT.md **Animation controls**, **Controls change**):
  - `createAnimationControls()` makes them anywhere, with no owner. `start`, `set` and `stop` reach every element given them, from its mount to its unmount.
  - Each call makes each element a **Controls change**: its `animate` entry (a function definition called once, with the element's `custom`, values and velocities, as Motion's `controls.start((i) => …)`), the transition of the change, and a count of the elements still to land in it.
  - `start`'s promise is every element's change landing. A change lands once its binding's flush has run (armed, a microtask after the write) and every element it reached has left: at its next landing, its unmount, a failed leg, or a later change.
  - `set` is a change on `{ type: "tween", duration: 0 }`. `stop` ends each element's running legs where they are (the spine's new `stop`).
- **The config:** a binding reads `animate` once, at setup. Given controls, it reads a config whose `animate` is the change's entry (none before the first) and which is marked `controlled`. `namesOwnVariants` counts that mark and controls given as they are, so the element hands down the names it's started to and Variant children join it, with no `variants` of its own (Motion's `isControllingVariants`). A server render reads the same: no entry yet.
  - Solid 1 wraps the config accessor (`controlledOf`), for `wardic.*`, `createWard`, `Reorder.Item` and both directives.
  - Solid 2 lays a view over the ward's per-key view (`Object.create`), its `animate` a getter of the change. It reads `animate` from the setup copy, so one still loading (#257 item 1) is no controls.
- **The spine:** a **Resolution** carries the change in effect, the element's own or, for a Variant child, its provider's (`resolutionOf`'s new argument, `WardicVariantContextValue.change`). A new one is a new resolution (`sameResolution`), so every element it reaches Retargets, whatever the entry resolves to.
  - The element joins the change at that Retarget, held by `when` or not, and leaves at its landing after the gate's flush (unless it joined a later one meanwhile), at a failed leg, or at its unmount.
  - Its first started Retarget for the change runs on the override, its base layers' own transitions beaten (`overriddenOf`). Every key restarts on it, a running leg toward the same target too, so `set` lands at once. A later Retarget, a gesture's, runs on the targets' own transitions.
- **The variant nodes**, both bindings: a change is a trigger, to the same name too (`triggerKeyOf` takes its serial), so the children's slots are taken again and `beforeChildren` waits again. Until a trigger without it, the override is the node's orchestration (`changeAtTrigger`, `orchestrationAt`, `changeConfigOf` for a list's names).
- **Types:** `animate` takes `WardicAnimationControls` on `WardConfig`, `wardic.*`'s props, the inferred configs (#305) and Solid 2's checked config (#301). A controls object is never read as a values map.

**Settled while building it:**
- **A start's promise doesn't hang where Motion's would.** One that a later start or set supersedes resolves then. One a gesture interrupts resolves at the element's next landing. Motion's never resolves once another animation stops its values. `stop()` leaves it waiting for the next landing, as Motion's would wait.
- **The override restarts every key.** A running leg toward the same target would otherwise carry on (#325): `set` toward where a start was heading kept animating. AC10 pins it.
- **Solid 2's async `animate`:** the first build read `animate` at setup outside the setup copy, and a pending one threw `NotReadyError` (async-config's AC1–AC9 caught it).

## Tests (PR 3)

- **Solid 1** (`animation-controls.browser.test.tsx`), AC1–AC13:
  - an element at `initial` until a start, every element given the controls following, the promise at the landing;
  - Variant children staggered by the variant, the promise after the last of them;
  - an override beating the variant's transition down the tree, no stagger, and only for its change;
  - `set` landing element and children at once;
  - `stop`;
  - a function definition per element, called once, not again as the element resolves again;
  - `createWard`, `Reorder.Item`, an unmount mid-start, a start that changes nothing;
  - a controlled element with no `variants`;
  - `set` toward a running start's target;
  - an override's `when`;
  - a start in the task of one that changed nothing;
  - an unmounted element let go by the controls (GC).
- **Solid 2** (`v2/animation-controls.browser.test.tsx`), ACV1–ACV5: a ward and `wardic.*`, Variant children staggered then overridden, `set` and `stop`, a function definition, `set` toward a running start's target. No GC test: Solid 2's dev build keeps every unmounted element's node in this harness, a plain one's too.
- **Server renders** (`animation-controls.ssr.test.tsx`, and Solid 2's): `initial` and the children's names rendered; nothing of the controls in the markup.
- **Mutation-checked** (`.tmp/433/mutate3.py`): 24 single-point mutations, each caught by the tests meant for it. Five first survived, and AC11–AC13, ACV5 and AC7's second half were added for them: a change compared as no new resolution on Solid 2, a resolver called at each resolution, the override's orchestration for a change's `when`, a landing leaving a change joined since, and Solid 1 not letting an element go. A sixth, Solid 2 not letting go, can't be checked here (above).

## Measured (PR 3)

`bench:solid` against `main` (`f645403`, 11 paired reps, noise control +1.5%) passed on both bindings. The workload gives no element controls, so this is what every element pays: a Resolution's `change`, a comparison per Retarget, the spine's change state and `stop`, and each provider's `at` memo. Solid 1 / Solid 2:
- **Warm:** mount −0.7% / +0.7%, Retarget +1.4% / +1.3%, rest Retarget +0.3% / +0.0%, unmount +1.6% / −0.3%.
- **Bytes per round:** +0.8% / +1.0%.
- **Retained at rest:**
  - hover + press +0.7% / +0.8% (19.98 → 20.11 KB, 19.18 → 19.33);
  - a Reorder item +0.6% / +0.6%.
- **Layout scenes:** flat. **Left after the unmount:** unchanged.
