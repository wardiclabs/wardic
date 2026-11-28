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
- **Reduced motion** applies to an Imperative animation as its scope's nearest `WardicConfig`, else the provider, says (ADR-0029: positional keys snap; ADR-0062 since #434), as Motion's `useAnimate` takes its config's.
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

**Found along the way, and left alone:** a tween's leg keeps no velocity on the Snapshot, so a spring that takes a key over from a tween starts it at rest, declaratively as well as here. Motion carries it. *Fixed by #464* (ADR-0005, *Amendment (#464)*): a spring taking over a moving tween carries its speed.

## Measured (PR 1)

`bench:solid` against `main` (`69bef66`, 11 paired reps, noise control +0.1%) passed on both bindings. The workload makes no Imperative animation, so this is what every element pays. Solid 1 / Solid 2:
- **Warm:** mount +0.7% / +1.3%, Retarget +0.5% / −0.9%, rest Retarget +0.4% / +1.2%, unmount +3.3% / +0.6%.
- **Bytes per round:** +0.0% / −0.1%.
- **Layout scenes:** flat. **Left after the unmount:** unchanged.
- **Retained at rest:**
  - hover + press +1.9% / +1.7% (19.60 → 19.96 KB, 18.89 → 19.20);
  - a Reorder item +1.3% / +1.1%.

  Each spine holds its `taken` Map, its `animate` closures and its registration. A `taken` made at the first call is the obvious cut, left for #460, which made it: every spine shares `NONE_TAKEN` until its first call.

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

## Amendment (#896, 2026-11-24): a target's own transition and its Transition end

**What happened.** `animate(subject, target, options)` dropped both. `trackOf` resolved the target with `VariantTarget.resolveTarget`, whose `Target` carries `transition` and `transitionEnd`. Then `imperativeTrackOf` read only its `values` and `keyframes`, and the call's options. Every target type that offers them was affected: `@wardic/object`'s `ObjectTarget`, `@wardic/three`'s `SceneTarget` (whose `ThreeColours.splitCall` already split both into colour channels), and the DOM's `animate`, which takes a `WardicVariant`. Segment and Batch targets offer neither.

**Motion** (`.reference/motion` at `16c6122`, and 14.6.0 as installed): `animateValues` skips a target's `transition` key (`motion-dom/src/animation/animate/effects.ts`). Its `animate` runs on the options alone, so there's no precedence between the two to copy. It applies `transitionEnd` per Subject, once that Subject's animations resolve, on the next frame. Its public target types (`DOMKeyframesDefinition`, `ObjectTarget<O>`) offer neither.

**Decided (grilled 2026-11-24, Q1–Q8 each A).**
1. **A target's own transition counts, the options' fields laid over it** (Q1). The merge is shallow, as `inherit: true` and a variant list's are. A per-key entry in the options replaces the target's entry for that key whole. `{ delay: 0.2 }` or `{ onComplete }` alone keeps the target's duration.
   - Rejected: B, the options replacing it whole (Motion's `transitionOverride`, `controls.start`'s override). A delay or an `onComplete` would wipe the target's transition.
   - Rejected: C, Motion's: ignore it, and take `transition` out of the published target types.
   - This goes beyond Motion, but Motion's types never let a target carry a transition, so typed Motion code runs the same.
2. **A Transition end is each Subject's** (Q2). It's written at the flush after that Subject's keys from the call land, and that landing includes it: `finished`, `then` and `onComplete` see it (ADR-0057 decision 4). Other Subjects of the call don't hold it back.
3. **An interrupted Subject never writes it** (Q3): `stop()`, `cancel()` before the landing, a later call taking any of its keys, a Wardic element's own target change for one of them. `complete()` is a landing and writes it.
4. **On a Wardic element its keys are the call's once written** (Q4). Until then they follow the Override stack (a hover's `cursor` mid-flight). After, they stay until the element's own target for the key changes, as the keys it animates do (Motion's latest-wins). ADR-0057 decision 2 can't apply: an Imperative animation isn't an entry. Rejected: B, taken when the call starts and held during the flight.
5. **Its keys follow the Playhead** (Q5). `cancel()`, a seek before the end (`time = t`) and a replay (`play()` after it finished) put them back as they were before the write, and the next landing writes them again. A cancelled `{ opacity: 0, transitionEnd: { display: "none" } }` is visible again. On a Wardic element they stay the call's, as its animated keys do on `cancel()`. Rejected: B, Motion's, once written kept (a cancel after the landing leaves an invisible element at opacity 1).

**Defaults, stated rather than asked:**
- **Reduced motion and `skipAnimations`:** a Subject whose legs snap lands at once, and its end is written then.
- **Nothing to animate:** `{ transitionEnd: { v: 5 } }` is written at the next flush, and the Subject lands.
- **A key both animated and ended:** `{ x: 100, transitionEnd: { x: 0 } }` animates, then rests at 0.
- **`inherit`:** a target's transition has nothing above it in a call, so `inherit` is dropped.
- **Out of scope:** Segments and Batch calls, whose targets offer neither.

