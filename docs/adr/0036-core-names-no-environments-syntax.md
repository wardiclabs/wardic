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
   - Core keeps `number`, `array`, `unit` and `complex`. culori, a CSS colour Interpolator and its codec move to `@wardic/dom`, registered in the colour tier's place. Core's default registry has no colours, so in the Test Environment a colour is text with numbers in it (see *Colours* below).
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

## Colours (the second PR)

- **Core:**
  - `Interpolator.complexWith({ text, tokens })` and its codec, `complexStringWith`, take an Environment's kinds of token: each `{ pattern, entry }`, the Interpolator its tokens decode, blend and encode through. The text spans match first, then each kind's tokens, then numbers.
  - A decoded token is a number or `{ kind, value }`, where `kind` is the entry's name: a Tier 2 breaking change to `ComplexToken`.
  - Two values blend with the same count of each kind, and the n-th token of a kind blends with the n-th of that kind through its entry. If the entry can't blend a pair of its tokens, the two values are a Discrete pair.
  - A lone token of a kind isn't a complex value. It belongs to its kind's own tier, as the DOM's lone colour belongs to its colour tier.
  - `color`, `ColorString` and culori leave `Interpolator`, and `defaults` is `[number, array, unit, complex]`. `parseAndFormat` is exported, so an Environment can build its codecs the way core builds its own. culori stays a devDependency, for the bench.
  - **Without an Environment's colours, a colour is text with numbers in it.** `#000` → `#fff` is a Discrete pair, since `#fff` holds no number. `rgb(0, 0, 0)` → `rgb(255, 255, 255)` blends its three channels as numbers. The Test Environment is one such Environment. Core's own tests use made-up kinds.
