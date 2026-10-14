# Core names no Environment's syntax

`@wardic/core` holds nothing specific to the DOM or CSS, so an Environment that isn't a browser (a terminal, a headless one) can use it as it is. Core defines contracts, as services and registry hooks, and each Environment provides what its platform means by them: its Key rules (ADR-0035), the spans of text and the kinds of token in its complex values (#158, and the colours below), and which keys move its elements. `@wardic/dom` provides the DOM's.

## Why

The rule came from review, in the user's words:
- "Is there a reason we have css specific terms being referenced in the core package? The core package is meant to be environment agnostic." (#61, which moved the Key rules out: ADR-0035)
- "I don't want anything dom specific to exist within core, that way we can prepare for other environments such as 'terminal' or 'headless'." (#158, which moved `var()` out of the complex tier)

#160 took an inventory of core's source after #158 (main `820278b`, 2026-10-14). Two things in it still knew CSS:
- **Reduced motion's positional keys.** `ReducedMotion.POSITIONAL_KEYS` was the transforms plus `width`, `height`, `top`, `left`, `right` and `bottom`, Motion's `positionalKeys` (ADR-0029). The transforms are Wardic's own vocabulary; the six box keys are CSS property names.
- **The colour grammar.**
  - culori is a core dependency.
  - `Interpolator.color` and `ColorString` parse CSS Color syntax and write `rgb()` / `rgba()`.
  - #61's colour tokens match `#hex`, `rgb()` and `hsl()` inside a complex value.

What stays in core is Environment-neutral:
- the `number`, `array` and `unit` tiers (a number with any suffix, never `px` by name);
- the `complex` tier (numbers among text), with the spans and token kinds its Environment names;
- the transform keys (`x`, `scale`, `rotate`…).

Comments and examples that name CSS describe the DOM Environment's use, not core's behaviour.

## Decisions (grilled 2026-10-14)

1. **An Environment names its Positional keys, through a service** (Q1).
   - `ReducedMotion.PositionalKeys` is a core service: `{ isPositional: (key) => boolean }`. Core's own Layer, `transformsOnly`, names the transforms only (`ReducedMotion.isTransform`).
   - `ReducedMotion.split(values, keys)` stays pure and takes the service's value. `POSITIONAL_KEYS` and `isPositional` go from core.
   - `@wardic/dom`'s `PositionalKeysDomLive` names the transforms and CSS's six box keys, in either spelling through `dashCase`. `DomLive` provides it. `@wardic/test`'s `testLayer` provides `transformsOnly`.
   - The Solid provider reads it once with `runtime.runSync`, as it reads the `Probe`, and both `split` calls (an animation, the presence exit) pass it. `WardicServices` requires it, so an Environment without it doesn't compile: two of Solid's tests built their own and had to add it.
   - The user asked to see the alternative sketched first: a parameter (`split(values, isPositional)`, with the binding passing the DOM's predicate). Rejected because a binding that forgets falls back silently, and `width` animates under reduced motion. Also rejected: the same list through the registry, beside the Key rules, since reduced motion isn't blending.
2. **Colours move to the DOM Environment, through the registry** (Q2–Q4, the second PR):
   - Core keeps `number`, `array`, `unit` and `complex`. culori, a CSS colour Interpolator and its codec move to `@wardic/dom`, registered in the colour tier's place. Core's default registry has no colours, so in the Test Environment a colour pair is a Discrete pair.
   - The complex tier takes an Environment's token kinds, each an Interpolator entry plus a pattern: `complexWith({ text, tokens: [{ pattern, entry }] })`. The DOM's colour Interpolator is one. Matching generalises #61's colour count: the same count of each kind, in order. A decoded token is a number or `{ kind, value }`, a Tier 2 breaking change.
   - `bench:core`'s harness brings its own colour Interpolator, so a core with colours and one without blend the same colours and their ratio stays comparable.
   - Rejected: colours kept in core as shared value grammar (React Native and many terminal libraries read CSS colour strings too), and a split where core blends a neutral RGBA value that the DOM parses and formats.
3. **This ADR** (Q5), with pointers from ADR-0029 (the box keys), ADR-0026 and ADR-0015 *Amendment (#61)* (colours), and ADR-0035 *Amendment (#158)* (text spans, the first case).
4. **Two PRs under #160** (Q6): the Positional keys first, then colours.

## Pinned by (the Positional keys)

- `@wardic/test` (`reduced-motion.test.ts`):
  - `isTransform` is the transform keys, not the box keys;
  - `transformsOnly` provides them;
  - `split` follows the keys it's given.
- `@wardic/dom` PK1–PK2 (`positional-keys.node.test.ts`): the DOM's keys in both spellings, and `PositionalKeysDomLive` provides them.
- solid, Chromium (`reduced-motion.browser.test.tsx`):
  - RM-S8, a guard: in the DOM, `width` snaps under reduced motion.
  - RM-S9: an Environment whose Positional keys name only `opacity` snaps opacity and grows `width`. The binding honours the Environment's keys, not a list of its own.
  - RM-S10: the same Environment's presence exit snaps opacity too.
- **Mutation-checked** in a separate worktree: five single-point mutations, each failing the tests meant for it:
  - the provider ignoring the Environment's keys;
  - the DOM naming no box keys;
  - `split` ignoring the keys;
  - the spine's split ignoring the keys;
  - the presence exit's split ignoring them. This one was first missed, which is why RM-S10 exists.