**Built** (`packages/core/src/unstable/Imperative.ts`):
- **`overOwn`** lays the call's options over the target's own transition in `trackOf`, `{ ...own, ...given }`. With no options it hands the target's own back as it is, so the legs' decode cache (#66) holds for it. Its `inherit` is left in: the legs read none (`RetargetLegs`' `NOT_DEFINING`).
- **`takeKey`**, the take the call's loop over its keys made inline, now a function of the spine's host. The loop and `writeEnds` both take keys through it.
- **The track's landing** (`landed`) waits for the flush after its last leg's frame, then sets the end (`writeEnds`), then tells the landing after the flush that draws it.
  - **A target with no end** lands as before, a flush after its last frame.
  - **So does one whose keys were interrupted** (`interrupted`): a key the call animates whose owner isn't one of its legs any more. A leg that gave up one of its keys draws the rest on and lands, so the call lands too, as before #896. Only the end is dropped. That's unlike Motion, whose call never resolves then.
  - **A count of the track's runs, stops and cancels** is checked by both waits. A stop, a cancel or a seek in the frame between the legs landing and the landing told tells none. A stop there leaves the end set: the legs landed and set it, and the stop leaves things where they are.
- **`writeEnds`** takes each end key through `takeKey`, noted with the Override stack's target for it now, then sets it at rest through the gate.
  - **A key another leg is drawing at that moment** (`endFree`) is left to it, as Motion's `setTarget` would leave a running animation to overwrite it.
  - **What the keys were before** is recorded once (`overwritten`) and kept until a put back. A second landing from the end doesn't record its own end as the "before".
- **`putBack`** writes the end's keys back as `writeEnds` found them, once.
  - **Which keys:** only those with no owner since. The take left each without one, so an owner since is a later animation's, which wins (Motion's latest-wins).
  - **When:** `cancel` calls it, then puts the animated keys at their start. `run` calls it for a replay, or a seek before the end. A run from the end going forward lands at once, so it keeps the end (`fromItsEnd`), and a seek to the end or a `complete()` shows no frame without it.
- **`setAtRest`**, the at-rest write `cancel` made inline, is shared by `cancel`, `writeEnds` and `putBack`.

**Reviewed** (two-axis review, standards and spec). The spec axis found four things wrong in the first build, and all four were fixed, each red first in WO18, WO19 or WO16:
- the frame between the end and the landing, unguarded;
- `putBack` over a value a later call had set and landed;
- a flash of the old value at a seek to the end, or `complete()` after the landing;
- a second landing re-recording the end as its "before".

One finding was declined: an explicit `{ duration: undefined }` in the options wiping the target's field. `exactOptionalPropertyTypes` makes that a type error, so only untyped code reaches it.

**Tests:**
- `packages/object/test/wardic-object.test.ts`, WO13–WO19, Node:
  - **WO13:** the issue's `{ v: 1, transitionEnd: { v: 5 } }`: 1 drawn, then 5 the frame after, with `onComplete` and the controls seeing 5. Also a target with nothing to animate, and a key both animated and ended.
  - **WO14:** the target's own 1 s linear tween; a `delay` or an `onComplete` alone keeping it; the options' `duration` over it; an options entry replacing the target's whole.
  - **WO15:** `stop()`, `cancel()`, a later call taking one key, and a later call drawing an end key at the landing; `complete()` setting the end.
  - **WO16:** after the landing, a cancel, a seek and a replay put the end back. Also a key both animated and ended back at its start, a key set by another call since left alone by a replay, and a replay's end recording that call's value.
  - **WO17:** each Subject's end as it lands; reduced motion and `skipAnimations`.
  - **WO18:** a stop, a cancel and a seek in the frame between the legs landing and the landing told.
  - **WO19:** a put back leaving a later call's landed value; a seek to the end and a `complete()` with no frame without the end; a cancel after them putting back the first "before".
- `packages/three/test/wardic-three.test.ts`, WT16: a mesh's own transition, a colour's entry and its end on its channels.
- `packages/solid/test/create-animate.browser.test.tsx`, CV5–CV7, the DOM through Solid 2:
  - **CV5:** a plain element on its own 0.4 s tween, hidden by its end before its controls resolve.
  - **CV6:** a ward's element: its end's `display` is the ward's mid-flight and the call's after; a cancel puts it back; the ward's own target takes it back.
  - **CV7:** the ward's own target taking one of the call's keys back drops the call's end.
  - **On `main`:** CV5 and CV6 failed, at opacity 0.097 at 0.2 s and `display` never `none`. That's the DOM case the issue read from the code.

**Mutation-checked** (`.tmp/896/mutate.py`): 23 single-point mutations, each run against WO, WT16 and CV, 22 caught.
- **The one missed:** the stale check in the first wait, the one that sets the end. That wait runs in the same flush as the leg's last frame, so no app code can come between on pumped frames. It's kept as a cheap guard.
- **Taken out:** the first build's two missed mutations, the owner not given up and `ownValue` not called, are now `takeKey`'s, shared with the keys the call animates.