- **`@wardic/dom`:**
  - `colors.ts`: `ColorString`, `color(mode)`, `cssColor` (sRGB) and `COLOR_TOKEN` (Motion's colour token, #61). They are the same code as core's were. *Since ADR-0026's Amendment (#156), `color("rgb")` blends with Wardic's own lerp and format, writing culori's strings.*
  - `complex.ts`: `VARIABLE_REFERENCE` and `cssComplex`, which keeps a `var()` as text and reads a colour as a kind of token blended through `cssColor`.
  - `interpolators` lists number, array, `cssColor`, unit and `cssComplex`, the order core's defaults had.
  - **Found while implementing:** the Key rules built each zero with core's complex codec, which read the digits in a `var()` name as a number. A shadow holding `var(--gray-500)` went to `none` through `var(--gray0)`, an undefined variable, until its last frame. The rules now use the DOM's codecs (AN15).
- **The bench harness** (`registryOf`) brings the same colours as a tier and as a kind of token, for a core that has none. It uses core's own registry for a core that has `Interpolator.color`. Both sides of a ratio blend colours alike: on the workloads' pairs, the harness's registry and the DOM's give the same strings.

### Measured

- **`bench:core`** (`--base main --head 0735ff0`, 11 paired reps, 1,000 elements, on the bench box). Main's core blends through its own colours, and head's through the harness's.
  - Bun and Chromium: every workload passes, within −3.7% to +2.6%. Their noise controls were −1.2% and −0.5%.
  - Node's first run was too noisy to judge (control +3.1%), though every workload was within +1.7% and its bytes per frame matched main's on every workload. The Node rerun (control −0.1%) passes every workload's time, within +2.3%.
  - In that rerun, Node's bytes gate flagged `animateValues/loop` (0.73 → 0.81 MB) and `springBlend/loop` (0.69 → 0.76). Head read what the first run read on both sides, 0.81 and 0.76: main read low this time. This gate is known to flap on these two workloads with identical code (#94).
  - The steps-only probe settles the flag (`.tmp/160-bytes`, #94's probe with the harness's colours for head: 1,000 machines stepped by hand over 2,000 frames, the bench's heap hook). `springBlend`: 480,294 bytes a frame on both sides, 9 reps. `animateValues`: both sides land on the same three GC-quantized values, 640k, 688k and 736k bytes a frame, with identical ranges over 21 reps; their medians fall on different ones. 0.297 against 0.301 ms a frame.
  - `animateComplex`, whose shadow's colour is now a kind of token: +2.4% (Bun), +0.8% (Node) and −0.2% (Chromium), and +1.9%, +1.1% and +0.0% in its loop form.

### Pinned by (colours)

- **core, node:**
  - TK1–TK6 (`complex-interpolate.test.ts`), with two made-up kinds: `<n>`, a step blended rounded, and `!word`, a flag that blends only into itself. They cover decoding (a kind's digits are never numbers, and a lone token is its kind's own), blending through the kind, kind-by-kind matching, a kind that can't blend making a Discrete pair, encoding (and failing on a kind the codec doesn't have), and routing through a registry.
  - `codecs.test.ts`: the default complex codec names no colour.
- **`@wardic/dom`, node:**
  - CL1–CL18 (`colors.node.test.ts`), moved from core's codec, Interpolator, Discrete pair and complex tests and from `@wardic/test`'s SB1–SB3: `ColorString`, the colour Interpolator, colour pairs through the DOM's registry, colour tokens, and a spring's colour holding at its target past 1.
  - CV3 lists the DOM's tiers.
  - AN15: a `var()` in a shadow keeps its name on the way to `none`, or to one shadow fewer.
- **solid, Chromium:** the browser tests run on `DomLive` and are unchanged, 833 of them, the colour, shadow and variable tests among them (VB1–VB9).
- **Mutation-checked** in a separate worktree: ten single-point mutations, each failing the tests meant for it:
  - the DOM's registry without its colour tier;
  - the DOM's complex tier without the colour kind;
  - the tokenizer naming no token's kind;
  - matching ignoring the kinds' counts;
  - a kind's tokens pairing from the start's last;
  - the Key rules building zeros with core's codec (AN15);
  - a kind that can't blend falling back to its target;
  - a lone token of a kind read as a complex value;
  - a kind's token encoding as its value's string;
  - an empty end's colours not turning.

## Amendment (#189, 2026-10-16): the pointer events in core's words, the wheel removed, and a lint guard

#43 moved the keyboard event to core's own names (ADR-0037). Its review found the pointer and wheel events still copying the DOM's fields, by their own doc comments: "DOM `buttons` convention", "DOM `pointerType` convention", "DOM `button` convention", "DOM `isPrimary`". So #189 was filed. Core read them in five places, plus solid's `drag.ts`, for three things:
- which pointer counts (`isPrimaryPointer`);
- who hovers (hover's fold ignored `pointerType === "touch"`);
- when a hold went stale (`buttons === 0` on a move, and `supersedes`).

Nothing read the wheel.

**Decisions (grilled 2026-10-16, all A):**
1. **A pointer's kind is a core union** (Q1): `kind: InputSource.PointerKind`, which is `"mouse" | "pen" | "touch" | "other"`, replacing `pointerType: string`. An Environment maps its platform's kinds onto it, and an unknown one becomes `"other"`, as an unknown key becomes `Key`'s `"other"`. The glossary has **Pointer kind**.
   - Rejected: capabilities instead of a kind (`hovers`, `usesButtons`), since `supersedes` still compares kinds and Motion's rules are written about mice and touches; keeping an opaque `pointerType` string.
2. **`pressed: boolean` replaces the `buttons` bitmask** (Q2). It says whether any button is down during the event. That's the only question core and solid's `drag.ts` asked (`buttons === 0`). A pressed pointer's moves are pressed, and an unpressed move from a held pointer is a lost release (a **Stale gesture**, ADR-0019).
   - Rejected: a bitmask with core's own bit meanings, which no one reads; dropping it, which reopens ADR-0019's Stale-gesture rule.
3. **Core keeps the Primary pointer rule, over neutral fields** (Q3). The fields:
   - `button: InputSource.PointerButton`, which is `"main" | "middle" | "secondary" | "other" | "none"`: the button the event changed, `"none"` on a move;
   - `primary: boolean`: the event is its kind's first contact on the page, and a mouse always is.

   `isPrimaryPointer` is still Motion's: a mouse event counts with its main button or none, and any other kind follows `primary`. The rule stays in one place for every Environment, and stays available to a custom recognizer (ADR-0019's Tier 2).
   - Rejected: each Environment deciding primary-ness, which repeats Motion's mouse rule in every Environment and hides the button; `button` as a boolean shaped around one rule.
4. **The wheel is gone until a recognizer needs it** (Q4). `wheel(target)` and `WheelLikeEvent` leave `InputSource`, along with dom's wheel stream and the test Environment's stubs. Nothing read it and nothing planned to. Its fields copied `WheelEvent`'s, and dom dropped `deltaMode`, so a line-mode wheel (Firefox, some mice) would have arrived in lines with core none the wiser. The recognizer that first needs a wheel defines it in core's words, and its units, against a real use.
   - Rejected: keeping it in pixels with dom converting lines and pages, which decides a line's height with nothing to test it against; passing the DOM's `deltaMode` through as a unit.
5. **Checked at each tier, and held by lint** (Q5).
   - core: `isPrimaryPointer` over every kind, button and `primary` (C2, 40 rows), and the builder's defaults in core's words (C1). The existing held-pointer, recognizer, drag-activity and pointer-rules tests moved to the new fields, unchanged in meaning.
   - dom: `pointer-names.node.test.ts` PN1–PN3 maps each `pointerType` (an unknown one to `"other"`), each `button` (0/1/2/-1 and the rest), `buttons` to `pressed` (any bit), and `isPrimary` to `primary`; the browser tier's I7 maps a real pen.
   - **The guard:** core's lint (`EVENT_NAMES` in `eslint.config.js`) rejects the DOM's event names in core's source, as an identifier or a string: `pointerType`, `buttons`, `isPrimary`, `deltaX`/`Y`/`Z`, `deltaMode`, `preventDefault`, `defaultPrevented`.
6. **This amendment** (Q6). ADR-0019 points here where it names the DOM's fields, and so does ADR-0037's key names.

**Default stated:** `makePointerLikeEvent` keeps a mouse's defaults in core's words: kind `"mouse"`, primary, `button` `"main"` on a down or up and `"none"` otherwise, and pressed on a down or move. `@wardic/test`'s scripts follow it.

**What changes for an Environment:**
- It maps four fields where it mapped four: `kind`, `pressed`, `button` and `primary`. dom's `kindOf` and `buttonOf` are its own.
- It provides no `wheel`.

Behaviour is unchanged. The browser tests and the layout lab's drives read the same, since every DOM value maps to what it meant before.

**Found on the way:** a test's options type that still declared `buttons` passed it to the builder by spread, where TypeScript doesn't check excess properties, so a lost release silently stayed pressed until the tests ran (drag-activity A2, A13). The test tier now declares only core's names; only a DOM-event helper (solid's `drag-hops`) keeps the DOM's.

