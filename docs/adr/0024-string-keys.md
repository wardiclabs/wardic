# String keys: a string Snapshot, a real start, and when a pair that can't blend switches

A string-valued key (a colour, a unit string, a keyword) animates through the spine from where it is, as Motion does (#56). The Snapshot keeps every key's last value, strings included. A string key with no value starts from its Base value's start links (ADR-0022). Under a spring, a string key follows the same spring on a 0→1 progress. A pair no Interpolator can blend, a **Discrete pair** (CONTEXT.md), switches at its leg's first frame, except a `display` or `visibility` pair turning to `none` or `hidden`, which switches at its last. Before, every string key snapped to its target on the first frame, `initial` or not.

This amends ADR-0005 (the Snapshot and the spring's string leg), ADR-0015 (a mismatched template's snap) and ADR-0022 (which left string starts and returns to #56).

## Why

- **A colour never animated** (#56): `<wardic.div initial={{ "background-color": "#000" }} animate={{ "background-color": "#fff" }} />` paints `rgb(0, 0, 0)`, then `rgb(255, 255, 255)`, under the default spring and under a tween alike.
- **The cause, at `4b7b65b`** ([string-keys.md](../research/string-keys.md)):
  - the Snapshot holds numbers only: seeded with `numericOf(initialValues)`, merged back with `numericOf(frame.value)` (`use-wardic.tsx:559`, `:943`);
  - under a spring the string leg starts each key at its own target (`:983`) and runs a 0.3 s linear tween with no `delay` and no stagger (`:987`);
  - under a tween the targets are spread over the start (`:926`);
  - #47's start loop covers numeric keys only (`:876-889`), so a colour returned to its Base value by snapping too (ADR-0022, Consequences).
- **The same gap reached further:**
  - a Retarget mid-flight (a hover left early) jumped a colour to its new target;
  - a staggered list's colours started at once while its numbers waited;
  - once a string key gets a real start, a pair the registry can't blend holds its old value for the whole leg (`t < 1 ? from : to`): `pointer-events: none` would stay on for the length of the animation.
- **Motion animates a string from its painted value, and switches what it can't blend at the start** (read at `16c6122`, run on `motion` 13.5.0 in Chromium 147, cases S1–S10 and SX in [string-keys.md](../research/string-keys.md)):
  - a class's blue with `whileHover` red paints blue → red → blue, both ways (S1, Motion's C8); a colour with no `initial` animates from its own value (S10);
  - a Retarget mid-flight starts from the current value (S5x; S-f);
  - under an explicit spring, a string follows the spring's progress (S3, S9; `JSAnimation.ts:132-148`);
  - a pair it won't animate is instant, on frame 1 (S7; `can-animate.ts`, `make-animation-instant.ts`), and a pair it can't mix switches at `p > 0` (`mixImmediate`);
  - `display` and `visibility` turn visible on frame 1 and invisible at the end (S8; `mixVisibility`).

## Decisions (grilled 2026-10-07 against Motion @ `16c6122` and `motion` 13.5.0)

- **The Snapshot holds strings (decision 1, amends ADR-0005).**
  - It keeps each key's last emitted value, a number or a string; its velocities stay numeric. It's seeded from all of `initial`, and every leg merges its whole frame into it.
  - At a Retarget, a key's Snapshot value is coerced to the shape of its target with `valueLike` (ADR-0022). One that can't be (`"auto"` for a numeric target, a length in another unit) falls back to the start links, then to the target.
  - A Retarget mid-flight then leaves from the last painted value, and `initial`'s string is a real start.
- **A string key with no value starts from its Base value's start links (decision 2).** Its `style` value, else its Own value, each coerced by `valueLike`; with neither, its target. ADR-0022's decision 1 already said this for every key; #47 only wired it for numbers. A string key that leaves the target returns through the chain the same way, and now animates there.
- **A Discrete pair switches at its leg's first frame (decision 3, amends ADR-0015).**
  - Core's discrete fallback becomes `t > 0 ? to : from`, in the registry, the `unit` interpolator and the `complex` interpolator: the first frame past the leg's `delay`.
  - It's Motion's `mixImmediate`. Motion makes a pair it won't animate at all (`canAnimate` false: `flex-start`, `hidden`, a named colour) instant even through a `delay`. Its source tries to wait (`if (… || !delay) onUpdate(final)`), but then shows the overwritten first keyframe through the delay. Wardic waits for the delay.
- **`display` and `visibility` turn invisible at the end (decision 4).**
  - For these two keys, by name, a pair from any other value to `none` or `hidden` switches on the leg's last frame, the one with `done: true`. Every other pair of theirs follows decision 3, so `none` → `block` switches on the first frame.
  - So `{ opacity: 0, display: "none" }` fades out and then removes the element, and the reverse shows it first.
  - **By key, not by value:** `animate={{ height: 0, overflow: "hidden" }}` must clip from the first frame, and `pointer-events: none` must take hold at once. Motion scopes it the same way (`can-animate.ts:36` exempts the two keys by name).
  - **The last frame, not progress 1:** under an underdamped spring Motion's progress crosses 1 and back, and `display` flickered `none` / `block` three times (SX). The settle frame can't flicker, whatever drives the progress.
  - In core's multi-value blend, which already resolves each key by name; the registry stays keyed by value only. *Superseded by ADR-0035: the rule is the DOM Environment's `visibility` Key rule (`@wardic/dom`'s `key-rules.ts`), which the registry asks by the key's name; core names no CSS property.*
- **Under a spring, a string key follows the spring (decision 5, amends ADR-0005).**
  - The spring's string leg runs one spring with the transition's options (stiffness, damping, mass, rest thresholds and `delay`) on a 0→100 progress from rest, and blends each key through the registry at progress / 100. One transition then drives the whole element: a colour arrives with the scale beside it, and a stagger delays both.
  - A `restDelta` or `restVelocity` applies to the progress as it would to a numeric key travelling 100. Motion's progress spans 0–100 too.
  - **Each Retarget restarts the progress at 0, with no velocity.** A colour carries none in Motion either, and Motion carrying a unit string's px/s into the progress lunged it to 2.5 px (S9).
  - **Past the target:** a colour holds at its target, since culori clamps the blend's progress to [0, 1], and dims on each swing back, as in Motion (S3). A unit string overshoots like a numeric key. Decision 3's switch happens at progress > 0, decision 4's at the leg's settle.
  - Under a tween, nothing changes: `animateValues` already drives every key with the tween's options.
  - **The element settles with its last leg.** The spine reports settle (`onFrame`, ADR-0007's orchestration) once every leg has settled, no longer when the numeric leg alone has: a colour's leg can now outlast an opacity's.
  - The presence exit's string leg follows its spring the same way.
- **The server is unchanged (decision 6).** A string `initial` was already in the Starting style; nothing reads on a server (ADR-0021). Server markup and hydration don't change.
- **Animatable `none` is out (decision 7).** Motion grows `boxShadow: "none"` → a shadow from a zero shadow, and `filter: "none"` → `blur(4px)` from `blur(0px)` (`getAnimatableNone`, S7). Under decision 3 these switch at the first frame, as they already snapped before. It's a new capability of the complex tier (ADR-0015): #61. *Superseded by ADR-0015's Amendment (#61): an empty end now grows from its Animatable none, and the leg's last frame writes `none` back.*

## Considered Options

- **Strings kept in a separate map beside the numeric Snapshot** (decision 1). Rejected: two maps to keep in step for one value per key, and the presence record already keeps one merged map.
- **Keep t = 1 for a Discrete pair** (decision 3). Rejected: with real starts, the old value holds for the whole leg.
- **Switch at t = 0.5** (decision 3). Rejected: no precedent in Motion, and half a leg of the wrong value either way.
- **Motion's instant switch through a `delay`** (decision 3). Rejected: it reads as an accident in Motion's source, and a staggered list's keywords would ignore the stagger.
- **The visibility rule by value**, any pair turning to `none` or `hidden` (decision 4). Rejected: `overflow: hidden` would clip only at the end of a collapse, and `pointer-events: none` would leave a fading element clickable.
- **Switching `display` / `visibility` at progress 1** (decision 4). Rejected: it flickers under an underdamped spring (SX).
- **Keep the 0.3 s tween under a spring, passing the delay** (decision 5). Rejected: the colour and the spring beside it arrive at different times, and the spring's options never reach a string key.
- **Motion's split**, a 0.3 s eased tween with no transition and the spring's progress with one (decision 5). Rejected: it follows from Motion's per-key default transitions, which Wardic doesn't have; Wardic's default is a spring for every key.
- **`springValues` taking string keys** (decision 5). Rejected: its frame's `value` and `velocity` are numeric maps, and widening them changes a Tier 2 type every consumer of it reads.
- **Carrying velocity into the progress** (decision 5). Rejected: a velocity in a key's units has no meaning on a 0–100 progress (S9's lunge).
- **Animatable `none` here** (decision 7). Rejected for #56's scope: #61.

## Consequences

- **New surface:**
  - core's `springBlend(from, to, options)`, beside `animateValues` (Tier 2, ADR-0008): every key blended through the registry by one spring's progress. Both share one blend, with decision 4's rule;
  - the spine's Snapshot type, `Values` with numeric velocities, and the drag track's view of it.
- **Breaking:**
  - core: a Discrete pair switches at the first frame (`t > 0`), not at t = 1, through `animateValues`, the registry's `resolve` / `interpolate`, and the `unit` and `complex` interpolators. An SVG `d` of a different structure takes its target's shape on the first frame.
  - Under a spring, a string key takes the spring's time and `delay`, not a 0.3 s linear tween: under the default `170/26`, about 0.5 s.
  - `display` and `visibility` from `none` / `hidden` turn visible on the first frame, not at the end.
  - The fix itself: a string key animates from its start, where it snapped to its target.
- **Costs:** none at rest. Per Retarget with string keys, one progress spring in place of a tween; per frame, one blend call per string key, as before.
- **Where Wardic still differs from Motion:**
  - **Defaults:** with no transition, Motion tweens every key that isn't a transform for 0.3 s; Wardic springs every key (ADR-0005).
  - **`backgroundColor` on WAAPI:** Motion re-estimates a stopped WAAPI animation's value, so its Retarget jumps to a colour never painted (S5). Wardic paints every key in JS and starts from the last painted value.
  - **Colour space:** Wardic blends in sRGB (culori `"rgb"`), as WAAPI does; Motion's JS colours blend in a linear-light space.
  - **Named colours:** Motion doesn't animate `"red"` (not animatable, SX); culori parses it, so Wardic does.
  - **Gradients of two kinds:** Motion blends `radial-gradient` → `linear-gradient` in the target's template when the colour counts match; Wardic's `complex` tier needs one template, so it switches at the first frame.
  - **A delayed instant pair:** decision 3.
  - **Units:** as ADR-0022. A numeric Snapshot value under a `%` target is coerced to a bare number, which the `unit` interpolator reads in `%`.
- **Deferred:** #61 (animatable `none`); #55 (`var()` values and custom properties: a `var()` target is a Discrete pair and switches at the first frame).
- **Pinned by** (written red, before the fix):
  - core, node: `discrete-pair.test.ts` (DP1–DP9: a Discrete pair at `t > 0` in the `complex` and `unit` tiers and through the registry, keywords, a colour and a keyword, unparseable units, a number and a keyword, two paths; DP3, below 0, and DP9, a pair that blends, are guards), with `interpolate.test.ts` and `complex-interpolate.test.ts` moved off t = 1;
  - `@wardic/test`, node: `visibility-keys.test.ts` (DV1–DV7: `animateValues`' `display` / `visibility` rule, by key, through a delay; DV1 and DV7, a turn to `none` on the last frame, are guards: t = 1 already did it) and `spring-blend.test.ts` (SB1–SB9: a colour and a unit string sharing `springValues`' progress frame for frame; the delay; a colour held at its target under an underdamped spring and dimming on the swing back; a unit string's overshoot; `display` on the settle frame only; a Discrete pair at the first frame past the delay; rest thresholds on the 0–100 progress; no `from` or `velocity`; a key missing from `from`);
  - `@wardic/solid`, in Chromium:
    - `string-keys.browser.test.tsx` (SK1–SK14: a colour sharing an `x`'s progress on every painted frame under the default spring, a tween and a delay; a length string from its own value with `overflow` on the first frame; C8 there and back; a Retarget mid-flight; the commit sinks, `wardic.create(Component)`, `use:ward` and `use:reorderItem`; the exit from a hover left mid-flight; `display` out under a tween and a bouncy spring, with no flicker; `visibility` out; SK13, `display` in on the first frame, is a guard);
    - `svg.browser.test.tsx`'s path morph, which passed before the fix only because the `d` snapped: it now waits for the landing and checks the morph is painted;
    - `base-values.browser.test.tsx`'s M19, whose comment no longer expects a snap;
  - the server tier: `server.ssr.test.tsx` (SV21, a guard: a string `initial` renders as it is);
  - the hydrate project: F17 (a string `initial` held at the first paint after hydration, then animated, not snapped, to its target).

## Amendment to ADR-0005, ADR-0015 and ADR-0022

- **ADR-0005:** the Snapshot holds every key's last value, strings included, and a spring's string keys follow the spring (decisions 1 and 5).
- **ADR-0015:** "Mismatch → snap" now snaps at the leg's first frame, `t > 0 ? to : from` (decision 3).
- **ADR-0022:** its Consequences left string starts to #56. A string key now starts from its start links and returns through the chain by animating (decision 2).

## Amendment (#65, 2026-10-07): where a Discrete pair is decided, and incompatible units

- **One place.** Decision 3's fallback was in the registry, the `unit` interpolator and the `complex` interpolator. With interpolators as codecs (ADR-0026), a Discrete pair is decided once, in `resolve`: when no entry decodes both endpoints, or an entry decodes both and its `blend` returns `None`. It still switches at the first frame past 0.
- **Incompatible units.** Two lengths in different units (`"10px"` → `"1em"`) are a Discrete pair, with a warning at `resolve`. `resolve` died on them before, which failed the element's whole leg. Decision 1's `valueLike` already treated "a length in another unit" as a value it can't coerce.