**Measured** (`.tmp/896/probe.ts`, Node 22, `--expose-gc`; six paired processes, base `main`'s `Imperative.ts`, alternating order). One call over 3000 plain objects:
- **Retained per Subject:** about 4.21 KB on both sides (`main` 4205–4277 B, the head 4203–4214 B). One reading of 12.8–13.3 KB on either side is the GC's timing.
- **The call:** 43.4 ms on `main`, 40.3 ms on the head, within the probe's spread (ratios 0.85–1.00).
- **Frames:** each frame's path is unchanged.
- **Bytes** (`bun run size`): core grows 0.7 KB minified in each app that ships the Imperative track.
  - `f-slim`, Foldkit's Slim app, goes from 196.5 to 196.8 KB gzip. That was past its budget, so the budget was raised to 196.8 by what this measured, as #882's was.
  - `t2-stage` (243.5) and `t2-features` (251.2) stay within theirs.
  - Solid's apps don't ship the track, and are unchanged.

## Amendment (#951, 2026-11-24): an animation a later one takes a key from ends without landing

**What happened.** Found while building #896.
- **Some keys taken:** a call whose key a later call took still landed once its other keys did. `finished` resolved, `onComplete` ran and `state` read `"finished"`.
  - Why: the leg that gave the key up drew its other keys on, and settled the track (`giveUp`, `legEnded`).
- **Every key taken:** the leg was given up whole, interrupted, and settled nothing. The call stayed `"running"` for good, and nothing heard an end.
  - Foldkit's `Wardic.animate` Effect, which succeeds on the end, hung until its fiber was interrupted.
  - `scope.settled()` waited on the call, and `scope.animations` kept it.
- **A Batch call:** it withheld `onLanded` once a key was taken (`checkLanding`, "it ends unheard"), and hung the same way.

**Motion** (14.6.0, and `.reference/motion` at `16c6122`): `value.start` stops the value's animation. `JSAnimation.stop` tears it down to `"idle"` without `notifyFinished`, so the group's `finished`, a `Promise.all`, never resolves, and `onComplete`, chained on it, never runs. The group's `state` is its first animation's (a `TODO` in `GroupAnimation`).

**Decided (grilled 2026-11-24, Q1 and Q5–Q11 each A, and the run's retake asked as it came up):**
1. **It never lands, and ends without landing, as a stop does** (Q1).
   - Motion's promise: `finished` never resolves, `onComplete` never runs.
   - Wardic's end: once the keys it still draws have landed, or at once with none left, `state` reads `"idle"` and its scope is told `ended(controls, false)`. Foldkit's Command then succeeds with `{ landed: false }`, `settled()` stops waiting, and `animations` drops it.
   - Rejected: A, Motion's to the letter, with no end (every consumer above hangs); C, landing with its other keys.
2. **A call over several Subjects** (Q5) lands only if every part does. With one taken, it ends without landing once every part is done.
3. **Before its end, a run takes its keys back; after it, it's a stopped call** (Q6).
   - A seek, `complete()` or replay runs it again, and its keys are taken from whatever draws them now. The later call has then lost a key in turn.
   - This came up as it was built. A run only reassigned owners, leaving the later call's leg drawing the key too: two legs on one key, the later one's frames winning after the earlier landed. Asked, and fixed here (A).
   - After its end, `play()` and `complete()` do nothing, as after `stop()`.
4. **The element's own target taking a key counts** (Q7), as a later call's does: both are latest-wins takes, and #896 drops a Transition end on either.
5. **Batch calls too** (Q8), on the same controls.
6. **Sequences too** (Q9): each Subject's part of one runs as a call's does. A function Segment's value can't be taken.

**Reviewed** (two-axis review, standards and spec). Three more decisions (each A), and one fix:
7. **A key counts as taken only mid-flight.** A key taken after its leg landed, while the call's other keys still run, doesn't keep the call from landing, as Motion's resolved value doesn't. Batch calls follow the same rule.
8. **A key that snaps counts as landed from its start.** That's `skipAnimations`, and reduced motion's positional keys. A take in the same task, before its next frame, takes nothing in flight, as Motion's skipped value makes no animation.
9. **A ward's carry counts as a take** (Q7). A ward's own target changing to the value the call's leg is heading for carries the leg on as the ward's own, reassigning its landing. The call used to hang, `"running"` for good (before #951 too). Now the leg is Superseded, and the call ends without landing.
- **The fix:** a take reported synchronously, inside the later call, and then, in the same task, a seek, `complete()` or a cancel and replay. The stale report used to end the new run: `"idle"`, unresolved, the plain Subject out of its gate. Every wait in the landing now checks the run count.
- **Standards:**
  - the vocabulary moved to the glossary's: a leg Superseded (`supersededAt`), a track's `taken`;
  - one take loop (`takeEach`) serves an end and a run;
  - the public `onTaken` doc cites no issue;
  - afd1281d's three ideas were split into commits.

**Built:**
- **`controlsOf`'s `settledOne(landed)`** counts each part as before. With one not landed (`anyTaken`), the last part ends the call: `stopped`, then `end("idle", false)`, with no resolve and no `onComplete`. `runAll` clears it.
- **The track's `settled(landed)`** (`Spine.ImperativeHooks`): `landed` false when its landing finds itself `taken`.
  - **Taken:** a leg ending with fewer keys than it started with (`count < Rec.size(targets)`; only `giveUp` lowers it, and not for a done leg), one that doesn't snap (its machine's duration above 0, read only then), or a leg carried off.
  - **Passed on** by the plain Subject's wrapper, function Segments, Batch calls and Batch sequences.
  - **Every wait checks the run count:** the taken report, the plain landing, and #896's end.
- **`supersededAt`**, told at each leg's end (the track's own `Effect.onExit`, a leg of the current run). A leg with a count of 0 had every key taken; one whose landing isn't the track's any more was carried by the element's own Retarget. Either counts toward the track's landing (`legDone`), as taken. Neither settles the track's landing otherwise: a leg `giveUp` ends exits Superseded, counting toward nothing.
- **A run after the track's first** takes each key another leg draws (`takeEach(to, drawnByAnother)`, through `takeKey`), as the call took it.
- **Batch:**
  - **The options:** `Batch.AnimateOptions` and `KeyframesOptions` take `onTaken`. `BatchCalls`' change call, `ObjectBatch` and dom's `BatchMembers` pass the call's `taken` to it.
    - **Moved before release:** a public option on `Batch` made the release a minor, 1.4.0, where the roadmap's 1.4 is the performance viewer. `onTaken` is now `@wardic/core/unstable/BatchCalls`' `Taken<O>`, laid over `Batch`'s options, outside semver; `Batch` reads it at a change's end. `BatchCalls.keyframesOptions(call)` gives a sequence's call's. The release is a patch, 1.3.1.
  - **Which keys count:** `checkLanding` marks each held key at rest (`rested`), as does `play` for a key that starts at its target. At the end, a key no longer held and never rested calls `onTaken`; otherwise `onLanded`.

**Tests:**
- `packages/object/test/wardic-object.test.ts`:
  - **WO15** changed. Its takeover case had pinned the landing: now `"idle"`, never resolved, no `onComplete`.
  - **WO20:** every key taken ends at once. Two Subjects end once both parts are done. A seek takes the keys back from the later call, which ends in turn, and lands. A pair whose one part has ended lands after a seek. After the end, `play()` and `complete()` do nothing.
  - **WO21:** a seek, `complete()`, and a cancel then `play()`, in the task a later call takes every key, each run again and land.
  - **WO22:** a key taken after its leg landed. A skipped call's key, and reduced motion's snapped `x`, taken in the task they start. Each call lands.
- `packages/object/test/object-batch.test.ts`:
  - **OB14:** a Batch call and a Batch sequence, a member's key taken mid-flight, end `"idle"`.
  - **OB15:** a member's key taken after it landed, and a skipped Batch call's taken in its task, each land.
- `packages/solid/test/create-animate.browser.test.tsx`:
  - **CV7** asserts the call ends `"idle"` when the ward's own target takes a key.
  - **CV8:** `scope.settled()` stops waiting, and `animations` drops the call.
  - **CV9:** a ward's carry ends the call without landing.
  - **CV10:** a seek before that end takes the carried leg's key back, and the call lands, the ward settling too.
- `packages/solid/test/v1/`:
  - **CBA3** (`create-batch-animate`) had pinned the hang, `"running"`: now `"idle"`, never resolved.
  - **CBS7** (`create-batch-sequence`): a DOM Batch sequence ends `"idle"`.
- `packages/foldkit/test/animation-scope.browser.test.ts`, **C5:** the Command succeeds with `landed: false`, at once with every key taken.
- **On `main`,** CV8, CV9 and C5 failed. C5's every-key Command never ended, and CV9's call stayed `"running"`.

**Mutation-checked** (`.tmp/951/mutate.py`): 21 single-point mutations across core, dom and object, 20 caught.
- **Three were caught only after a test was added or reworked:** a part's loss kept across a run (WO20), dom's Batch sequence dropping `taken` (CBS7), and `carried` kept across a run (CV10, its carried leg ending before the seek).
- **The one missed:** the run check on a leg's end. A leg of an earlier run ends in `run()`'s own `end()`, before `run()` resets `carried` and `left`, so a stale count washes out. It's kept as a guard, should an Environment's legs end later than that.
- **CBS7's first version threw on its own harness,** so its first catch was false. It was fixed, and the whole set rerun.

**Measured** (`.tmp/896/probe.ts`, as #896's: six paired processes against `main`'s `Imperative.ts` and `Spine.ts`). One call over 3000 plain objects:
- **Retained per Subject:** about 4.21 KB on both sides.
- **The call:** 39.4 ms on `main`, 39.9 ms on the head, within the probe's spread (ratios 0.95–1.06).
- **After the review's fixes:** the call 40.2 → 40.0 ms (ratios 0.98–1.02). Retained per Subject is 4213 → 4237 B at the median, +0.6%: the closure each leg's end now goes through.
- **The benches ran on the review's first fix**, its hook in `Spine.ts`. The final build leaves the spine's code as `main`'s, and Batch's loop as timed, its two guards an `if … else` before.
- **`bench:core --base main`:** passed on Bun, Node and Chromium, the Batch workloads within ±3%. Chromium's first two passes were too noisy (its control +3.0% and +3.1%); one rerun failed to launch the browser.
- **`bench:solid --base main`:** passed on the third run, both bindings: warm tasks −1.2% to +4.7%, bytes per element −0.1% and +0.3%.
  - The two runs before each failed one sub-millisecond item, a different one each time, on paths this doesn't touch: Solid 2's `restRetarget` (+5.5%, then +1.3%), then Solid 2's layout `page frame` (+7.9%, then −1.5% and +5.8%).
- **Bytes** (`bun run size`): core grows 0.4–0.7 KB minified in the apps that ship the Imperative track, and 0.1 in the Batch apps. Three budgets were raised by what this measured, as #896's was: `f-slim` to 197.0, `t2-stage` to 243.9, `t2-features` to 251.5.
  - The review's first fix put a hook in `Spine.ts`'s `giveUp` and its carry. That spine ships in Solid's slim apps, and `s2-slim` read 118.0 against its 118.0. The hook moved to the Imperative track's leg ending (`supersededAt`), where only an app with an Imperative animation pays for it, and Solid's slim apps are as they were.

## Amendment (#970, 2026-11-25): a Transition end's keys are read at the call

**What happened.** Found while building #968. A Transition end's key the Subject lacks or can't write failed only at the landing, and then the call never finished.
- **Why:** #896's `writeEnds` takes each end key through `takeKey`, which reads its Own value, and an Environment's read throws for such a key (`@wardic/object`'s and `@wardic/three`'s own-value reads). The throw left the `afterFlush` that sets the end, reported as `wardic.gate: an afterFlush call failed`, so the landing it queues was never queued.
- **So:** the end's keys after the failing one weren't set, `await` never resolved, and `state` stayed `"running"`.
- **Not affected:** a ward's Transition end, which Spine's `resolvedOf` merges into the values its Retarget reads, so a key it can't take is refused as its leg starts. Nor Segments, which take no Transition end.

**Motion** (`.reference/motion` at `16c6122`): `animateValues` sets a Transition end once its animations' promises resolve, in a `frame.update` callback (`motion-dom/src/animation/animate/effects.ts`). Its call has finished by then. An end key its effect can't read fails inside that callback, at an `invariant` ("can't be read from the animated subject") that only development builds throw. Nothing checks the end at the call.

**Decided (grilled 2026-11-25, Q1–Q6 each A):**
1. **The end's keys are read at the call** (Q1), each as `takeKey` reads a key it animates, before the call takes any key. A key the Subject lacks or can't write is the Environment's error, thrown at the call and naming it, and none of the call starts. The DOM's read, cached once per key, happens then instead of at the landing, as a ward's does.
2. **A key that can't be set by the landing doesn't hold the call** (Q2). That's one made read-only or deleted after the call. The key is reported at that landing and left as it is, the rest of the end is set, and the call lands. A replay that lands again reports it again.
   - Rejected: B, failing the call. An Imperative call's hooks have no failure (`failed` is `constVoid`), and its controls no rejection.
3. **Every Environment, through core** (Q3). Not wards, already right; not Segments; not #969, the flush stopping at one bad write.
4. **Tests and cost** (Q4): object's and three's run-time seams, the DOM's Transition end browser tests unchanged, three mutations, and an object call with a two-key end timed against `main`.
5. **The report** (Q5): `Report.failure("wardic.animate: a Transition end's \"y\" couldn't be set, the rest of it set and the animation landed", cause)`, once per key a landing can't set, with the Environment's error as the cause.
6. **A patch** for core, object and three (Q6), with the hovers of core's `animate` and of object's and three's `transitionEnd` saying so. No glossary change.

**Built** (`packages/core/src/unstable/Imperative.ts`):
- **`readOwn`**, `takeKey`'s Own value read as a function: a statement, where the key has no `initial` value.
- **`imperativeTrackOf`** reads each of `target.transitionEnd`'s keys through it before its loop over the target's keys, so a throw leaves the Subject's keys untaken.
  - **A list's earlier Subjects** have had their tracks built by then, and their keys taken from whatever drew them. A later Subject's throw leaves those animations ended, as a later Subject's bad target key has since #968: #973.
- **`settableOrReported`**, a guard in `writeEnds` beside `endFree`, reads the key again at the landing, in a `try`. A key it can't read is reported and left out of what's taken, recorded (`overwritten`) and set.
  - The landing then reads each end key twice, once here and once in `takeKey`. That's simpler than a take loop of its own for the end, and costs one read a key.
  - **Not guarded:** `putBack`. A key frozen after the landing, then a cancel, fails in the flush, which stops there: #969's.

**Tests:**
- `packages/object/test/wardic-object.test.ts`:
  - **WO25:** an absent end key, a read-only one, a list's later frozen object's, and a frozen object's with nothing else to animate, each an error at the call. Nothing moves, and no frame is wanted.
  - **WO26:** a key made read-only after the call, then one deleted. Each call lands (`"finished"`, `await` resolves), its other end key set. Each failing key is reported once, with the object's error.
- `packages/three/test/wardic-three.test.ts`, **WT19:** a mesh's absent end key, its `id`, and a frozen uniform with nothing else to animate, each an error at the call. Nothing moves, and an end three can set ends as ever.
- **On `main`,** WO25 and WT19 failed ("expected [Function] to throw"), and WO26's call stayed `"running"`.
- **The DOM:** `create-animate` and `transition-end` (Solid 2) and `create-animate`, `create-animate-sequence` and `transition-end` (Solid 1) pass unchanged.

**Mutation-checked** (`.tmp/970/mutate.py`): four single-point mutations, each run alone, all caught. The call-time read dropped (WO25, WT19). The landing guard dropped, the guard reporting every key, and a failing key kept (each WO26).

**Reviewed** (two-axis review, standards and spec): the guard renamed for its report, `readOwn`'s comment naming the landing, the changeset's example typed, and the decisions above completed. A list's earlier Subjects (above) went to #973; the put back is #969's.

**Measured** (`.tmp/970/bench.ts`, `drive.sh`): twelve paired processes on the quiet bench host, `main`'s `Imperative.ts` against this one, alternating which goes first.

| an object's call, and its stop | Bun | Node |
|---|---|---|
| a two-key Transition end | 5.82 → 5.97 µs (+132 ns, 8 of 12 slower) | 6.65 → 6.82 µs (+115 ns, 11 of 12) |
| no Transition end | 5.67 → 5.53 µs (−79 ns, 2 of 12) | 6.52 → 6.69 µs (+93 ns, 9 of 12) |

- **The call with an end** pays two own-value reads, about 0.1 µs, against 6 µs.
- **A call with none** is within the run's spread on both engines.
- **Bytes** (`bun run size`): gzip grows 88 B in `f-slim`, 125 in `t2-stage` and 65 in `t2-features`, the apps that ship the Imperative track, core 0.2 KB more minified in each. Their budgets were raised by what this measured, to 197.1, 244.3 and 252.0. Solid's slim apps are as they were.

## Amendment (#973, 2026-11-25): a call refused at the call takes nothing

**What happened.** Found reviewing #970. A call refused at the call (a key a Subject can't take, so its Environment's own value read throws) had already taken the keys read before it. `animate` built each Subject's track in turn, and a track took its keys as it was built: `takeKey` gave each up from whatever drew it, then read it. So the animations drawing those keys ended `"idle"`, their keys stuck mid-flight, and the new call never ran.
- **Three shapes**, probed on `main` after #974:
  - one Subject whose later key is refused: `{ x, y }` with `y` read-only. `{ y, x }` was fine, so the key order decided;
  - a list's later Subject;
  - a sequence's later Segment's Subject.
- **A Stage ward's mesh too:** the take stopped the ward's own leg mid-flight.
- **Not affected:**
  - Batches. A Batch's animation takes nothing until it plays (`Batch.animate` is worked out at its first play), and in a mixed call its checks run before the plain tracks.
  - The DOM, whose read never throws.

**Motion** (`.reference/motion` at `16c6122`): `animateSubject` starts each Subject in turn (`framer-motion/src/animation/animate/subject.ts`). A later Subject's `invariant`, thrown only in development builds, leaves the earlier Subjects animating to the call's target, and the call returns no controls for them.

**Decided (grilled 2026-11-25, Q1–Q5 each A):**
1. **A call refused at the call takes nothing** (Q1). Every key a call names is read before any is taken: each Subject's target keys and its Transition end's, for every Subject of a list or a sequence. An animation the call would have taken a key from runs on and lands.
   - Rejected: B, Motion's. The earlier Subjects animate on, with no controls to await, stop or cancel them.
   - Rejected: C, undoing the takes. `giveUp` has ended the earlier leg's hold on the key, and restarting it would need its machine mid-flight.
   - Rejected: D, leaving it.
2. **All three shapes, through core** (Q2). Batches, #969 and the DOM are unchanged.
3. **One read a key** (Q3). The new read is the call's, and `takeKey` stops reading.
   - A landing's `settableOrReported` is then its only read, so #970's second read there goes.
   - A run's retake, at a replay, reads none. A key frozen since the call fails at its write, as a key nothing else draws already did (#969).
4. **Tests and cost** (Q4): object's seam and a Stage ward's, mutations, an object call and a list call timed against `main`, and the bytes.
5. **A patch** (Q5), with core's `animate` hover, object's module doc and the glossary's **Imperative animation** saying so.

**Built** (`packages/core/src/unstable/Imperative.ts`):
- **`readiedOf`** resolves a Subject's target and finds the spine it runs through: its Wardic element's host, else its plain spine. It reads the target's keys (`readOwnValues`: its Transition end's, then its values, each through `readOwn`) and returns them as a `Readied`, building nothing.
- **`trackOf`** takes a `Readied`, so a call readies every Subject before it builds any track:
  - **a list:** an `Arr.map` of `readiedOf`, then the tracks;
  - **one Subject:** readied, then its track, with no second map; the read before its take is all it needs. The list form's second map measured +0.39 µs a call on Bun (10 of 12 pairs slower), and this path took it back;
  - **a call with Batch members' Subjects** (the DOM's): its other Subjects readied first;
  - **a sequence's Subjects** (`segmentReadiedOf`): a function Segment's callback has none.
