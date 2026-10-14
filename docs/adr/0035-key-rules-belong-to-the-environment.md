# Key rules belong to the Environment: core names no CSS property

A pair can blend differently because of the key it belongs to. `display` turning `none` waits for the leg's last frame (ADR-0024, decision 4), and a `box-shadow` from `none` grows from a transparent zero (ADR-0015, *Amendment (#61)*). Those rules know CSS: its property names, what `none` and `hidden` mean, a filter's identities, a shadow list's commas. Core is environment-agnostic, so they belong to the Environment. The `InterpolatorRegistry`, already the Environment's service for how values blend, gains **Key rules** (CONTEXT.md). An Environment registers them, and each hands back the whole blend for the key it takes. Core holds none: `@wardic/dom`'s registry, which `DomLive` provides, carries the DOM's. This amends ADR-0024 (decision 4's home), ADR-0026 (the registry is no longer keyed by value only) and ADR-0015's *Amendment (#61)* (where its rules live).

## Why

- **Where it stood** (PR #157 at `a249c29`, #61 implemented): core's `Machine.ts` named `display` and `visibility` (ADR-0024 put the rule "in core's multi-value blend, which already resolves each key by name"). #61 added `internal/animatableNone.ts`, which held:
  - CSS property names (`box-shadow`, `backdrop-filter`, `-webkit-mask-image`) and a camelCase-to-CSS-name conversion, which is `@wardic/dom`'s `dashCase`;
  - CSS semantics: each filter function's identity, a mask's opaque colours, a shadow list split at commas with omitted lengths at 0, a `calc()` divisor, and `none` / `auto` as keywords.
- **The review question:** why core, which is meant to be environment-agnostic, references CSS. A native Environment has no `filter` strings or `box-shadow` lists. ADR-0014 drew the same line for SVG: core carries values and how they blend; the DOM realisation lives in `@wardic/dom`.

## Decisions (grilled 2026-10-13)

1. **The seam is the registry** (Q1). The `InterpolatorRegistry` gains Key rules, registered like Interpolator entries: `InterpolatorRegistry.make(entries, keyRules)`, and `registerKeyRule`, which puts a rule ahead of those already there. The registry is no longer keyed by value only. One service owns how a pair blends in an Environment, and the Environment's service list doesn't grow.
2. **A rule hands back the whole blend for its key** (Q2):
   - Its `blend(key, from, to, resolve)` returns `None` to decline, or the Effect that builds the key's `KeyBlend`, `(t, done) => value`, resolving any pairs by value through `resolve`.
   - The registry's `keyBlendOf(key, from, to)` gives the first rule's that takes the key, latest registered first. `blendersFor` asks it once per key, and when no rule takes the key, it makes the plain blender inline as before. That keeps #61's bench fix: one blender factory shared by every key made `blendAt`'s call site megamorphic.
   - A rule declines synchronously, allocating nothing, since every rule is asked for every key of every leg; #61's bench measured what a rule's work at stream build can cost a key it doesn't take.
   - A `KeyBlend` is on the per-frame path (ADR-0025).
3. **`display` / `visibility` moves too** (Q3): the DOM's `visibility` rule. Core's `blendersFor` names no CSS property.
4. **Only the complex tier stays in core** (Q4): one or more numbers, colour tokens, and kind-by-kind matching. The DOM builds each zero with core's public codecs (`ComplexString`, `ColorString`). The empty ends, `auto`, the `calc()` divisor, the filter and mask rules and the shadow split are the DOM's.
5. **The Test Environment stays CSS-free** (Q5). `@wardic/test`'s `testLayer` keeps core's default registry, which has no Key rules, so there a `display` pair turning `none` is a Discrete pair. The DOM rules' tests run in `@wardic/dom`'s node tier, over `testLayer` with the DOM's registry in place of the default.
6. **This ADR** (Q6), with pointers from ADR-0015's *Amendment (#61)*, ADR-0024's decision 4 and ADR-0026.

## The DOM's Key rules (`@wardic/dom`'s `key-rules.ts`)

- **`visibility`:** `display` and `visibility` turning to `none` or `hidden` show their start until the run's last Frame (ADR-0024, decision 4).
- **`animatableNone`:** the Animatable none and the shadow list (ADR-0015, *Amendment (#61)*).
- Both take a key by its CSS name or in camelCase, through `dashCase`: `WardicValues` types keys as CSS names, and camelCase works as well.
- `keyRules` lists them, `InterpolatorRegistryDomLive` is core's registry with them, and `DomLive` provides it. All three are Tier 2 exports. (The registry moved to `interpolators.ts` in *Amendment (#158)*.)

## Considered Options

- **A separate Environment service for Key rules** (Q1), beside the registry, read with `Effect.serviceOption`. Rejected: two services deciding how one pair blends, and the registry's "keyed by value only" kept by moving the question next door.
- **Rules passed on each run** (Q1), an option to `animateValues` and `springBlend`. Rejected: every caller must pass them, and a run without them silently loses the rules.
- **A rewrite shape** (Q2): a rule returns the pairs to blend, a separator and whether to land, and core keeps the landing and joining. Rejected: "join with a separator" is a CSS list in core, and the visibility rule blends nothing.
- **Separate small questions** (Q2): core asks whether a value is an empty end, what a key's zero is, how a value splits. Rejected: the questions are CSS's shape, so core keeps CSS's structure.
- **A follow-up for `display` / `visibility`** (Q3). Rejected: one leak left, and the seam shipped with two homes for key rules.
- **A value-level `zeroOf` exported from core** (Q4). Rejected: the `calc()` divisor rule would sit in core, and the codecs already let the DOM build zeros.
- **The DOM's rules in the Test Environment** (Q5). Rejected: `@wardic/test` would depend on `@wardic/dom`, and the headless Environment would behave like the DOM for these keys.

## Consequences

- **Tier 2 (ADR-0008):** the `InterpolatorRegistry` service gains `registerKeyRule` and `keyBlendOf`, and `make` a second parameter. A hand-written implementation of the service must add both. `KeyBlend`, `KeyRule` and `ResolveByValue` are new types.
- **An Environment without the DOM's registry** blends `display: none`, a shadow from `none`, or a shadow list by value, as Discrete pairs where they don't decode together. `@wardic/test`'s `testLayer` is one.
- **The per-frame path** (`docs/agents/effect-first.md`) includes a Key rule's `KeyBlend`: the DOM's in `key-rules.ts`.

## Measured on this branch

- **`bench:core`** (`--base main --head a5cfdea`, 11 paired reps, 1,000 elements). The bench runs core's default registry, which has no Key rules, so it measures core's side: `blendersFor` asking `keyBlendOf` and getting `None`.
  - In Bun and Node, every workload without a complex value is within ±2.9%. Start times are at main's or lower, since core no longer runs #61's rules at stream build.
  - Chromium's first run was too noisy to judge: its control was +3.8% while the lab's dev server served page loads. Its rerun is within −3.1% to +1.0% on the same workloads.
  - `animateComplex` is the accepted cost of #61's colour tokens (ADR-0015, *Amendment (#61)*; #156): +7.7% (Bun), +2.5% (Node, bytes +5.5%) and +3.9% (Chromium) per frame, and +19.0%, +8.8% and +12.4% in its loop form.
- **The DOM's rules at stream build** (`.tmp/61/decline.ts`, Node 22, the bench's four string keys, none of which a rule takes): `keyBlendOf` costs about 70 ns a key with the DOM's two rules, against 10 ns with none. That's about 0.3 ms per 1,000 elements of four keys, once per leg.
- **The layout lab** (scenario 15's fifth row on `DomLive`'s registry): the scripted run (`.tmp/vel-lab/drive.ts`, `ONLY=s15n`) passes every line. A hand run in Chrome 155 passes every toggle and hover once the lab marks a run its cell's next run cuts short as superseded, and judges a toggle from the value it starts at. Both fixes are the lab's own.

## Pinned by

- **core, node** (`key-rules.test.ts`, KR1–KR4): a rule gives the blend of the key it takes; a key every rule declines has none; the first rule that takes a key wins, in `make`'s order and with `registerKeyRule` ahead; and core's default registry has no Key rules (`display`, `visibility`, `boxShadow`, `filter`).
- **`@wardic/test`** (`key-rule-blend.test.ts`, KB1–KB2): a rule's blend runs for its key through `animateValues` while the other keys blend by value; and, as a guard, the Test Environment's `display` → `none` is a Discrete pair. `machines.test.ts`'s reference blend mirrors `keyBlendOf`.
- **`@wardic/dom`, node** (`key-rules.node.test.ts`): DV1–DV8, the `visibility` rule, moved from `@wardic/test` with `spring-blend`'s SB5 as DV8; and AN1–AN14, the Animatable none (ADR-0015, *Amendment (#61)*).
- **solid, Chromium, on `DomLive`:** `string-keys.browser.test.tsx` SK11–SK14 and `animatable-none.browser.test.tsx` AB1–AB4, unchanged.
- **Mutation-checked** (`.tmp/61/mutate.py`): 20 single-point mutations, each failing the tests meant for it. Three are on the seam itself: the registry ignoring its rules, `blendersFor` not asking it, and the `visibility` rule taking every `display` pair.

## Amendment (#158, 2026-10-14): a complex value's text spans come from the Environment

#61 made the complex tier take a string with one or more numbers, and it read the digits in a CSS variable's name as numbers: `var(--gray-500)` → `var(--gray-600)` blended through `var(--gray-550)`, an undefined variable, so a background painted transparent mid-leg (#158). The fix keeps a `var()` as text. `var()` is CSS's syntax, so by this ADR it isn't core's: core gets a neutral seam, and the DOM supplies the syntax.

- **Core:** `Interpolator.complexWith({ text })` and its codec, `complexStringWith({ text })`, take patterns for spans that are only text.
  - A text span is matched whole, before colours and numbers, so the digits in it are never numbers. It's kept in the text around the tokens.
  - A string with no number or colour outside its spans isn't a complex value.
  - Two values blend only with the same count of spans, besides #61's colour and number counts (Motion's `mixComplex`, for its `var()`). The target's text is written, its spans with it, so a span takes the target's at the first frame, as Motion's `mixImmediate` does.
  - `Interpolator.complex` and `ComplexString` are the same with no spans: core names no Environment's syntax.
- **`@wardic/dom`** (`interpolators.ts`):
  - `VARIABLE_REFERENCE` is CSS's `var(--name)`, with a fallback one bracket level deep (Motion's var token).
  - `cssComplex` is core's complex tier with it.
  - `interpolators` is core's defaults with `cssComplex` in the complex tier's place.
  - `InterpolatorRegistryDomLive` moved here from `key-rules.ts`: the registry of the DOM's Interpolators and Key rules.
- **Without the DOM's registry,** a `var()` is just text with numbers in it again. The Test Environment and core's own tests have no CSS variables to keep.
- **Considered:**
  - The var token in core, as #159 first had it. Rejected on review: core names no Environment's syntax, for a future terminal or headless Environment.
  - An Environment-neutral heuristic, "digits stuck to a name aren't numbers". Rejected: an SVG path's `M-5,10` and `L10-5` are numbers stuck to letters and digits.
- **#55** resolves a whole `var()` against the element before it blends (an element-bound Key rule). This amendment only keeps the names out of the numbers.
- **Pinned by:**
  - core's `codecs.test.ts` and `complex-interpolate.test.ts`, with a made-up `@name` span;
  - `@wardic/dom`'s `interpolators.node.test.ts` CV1–CV4: the `var()` pairs switch, lengths blend around a `var()`, the other tiers are core's, and the codec keeps a `var()` as text;
  - solid's SK18, with real paint: only the two greys.
- **Mutation-checked**, in a separate worktree: five single-point mutations, each failing the tests meant for it:
  - the DOM giving no spans;
  - spans not folded into the text;
  - matching ignoring the span count;
  - a lone span taken as a complex value;
  - spans matched after numbers. This one is caught only by a span that starts with a digit, which is why the test has one.
