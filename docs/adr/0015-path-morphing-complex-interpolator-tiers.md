# Path morphing: a generic complex interpolator in core + arbitrary morphing as a separate package

Path morphing splits into two tiers with different homes:

- **Tier-1 (this ADR) — same-structure morphing via a generic *complex value* interpolator** in `@wardic/core`. A string with ≥2 embedded numbers (an SVG `d`/`points`, a `filter`, a multi-part `box-shadow`) is parsed into a non-numeric *template* + the ordered numbers; if two endpoints share the template (identical structure + count), the numbers interpolate component-wise; otherwise it snaps (discrete). Default-on, dependency-free, tiny.
- **Tier-2 (deferred) — arbitrary-structure morphing** (aligning paths with *different* command counts: parse → normalize segment counts → match subpaths/rings → rotate start point → blend). This is a standalone geometry concern (flubber/polymorph-class) and ships as its **own opt-in package `@wardic/path-morph`**, registered as a higher-precedence interpolator when wanted — never in the default bundle, never a `@wardic/dom` import.

## Why

`d`/`points` morphing is *value interpolation*, so it belongs in the interpolator registry (the value layer), not the DOM applier — `@wardic/dom` already writes the tweened `d` via `setAttribute` (ADR-0014) and stays unaware of how it was produced. And tier-1 isn't really *path* logic: the same "interpolate a string's embedded numbers when templates match" machine is Motion's general `complex` value type, covering `filter`/`box-shadow`/gradients too — so it's a general core primitive that earns its place regardless of whether tier-2 ever ships.

Tier-2 is genuinely separable and broadly useful **outside animation** (icon morphs, dataviz shape tweening) — which is exactly why flubber/polymorph exist as standalone libraries. Keeping its heavier geometry in an opt-in package means apps pay for it only by registering it.

## Decisions (grilled against Motion's complex value type)

- **One generic `complexInterpolator`** (not a `d`-specific one): matches `typeof string && ≥2 numbers`; parses with a number regex into `{ template, numbers }`; interpolates iff `template` *and* number count match, else discrete `t < 1 ? from : to`. Covers `d` + `points` + any multi-number string.
- **Registered LAST** in `defaultInterpolators` (lowest precedence): `number`/`array` first, then `color`, then `unit`, then `complex`. So `"10px"` → unit (single number), `"#fff"`/`"rgb(…)"` → color (matched earlier), and only genuinely multi-number structural strings fall to `complex`. The registry's pair-aware `selectEntry` returns the first matching entry, so order is the precedence.
- **Mismatch → snap, by design.** Different command structure (template differs) or count can't blend numerically — that's precisely what tier-2 solves. Documented, not worked around.
- **Numbers-only (no embedded-color parsing) in v0.1.** `d`/`points` are purely numeric; a `box-shadow`'s rgba channels still blend as plain numbers (acceptable, ~rgb-linear). Embedded-color-aware complex blending is a possible later refinement, independent of this.
- **Arc-flag limitation documented.** SVG `A`/`a` arc flags are treated as numbers, so an arc path can interpolate through invalid flag values; same-structure `M/L/C/S/Q/T/Z` morphing is sound. Motion has the same limit without a path normalizer.

## Considered Options

- **`d`-only path interpolator.** Narrower; misses `points` + the general complex win for barely less code. Rejected.
- **Pull a path-normalization engine into core now (tier-2 inline).** Real geometry work + bundle weight for a feature most apps don't need; and it's standalone-useful, so it deserves its own package + grill. Deferred to `@wardic/path-morph`.
- **Put morphing in the DOM applier.** Wrong layer — morphing is value interpolation; the applier only writes the result. Rejected.

## Consequences

- New `@wardic/core` interpolator `complexInterpolator` (`interpolate/complex.ts`), exported + appended to `defaultInterpolators`. No applier, no contract, no `@wardic/dom` change — `setAttribute("d", …)` already writes the result.
- Same-structure `d`/`points` morph out of the box; `filter`/`box-shadow` strings gain numeric morphing too.
- **Tier-2 is a future package** `@wardic/path-morph` (own grill): a dependency-free path normalizer exposing a registry interpolator entry registered at higher precedence; opt-in, never bundled by default.
- Node-tier tests cover the pure interpolator (same-structure morph, points, signed/decimal, multi-part shadow, mismatch-snap) + registry routing (complex wins for paths, never steals `10px`/hex colors).

## Amendment (#56, 2026-10-07): a mismatch snaps at the first frame

"Mismatch → snap" now snaps at the leg's first frame, `t > 0 ? to : from`, not at its end (`t < 1 ? from : to`), and so does every other pair the registry can't blend, a **Discrete pair** (CONTEXT.md). Once a string key starts from its painted or Own value, a snap at the end would hold the old value for the whole leg; Motion's `mixImmediate` switches at `p > 0` too. A path of a different structure therefore takes its target's shape on the first frame (ADR-0024, decision 3).

## Amendment (#65, 2026-10-07): the complex tier is a codec

The complex tier is a Schema codec, `ComplexString`, and a blend (ADR-0026). A string carrying two or more numbers decodes once, when a stream is built, into its parts (the pieces around the numbers) and its numbers. Two of the same structure blend number by number, and each frame only lerps the numbers and interleaves them with the parts: it no longer parses both strings. Two of different structures are still a Discrete pair, and `resolve` now logs a warning for them, as Motion warns on a pair "too different to mix". "Matches" in the decisions above now means "decodes".