- **No reads left:** `takeKey` no longer reads, and `imperativeTrackOf` no longer reads its end's keys (#970's read moved into `readOwnValues`).
- **Error order:** a Subject's end keys are read before its target's, as #970 read them, so each error names the key it named before.
- **Not covered:** a `delay(i, n)` that throws for a later Subject. Each Subject's transition is worked out as its track is built, so the earlier Subjects' keys are taken by then, as on `main`. It isn't a key the Subject can't take.

**Tests:**
- `packages/object/test/wardic-object.test.ts`, **WO27:** an earlier call on a Subject runs on and lands at its target, `"finished"`, after each of four calls refused at the call:
  - the same Subject's later key;
  - a list's later Subject;
  - a list's later Subject's end key;
  - a sequence's later Segment's Subject.

  Each shape asserts on its own (`expect.soft`). On `main` all four failed: `"idle"`, the key at 1.67–2.
- `packages/three/test/stage.solid.test.tsx`, **CS11:** a ward animates a mesh's `x`, and `animate(mesh, { x: 1, id: 5 })` throws at the call. The ward's own animation lands at 3. On `main` it stopped at 0.96.
- **Unchanged:** WO7, WO25, WT18 and WT19 pass, each error still at the call and naming its key. The DOM's `create-animate`, `transition-end` and Batch browser tests pass on Solid 1 and 2.

