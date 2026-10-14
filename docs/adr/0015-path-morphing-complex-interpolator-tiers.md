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

## Amendment (#61, 2026-10-13): one or more numbers, colour tokens, kind-by-kind matching, and the Animatable none

The complex tier blends what Motion's complex type blends, and a pair's empty end (`"none"`, `0`) stands for an **Animatable none** (CONTEXT.md), so a shadow, filter, mask or fill grows from nothing and goes back to it. This supersedes decision 1's "two or more numbers", decision 3's "mismatch → snap", decision 4 ("numbers-only"), and ADR-0024's decision 7 ("Animatable `none` is out").

**Before**, measured on main `1243d8c` (`.tmp/61/`; Motion is framer-motion 13.4.0, `.tmp/vel/none-drive.ts`, Chromium 147 and Firefox 148, which agree):

| Pair | Motion | Wardic |
|---|---|---|
| `boxShadow`: `none` → `0px 0px 10px rgb(255, 0, 0)` | grows from `rgba(255, 0, 0, 0) 0px 0px 0px` | switches at the first frame |
| the shadow → `none` | rests at `rgba(255, 0, 0, 0) 0px 0px 0px`, never `none` | switches at the first frame |
| `filter`: `none` ↔ `blur(4px)` | from `blur(0px)`; rests at `blur(0px)` | switches |
| `filter`: `none` → `brightness(2)` | from `brightness(1)` | switches |
| `drop-shadow()` in a filter from `none` | kept as it is: full size on the first frame, and left at rest on the way back | switches |
| `backdropFilter`: `none` → `brightness(2)` | from `brightness(0)`, black, and back to it | switches |
| `maskImage`: `none` → a gradient | from a transparent gradient, hidden, and back to it; `mask` stays visible | switches |
| SVG `fill`: `none` ↔ `#ff0000` | fades in from `rgba(255, 0, 0, 0)`; rests there | switches |
| `padding`: `"0"` → `"4px 8px"` | opens from `0px 0px` | switches |
| `maxHeight`: `none` → `100px` | collapses to `0px` first; rests at `max-height: 0px` on the way back | switches |
| shadow red → blue (`rgb()`) | blends the colour | switches: numbers only |
| `blur(4px)` → `blur(8px)` | blends | culori threw and the leg failed (#154); with #154, switches: one number |
| a stylesheet shadow (`rgba(0, 0, 0, 0.2) 0px 1px 2px 0px`, as computed) → `0px 8px 24px rgba(0, 0, 0, 0.3)` | blends; the way back switches (3 numbers against 4) | switches both ways |

Grilled on 2026-10-13 (#154 split out first and fixed in PR #155):
1. **One or more numbers** (Q2). A string with one or more numbers or colours among other text is a complex value: `blur(4px)`, `translateX(10px)`, `inset(10px)`. A string that is only a number with a unit stays a unit string, and a lone colour stays a colour. Rejected: a tier of its own for one CSS function, and special-casing the blur in the none rule only.
2. **Colour tokens** (Q3). A `#hex`, `rgb()`, `rgba()`, `hsl()` or `hsla()` inside a complex value is one token that blends as a colour, through culori in sRGB as the colour tier blends (Motion's colour token; a named colour stays text, as in Motion). Rejected: colour tokens as their own issue first; staying numbers-only, which grows a shadow at full colour with no fade.
   - *Since ADR-0036 the colour token is the DOM Environment's: core's complex tier takes an Environment's kinds of token (`complexWith({ tokens })`), and `@wardic/dom`'s `cssComplex` names a colour as one, blended through its colour tier. Core's own complex tier reads a colour's channels as numbers.*
3. **The empty ends** (Q4): `"none"`, `0`, `"0"`, or a zero with a unit (`"0px"`), Motion's `isNone`. Facing a complex value or a lone colour, an empty end becomes that value with every number at 0 (a `calc()` divisor kept) and every colour transparent. Facing `auto`, another empty end, or a plain length, the pair stays a Discrete pair.
   - **A plain length isn't a template** (a follow-up found implementing). Motion's rule takes `"100px"` too, and `maxHeight: none` → `100px` collapses to `0px`, then rests at `max-height: 0px` on the way back, though `none` there means no limit. The same holds for `max-width`, `perspective`, and the `scale` property (`none` is 1). Wardic keeps `none` ↔ a plain length a Discrete pair. The cost: an individual `translate` or `rotate` property from `none` to one length switches; the `x` and `rotate` keys don't use it.
4. **Two kinds of key** (Q5), by CSS name or camelCase:
   - **Filters** (`filter`, `-webkit-filter`, `backdrop-filter`, `-webkit-backdrop-filter`): each function goes to its identity, 1 (or 100%) for `brightness`, `contrast`, `saturate` and `opacity`, 0 for the rest. A `drop-shadow()` grows from a transparent zero, like a shadow. Motion's filter type covers only `filter` and `WebkitFilter`, so its backdrop goes through black, and it keeps a `drop-shadow()` as it is.
   - **Masks** (`mask`, `-webkit-mask`, `mask-image`, `-webkit-mask-image`): numbers go to 0 and colours stay opaque, so the element stays visible. Motion's mask type covers only `mask` and `WebkitMask`.
   - Rejected: Motion's keys exactly.
5. **The way back** (Q6). The leg blends to the Animatable none, and its last frame (`done`) writes the target as given (`"none"`, `"0"`), as the `display` / `visibility` rule waits for it (ADR-0024, decision 4). At rest the element is what the author wrote: a filter or backdrop filter other than `none` makes a stacking context and a containing block for `fixed` and `absolute` descendants, a mask makes a stacking context, and a transparent SVG fill catches pointer events, where `fill: none` doesn't. #57 chose `none` over `scale(1)` at rest for the same reason. Rejected: Motion's, resting at the zero.
6. **Matching** (Q7), Motion's `mixComplex`:
   - Two complex values blend when they hold the same count of colours and the start holds at least as many numbers as the target. The target's n-th number blends from the start's n-th number and its n-th colour from the start's n-th colour, written in the target's parts. So a computed shadow blends into an authored one, colour first or last. Any other two are a Discrete pair, with `resolve`'s warning.
   - **The shadow rule**, for `box-shadow` and `text-shadow`: the two lists are split at their top-level commas and matched shadow by shadow. A length missing from a shadow counts as 0 (CSS's default for an omitted blur or spread), and a shadow missing from one end grows from its Animatable none. The list's last frame writes the target as given. So the stylesheet shadow blends back too, which Motion switches, and stacked elevation shadows line up.
   - Rejected: a missing number counting as 0 for every key. A shorthand copies an omitted value rather than zeroing it, so `padding: "4px 8px"` → `"4px 8px 12px"` would drop the bottom to 0 on the first frame. Also rejected: keeping the same-structure rule with colour tokens, which switches the stylesheet shadow both ways.
7. **No clamp**, as Motion: a spring that crosses an empty end can give a negative blur, shadow or padding for a few frames. The browser ignores an invalid value and keeps painting the last valid one, and a colour holds transparent (culori clamps), so it doesn't show.

**Where it lives.** The complex tier's codec and blend are in `Interpolator.ts` (`ComplexString` decodes to `{ parts, tokens }`, a breaking change to Tier 2's decoded shape, ADR-0026 decision 8). The key-aware rules (the empty ends, each key's zero, the shadow split) are the DOM Environment's **Key rules** (ADR-0035): `@wardic/dom`'s `key-rules.ts`, which its `InterpolatorRegistry` carries and core's `blendersFor` asks before blending a pair by value. They were first written in core, as the visibility rule was, and moved there before merging: core names no CSS property.

**Measured on this branch**:
- **Through `animateValues`** (AN1–AN14 below): each pair in the table grows as Motion's does. A shadow, filter or fill going back rests at `none`, the `backdropFilter` starts from `brightness(1)`, the `maskImage` stays visible, `maxHeight` still switches, and the stylesheet shadow blends both ways.
- **The layout lab** (`.tmp/vel-lab/drive.ts`, `ONLY=s15n`, Chromium, the default spring): scenario 15's new row passes every line on this branch:
  - each toggle starts from 0 and settles at its value;
  - going back, **rests** reads `none`;
  - the hover shadow blends back through 20 frames.

  On main's core every toggle fails **start** both ways, and the hover shadow fails **start** and **end**.
- **The cost**, `bun run bench:core --base main --head 8e4f1fb`, 11 paired reps, 1,000 elements:
  - Every workload without a complex value is within ±2.5% in all three engines. Node's bytes gate flagged `animateValues/loop` and `springBlend/loop` (0.73 → 0.80, 0.69 → 0.76 MB), which is the known flap on those two: main read 0.80 and 0.76 in this branch's other runs (#94).
  - `animateComplex`: +3.9% (Bun), +3.8% (Node, 6.42 → 6.77 MB per frame, which fails the bytes gate), and +4.2% (Chromium) per frame.
  - `animateComplex/loop`: +22.6%, +8.0% (2.30 → 2.65 MB) and +16.3%, which fail.
  - That workload's shadow, `rgba(0,0,0,0)` → `rgba(0,0,0,0.25)`, now blends its colour through culori on every frame: about 315 ns a call, against 250 ns for main's numbers-only blend (`.tmp/61/percall.ts`, Node). Start time is +6 to +11 ms per 1,000 such elements.
  - **Accepted**, as ADR-0026 (decision 5) accepted culori per frame for the colour tier: a colour token costs what a `background-color` already does, and only a complex value holding a colour pays it. A cheaper sRGB blend for both is #156. *Since ADR-0026's Amendment (#156), the DOM's sRGB blend is Wardic's own: culori's strings, without a colour object per frame.*
- **Two Node regressions found and fixed on the way**, both in workloads the new rules don't touch. Neither showed in Bun or Chromium, and neither was per-frame work:
  - Every key's blender made by one shared factory made `blendAt`'s call site megamorphic: `animateValues`, `springBlend`, `animateRepeat` and `animateRepeatDelay` were 7–9% slower per frame. A key no rule applies to keeps the blender made where main makes it. A probe with `blendersFor` as on main was flat.
  - The rules' `Option` chains running at stream build for keys they can't apply to (`opacity` from `0`, `pointer-events` to `none`) left `animateValues` about 5% slower when it ran after the bench's earlier workloads, though not alone. A cheap check, an empty end facing a usable other end or a shadow key between two strings, now skips them.

**Pinned by**:
- **core, node:**
  - `codecs.test.ts`: `ComplexString` decodes one number (`blur(4px)`) and colour tokens, rejects a unit string and a lone colour, and canonicalises a colour inside it.
  - `complex-interpolate.test.ts`: a shadow's colour blends as a colour, a hex matches an `rgb()`, kind-by-kind matching (a computed shadow into an authored one), a start short of numbers and a different count of colours don't blend, and a named colour stays text.
  - `discrete-pair.test.ts` DP15: `blur(4px)` → `blur(8px)` blends.
- **`@wardic/dom`, node** (`key-rules.node.test.ts`, AN1–AN14, through `animateValues` and `springBlend` over `testLayer` with the DOM's registry; first written in `@wardic/test`, ADR-0035):
  - a shadow, a blur and a fill, both ways, resting at `none`;
  - the filter identities and a growing `drop-shadow()`;
  - `backdrop-filter` and `-webkit-filter`, as CSS names and camelCase;
  - a mask against a background image;
  - a zero against a multi-value `padding` and `margin`;
  - the stylesheet shadow both ways, stacked shadows, and a missing shadow;
  - `text-shadow` and a `transform`;
  - a bouncy spring writing `none` once, on its settle frame;
  - guards: `max-height: none` against a length (AN8), and pairs with no empty end (AN14).
- **solid, Chromium** (`animatable-none.browser.test.tsx`, AB1–AB4, with real paint):
  - a shadow, and a blur whose `position: fixed` child is placed by the viewport again once the blur rests at `none`;
  - an SVG fill;
  - a stylesheet shadow under a toggle, both ways.
  - SK16 (`string-keys.browser.test.tsx`) now blurs through radii in between.
- **The lab's board** (`examples/layout-lab/test/base-values-board.test.ts` BV10–BV12): the toggle run, the **rests** line, and a gesture that must blend back. Scenario 15 gains a fifth row (**Toggle none**: shadow, blur and fill from none; a hover shadow on a stylesheet `box-shadow`), with hand runs R48–R50.
- On main, AN1–AN7 and AN9–AN13 and AB1–AB4 fail; AN8 and AN14 pin what main already did.
- **Mutation-checked** (`.tmp/61/mutate.py`): 17 single-point mutations, each failing the tests meant for it:
  - in the tier: two or more tokens, equal number counts, a colour token that doesn't blend, and a lone colour taken as complex;
  - in the rules: no zero with a unit, no identity 1, a `drop-shadow()` kept, a transparent mask, keys not normalised, and no shadow clause;
  - in the shadow rule: no 0 for a missing length, no split, and a missing shadow as `none`;
  - in `blendersFor`: no landing for one pair, and none for a shadow list;
  - in the lab: the rests line, and the blend back.

  The order of the token regex's two alternatives changes nothing (a number can't start where a colour does), so it isn't counted.