**Mutation-checked** (`.tmp/973/mutate.py`): six single-point mutations, each run alone, all caught:
- the first read dropped;
- a list's read interleaved with its tracks;
- only target keys read first;
- a sequence's read interleaved with its tracks;
- target keys read as they're taken, `main`'s;
- the target's keys read before the end's (WO25).

**Reviewed** (two-axis review, standards and spec):
- **The read order:** the first build read a Subject's target keys before its end's, so WO25's list case, a frozen later object, named its `x` and had been changed to keep naming `y`. The end's keys are read first again, and WO25 is `main`'s.
- **Names:** `readiedOf` takes a `variant`, `trackOf` keeps its `target`, and `readKeys` is `readOwnValues`. `takeKey`'s doc names the replay, which reads none.
- **Left as they are:** a sequence's two maps each check `isCallback`, clearer than pairing them in one. The `delay(i, n)` case is above.

**Measured** (`.tmp/973/bench.ts`, `drive.sh`): twelve paired processes on the quiet bench host, `main`'s `Imperative.ts` against this one. The order alternates, and each run checks which it loaded.

| a call and its stop | Bun | Node |
|---|---|---|
| one object, two keys | 6.94 → 6.83 µs (−0.05 µs, 5 of 12 slower) | 7.08 → 7.03 µs (−0.05 µs, 5 of 12) |
| 100 objects, two keys | 635.9 → 620.5 µs (−2.1%, 5 of 12) | 666.9 → 664.4 µs (−0.2%, 4 of 12) |

- **Time:** within the runs' spread on both engines.
- **The DOM** (asked after the review, on the same quiet host):
  - **`bench:solid --base main`** passed on both bindings, its control +0.4%. The ward's paths moved −1.6% to +1.0%: mount, the Retargets, unmount, allocation, retained memory, and the layout scenes. None of its timed tasks calls `createAnimate`.
  - **A DOM `createAnimate` call:** `?kind=batch-animate`, 1000 calls, one per element, paired against `main` over 11 reps (a copy of `run.ts` whose `--batch-frames` ran that page). Its control was +0.7%.

    | `batch-animate`, warm | `main` | this | change |
    |---|---|---|---|
    | the calls (the change task) | 8.300 ms | 8.445 ms | +0.4% [+0.1% – +3.0%] |
    | the frames | 1.705 ms | 1.695 ms | −0.3% [−1.7% – +2.5%] |

    About 35 ns a call, out of 8.3 µs, under the +5% gate. Its p25 above 0 says it's likely real: each Subject's `Readied` and the call that makes it.
- **Bytes** (`bun run size`): gzip grows 211 B in `f-slim`, 216 in `t2-stage` and 196 in `t2-features`, with core 0.5 KB more minified in each. Their budgets were raised by what this measured, 0.2 each, to 197.3, 244.5 and 252.2. Solid's slim apps are as they were.

## Amendment (#977, 2026-11-25): a call finishes before its `onComplete` runs

**What happened.** ADR-0074's audit, rows 16 and 17. `settledOne`, every call's landing (a plain Subject's, a sequence's, a Batch's), resolved the call, then called `onComplete`, then ended it `"finished"`. An `onComplete` that threw skipped the end:
- the call stayed `"running"` for good, `play()` did nothing, and Solid 2's `scope.settled()` stayed pending;
- a plain call's was logged at every landing, as an `afterFlush` failure;
- a Batch call's ran inside `Batch.step`, so its throw ended the Batch's run (ADR-0069, *Amendment (#977)*);
- a call that moved no member threw out of `animate()`.

**Decided** (#977's grill, Q4): by ADR-0074's *Amendment (#979, group A)*, as Motion's `JSAnimation.finish()` does, the call ends first, then its `onComplete` runs in a `try`. A throw there is reported each time it lands (`wardic.animate: an onComplete failed`), on the call's runtime (`controlsOf` takes it from `started`).

```ts
isResolved = true
UndefinedOr.map(resolve, (done) => done())
end("finished", true)
UndefinedOr.map(onComplete, (complete) => {
  try {
    complete()
  } catch (defect) {
    runtime.runFork(Report.failure("wardic.animate: an onComplete failed", Cause.die(defect)))
  }
})
```

- **What's different:** an `onComplete` sees the call `"finished"`, as Motion's does, so a `play()` from it plays the call again. Its scope hears the call end before `onComplete` runs.
- **Tests:**
  - **WO29** (`wardic-object.test.ts`): a plain call's throwing `onComplete` sees `"finished"`, is reported at each landing, and `play()` plays the call again.
  - **OB17 and OB18** (`object-batch.test.ts`): a Batch call's, and a call that moves no member.
- **Mutations:** three caught, each run alone: the order swapped back, the `try` dropped, the report dropped.
- **Row 16 is done here.** Group C keeps rows 18, 19 and 20: a function Segment's callback, and on `cancel()`, and `delay(i, n)`.

## Amendment (#979, group C, 2026-11-25): a call ends, though its function Segment or its `delay` throws

**What happened.** ADR-0074's audit, group C (rows 18, 19 and 20; row 16 is *Amendment (#977)*'s). Each was probed on `main`:
- **Row 18, a function Segment's callback** (`callbackTrackOf`). The track runs a machine on its own fiber, its sink calling `callback.call(value)` each frame. A throw failed the fiber, and `landed` reported `wardic.animate: a function Segment failed` once but never settled the track. The callback was told nothing more, and the sequence stayed `"running"` for good.
- **Row 19, its `cancel()`.** It ends the run, then tells the callback its first stop. A throw there came out of `controls.cancel()` before the other tracks were cancelled, the head sought to 0 and the call ended, so the call stayed `"running"`, with nothing logged.
- **Row 20, `delay(i, n)`.** A list call worked out each Subject's transition, its `delay` called, as it built that Subject's track, and building a track takes its keys. So a `delay` throwing at index 1 came after index 0 had taken its keys from the animation running them, which broke *Amendment (#973)*'s "takes nothing". The mixed path, members' elements beside plain Subjects, did the same.

**Decided (grilled 2026-11-25, Q1–Q6 each A):**
1. **A callback's throw is its own** (Q1): a `try` in the sink, around the direct call. Wardic's own read of the frame's value comes before it, so only the app's call is caught. The callback is told the next frame's value all the same, and the Segment lands as its stops do, so the sequence lands (ADR-0074 decision 4). One that throws at its last frame isn't told that value again, as a Batch member at rest isn't retried (*Amendment (#977)*). A run of throws is reported once, ended by its next normal return or by its track's next run (decision 3), under the message it had. `landed`'s failure branch stays, for a failure of the machine itself.
2. **On `cancel()`, the track ends first** (Q2), as it did: its run interrupted. Then its callback is told its first stop inside a `try`, reported each time (`wardic.animate: a function Segment's cancel failed`), and `controls.cancel` goes on. No `try` per track in `controls.cancel`: a function Segment's is the only cancel that calls app code. A plain track's put-back goes through the gate (#969), a Batch's through its run (#977).
3. **Every transition is worked out before any track** (Q3): a first pass computes each Subject's transition, its `delay(i, n)` called, in the list path and the mixed path. A `delay` that throws stays an error at the call that takes nothing, the app's own error, as ADR-0074 keeps a refusal at the call. The one-Subject path already worked its transition out first.
   - Rejected: catching it, using a delay of 0 and reporting it, which would turn the app's error at its own call into a quiet fallback.
4. **A Batch part's `delay` too** (Q7, from the review). A call's `delay` function goes to each Batch part as well, and core's Batch calls it at the part's first play, `delay(rank, n)` over its movers, in `started`'s run loop: after the plain tracks had taken their keys, and after the scope was told the call started.
   - **The order:** the Batch parts run first, as both paths already order them. A mixed call's plain tracks are each built as they run (`builtAtRun`), so a Batch part's throw comes before any plain key is taken.
   - **The scope:** a run that throws stops the call (`made.controls.stop()`) before the throw goes on, so its scope hears it end. That also covers a call of a Batch alone, which had left its scope waiting for good.
   - Rejected: leaving it to a follow-up, and catching it in the Batch with a delay of 0.

**Cost** (Q4), against `main` on the quiet bench host:
- **#973's call bench, extended** (`.tmp/979c/`): `main`'s `Imperative.ts` against the branch's (the review's, with `started`'s `try`) in paired processes, 12 pairs, medians and quartiles:

  | call | Bun 1.3.13, `main` | branch | Node 22.22, `main` | branch |
  |---|---|---|---|---|
  | one object, two keys, + stop | 6.6 µs | −1.7% [−5.7%, +4.8%] | 7.0 µs | −1.0% [−3.3%, +0.2%] |
  | 100 objects | 609 µs | −3.4% [−5.9%, +1.9%] | 653 µs | +0.6% [−1.3%, +2.6%] |
  | 100 objects, a `delay(i, n)` | 687 µs | −2.0% [−3.4%, +0.8%] | 891 µs | +1.3% [−0.1%, +4.6%] |

  Each is within its spread. The first build, before the review, read the same (+0.2% and −0.5% for the `delay` call).
- **`bench:core --base main`** passes on Bun, Node and Chromium at the first try.
- **Size:** `f-slim` +79 B gzip, `t2-stage` +161 B and `t2-features` +176 B, the apps with the Imperative track. Their budgets were raised by that, to 197.7, 245.4 and 253.1.

**Tests** (Q5): each failed on `main` first.
- **WO30** (`wardic-object.test.ts`): a function Segment whose callback throws for three frames, returns, then throws to its last frame. It's called every frame, the object lands, and the sequence ends `"finished"` and resolves. It's reported twice, once a run. Played again while still throwing, it's reported a third time, then told 1 at its end.
- **WO31:** `cancel()` while the callback throws at its first stop. Nothing comes out of `cancel()`, the object's Segment is put back, the call is `"idle"`, and it's reported once.
- **WO32:** a list call whose `delay` throws for the second object. It's an error at the call, and an earlier call on the first object runs on and lands.
- **CV13** (Solid 2's `create-batch.browser.test.tsx`): the mixed path, a member's element between two plain ones, a `delay` throwing for the later plain one, then for the member, then for a call of the Batch alone. The earlier call on the first plain element lands each time, and the scope is left waiting on none. Q5 had object's seam alone, but the mixed path is the DOM's only and untested code can't be mutation-checked: Q8 kept it.
- **Mutations:** 11 of 11 caught, each run alone:
  - the sink's `try` dropped;
  - its flag never set, never cleared, or kept from the last run;
  - each report dropped;
  - the cancel's `try` dropped;
  - each path's first pass undone;
  - a mixed call's plain tracks built before its Batch parts run;
  - `started`'s stop dropped.

  The first pass's two mutations were first written leaving that pass in, and slipped through. Undoing the pass with them, as `main` has it, was caught.
- **The review** (standards and spec) found:
  - the Batch part's `delay` (decision 4);
  - the sink's `try` wrapping Wardic's own read of the value;
  - the flag kept across runs;
  - the two arrays read by index (now `Arr.zipWith`);
  - the message repeated (now `SEGMENT_FAILED`);
  - the changeset's wording.

  All are fixed.

Group C is done. Groups D to I, and rows 37 and 38 (#981, #983), are left in #979.

## Amendment (#979, group H, 2026-11-27): Animation controls refuse a call whose function throws, taking nothing

ADR-0074's rule for Animation controls (#433): #979's row 35. ADR-0074's *Amendment (#979, group H)* records the group, its cost and its tests; this is the controls' part.
- **Before:** `start` and `set` set each element's entry as they called its function, so one that threw for a later element came out of the call with the earlier elements already changed and the rest unreached, as row 20's `delay(i, n)` did before group C. Motion's `animationControls.start` does the same (framer-motion 14.9.0).
- **Now** every element's entry is worked out first, in order, its function called (`Controlled.entryOf`), and only then is each set: a throw comes out of `start()` or `set()` as before, a refusal at the call (ADR-0074's scope), and no element has changed.
- **On Foldkit,** `AnimationControls.start`'s Command dies with the throw, as a Command's own defect does: ADR-0071's part.
- **Pinned by** ACV6 (Solid 2, `start` and `set`), AC14 (Solid 1) and Foldkit's AC12.

## Amendment (#975, 2026-11-28): a function Segment takes a value with no options

**What happened.** The function Segment's types took `[callback]`, `[callback, options]` and `[callback, value, options]`. Its JSDoc and Solid's sequences page promised `[callback, value?, options?]`, and Motion's motion value Segments, which these stand in for, take `[value, keyframes]` with no options (`MotionValueSegment`, beside `MotionValueSegmentWithTransition`'s `[value, keyframes, options]`, framer-motion 14.10.1). Run time read a two-part Segment's second part as its options. `[callback, 5]` dropped its 5 and was told 0 to 1. `[callback, [0, 1]]` threw: the array's `at`, its method, reached the sequence's start (`self.startsWith is not a function`).

**Decided (grilled 2026-11-28, Q1–Q5):**
1. **It's taken** (Q1).
2. **Value or options** (Q2): a two-part function Segment's second part is its value when it's a number, a string or a list of stops, and its options otherwise. A three-part one reads as before. `stepsOf` decides it once a call, never a frame, by `isFunctionSegmentValue`, which `isSegmentValue` (a target's values) now extends with `null`.
3. **Types** (Q3): the value forms take their options optionally, `[callback, value, options?]`, a number's and a string's. It's still four forms, which every binding takes from core. An array can't pass for options: its `at` is a method, which `at?: WardicSequenceTime` doesn't take.
4. **Tests** (Q4): WO34 (`@wardic/object`, Node).
   - `[callback, 5]` runs from 0 to 5.
   - `[callback, [1, 0]]` runs through its stops; they differ from the default 0 to 1, so they can't pass for it.
   - `[callback, ["0px", "10px"]]` and `[callback, "10px"]` run a string's.
   - `[callback, { duration: 0.1 }]` is still options, moving on its 0.1 s.

   WO34 fails on the old rule with the issue's throw. `@wardic/object`'s types test takes the three value forms and still reads `[callback, { duration: 1 }]` as options.
5. **The record** (Q5): this amendment and a patch for `@wardic/core`. The JSDoc and Solid's sequences page already said it.

**Mutations:** 5 of 5 caught, each run alone, the file restored from a copy:
- the old rule;
- the value check without stops, without strings, or without numbers;
- a two-part Segment's options read from its third part, which the options Segment's own timing catches.

**Size:** `f-slim` +16 B gzip, though 7 B fewer minified, its budget raised to 199.4. The other budgeted apps were 0, 0, 0 and −22 B.
