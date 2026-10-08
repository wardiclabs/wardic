# Interpolators as Schema codecs: decoded once when a stream is built, blended and encoded per frame

Each Interpolator is a value kind's Schema codec and a blend (#65). `resolve` decodes both endpoints once, when a stream is built, and the entry's `blend` turns the two decoded values into the closure the frame calls, which lerps and encodes with the codec's plain encode function, never `Schema.encode`. Decoding is matching: an entry takes an endpoint its codec decodes, and a pair of strings is resolved once per registry and kept. The `complex` tier stops parsing both strings on every frame, and the colour tier stops rebuilding culori's interpolator on every frame. `InterpolatorEntry` changes shape, a breaking change to Tier 2. This amends ADR-0015 and ADR-0024, and is ADR-0025's decision 6 for interpolation.

## Why

- **Where it stood at `871a898`:**
  - `complexInterpolator.interpolate` parsed both strings on every call, so on every frame: about 2.4 µs per call in Chromium in #63's probe, almost all of it the parse.
  - `colorInterpolator.interpolate` built a culori interpolator on every call, `formatRgb(culoriInterpolate([from, to], mode)(t))`, parsing and converting both strings each time.
  - `match` and the parsers were two passes over the same string, and they could disagree. The colour `match`'s prefix fast path took `"#zzz"` and `"rgb(var(--x))"`, which culori can't parse, and `" #000 "`, which `match` trimmed and `interpolate` didn't. All three died on the leg's first frame.
  - The registry's `bind` already parsed a unit pair once, through a special case keyed on the entry's name (`entry.name === "unit"`), with the bare-number coercion and an `Effect.die` for incompatible units beside it.
- **ADR-0025's decision 6** named interpolation as Schema's fit in core, the one place core decodes and encodes values: a decode through Schema is affordable when a stream is built, and `Schema.encode` is not, per frame.
- **Measured for this ADR** (a throwaway probe, ns per call after warm-up, Bun 1.3 / Node 22):

  | Call | Bun | Node |
  |---|---|---|
  | the unit codec's decode, success (`"10px"`) | 320 | 315 |
  | the unit codec's decode, failure (`"auto"`) | 840 | 957 |
  | the colour codec's decode, success (`"#000000"`) | 433 | 377 |
  | the colour codec's decode, failure (`"10px"`) | 1,338 | 1,553 |
  | `Schema.Number`'s decode, failure (a string) | 101 | 88 |
  | `colorInterpolator().match("10px")` at `871a898` | 552 | 660 |
  | `unitInterpolator.match("10px")` at `871a898` | 185 | 84 |

  A failed decode costs about 1–1.5 µs, most of it Schema's issue machinery on top of the parse.

## Decisions (grilled 2026-10-07 against effect 4.0.2's `dist`)

1. **One codec shape, a breaking move.**
   ```ts
   interface InterpolatorEntry<Decoded, Encoded> {
     readonly name: string
     readonly codec: Schema.Codec<Decoded, Encoded>
     readonly blend: (from: Decoded, to: Decoded) => Option.Option<(t: number) => Encoded>
   }
   ```
   No adapter for the old `{ name, match, interpolate }`, and no second shape beside it. Core is at `0.1.0-alpha.0`, nothing in the repo or the examples registers an entry, and an adapter would keep a `match` that doesn't decode and an `interpolate` that runs per frame alive for no known user. The two entries planned, `@wardic/path-morph` (ADR-0015) and the v0.1 plan's DOM interpolators, are Wardic's own, and both do work on the pair.
2. **`blend` is a pair step that returns the frame's closure.**
   - `resolve` calls it once, with the two decoded endpoints, and the pair's work happens there: `complex` compares the two structures, `unit` settles the pair's unit, and `color` builds culori's interpolator. `None` is a Discrete pair.
   - The closure lerps, then encodes with the codec's plain encode function, the same function the codec's transformation encodes with, so each format is written once. Where that encode reads a decoded value, the closure fills one it allocated at `resolve` (`complex`'s numbers): nothing is allocated per frame but the output.
   - It's the shape of Motion's mixers: `getMixer(a)(a, b)` returns `(p) => value`.
   - The codec takes no services, because `resolve` decodes synchronously, with `Schema.decodeUnknownOption`.
3. **Decoding is matching, in one pass.**
   - An entry takes an endpoint when its codec decodes it. `match` is gone.
   - `resolve` picks the first entry, in registry precedence, whose codec decodes both endpoints, and hands what it decoded to `blend`, so nothing is parsed twice. Each entry decodes `from` at most once, and `to` only once `from` has decoded.
   - No entry decodes both: a Discrete pair, as before.
   - The registry's three passes go: both endpoints; else, when one endpoint is plain (a number or an array), the other's entry; else either's. They routed `0` → `"10px"` to `unit`'s coercion. With the coercion in `UnitString` (decision 4), an entry the later passes picked never decoded both endpoints, so its pair was a Discrete pair either way. The grill kept the passes; the implementation found them inert, and they were cut the same day.
4. **The unit coercion is decoding, and incompatible units are a Discrete pair (amends ADR-0024).**
   - `UnitString` decodes a bare number too, to `{ value, unit: "" }`, the shape `"120"` decodes to, and `unit`'s `blend` takes the pair's unit from whichever endpoint has one. `0` → `"10px"` lands where it did, and `bindUnit`, `bindNumberToUnit`, `bindUnitToNumber` and the special case by name go. `number` comes before `unit`, so two numbers never reach it.
   - Two different units, both present (`"10px"` → `"1em"`), are a Discrete pair: `unit`'s `blend` returns `None`. They died at `resolve` before, and that defect failed the element's whole leg, so one key stopped every key. CONTEXT.md's Discrete pair is "a pair no Interpolator can blend", and two paths of different structure already were one. Motion doesn't die on it either: `mix("10px", "1em")` blends in the target's unit, `10em` → `1em` (`motion-dom`, #56's install).
   - **A warning, once per pair, at `resolve`.** When an entry decodes both endpoints and its `blend` returns `None` (two units, two structures), `resolve` logs `Effect.logWarning` with the entry's name and both values. A pair of strings warns once per registry, since the registry keeps it (decision 9). Motion warns on a pair it can't mix ("too different to mix"). A pair no entry decodes both of (`"auto"` → `"none"`, a colour and a keyword) stays silent: an ordinary switch. A warning, not a debug log, because debug is below Effect's default minimum level, and the `die` it replaces was loud.
5. **Colour.**
   - **One codec,** `ColorString`: a string ↔ a culori colour, decoded with culori's `parse` (trimmed) and encoded with `formatRgb`. A string culori rejects isn't a colour, the "color string" of CONTEXT.md. The prefix fast path goes: every colour is parsed once, at `resolve`.
   - **`mode` stays per entry:** `colorInterpolator(mode)`, named `color(${mode})`, over the one codec. The registry's default stays `"rgb"`: ADR-0024 keeps sRGB, as WAAPI does, and the v0.1 plan's OKLab line predates it. A colour space per call stays deferred.
   - **`blend` builds culori's interpolator once,** `culori.interpolate([from, to], mode)`, and the frame calls `formatRgb(interpolator(t))`. Two colours always blend.
   - **Accepted per frame:** culori returns a new colour object on each call, beside `formatRgb`'s string (and, outside `"rgb"`, a conversion). Avoiding it means a lerp per mode of Wardic's own, matching culori's rounding, clamping and alpha fixups.
   - Culori clamps `t` to [0, 1], so a colour still holds at its target past 1 (ADR-0024, decision 5).
   - **Behaviour changes:** with a colour, `"#zzz"` and `"rgb(var(--x))"` are Discrete pairs, as ADR-0024 already says a `var()` target is, and `" #000 "` blends. All three died on the leg's first frame.
6. **The one-shot `interpolate(from, to, t)` decodes on every call,** except a pair of strings the registry keeps (decision 9). It stays `resolve` followed by the closure, in lock-step with `resolve`. Only tests call it. The grill rejected a cache of its own: a key over `unknown` endpoints, a bound, and invalidation on every `register`. Decision 9's cache in `resolve` pays those costs, for a measured reason, and `interpolate` shares it.
7. **A bench workload for the complex tier.** `animateComplex` (`packages/core/bench/harness.ts`) blends an icon-sized SVG `d` (20 numbers) and a `box-shadow` through `animateValues`, under the same 2 s tween as `animateValues`. None of the five workloads reached `complex`, so the per-frame parse this ADR removes didn't show. It landed in its own commit, with this baseline: main's core (`871a898`) against itself, 11 paired reps, 1,000 elements, medians of the base side.

   | Workload | Chromium 147 ms per frame | Bun 1.3 | Node 22 | Node MB per frame | Start ms (Chromium / Bun / Node) |
   |---|---|---|---|---|---|
   | `ticksOnly` | 5.59 | 12.55 | 10.07 | 3.09 | 33 / 68 / 60 |
   | `springValues` | 9.31 | 19.23 | 14.96 | 5.50 | 62 / 113 / 110 |
   | `animateValues` | 18.06 | 35.87 | 29.19 | 10.80 | 216 / 307 / 281 |
   | `springBlend` | 16.48 | 34.48 | 22.84 | 10.26 | 159 / 236 / 210 |
   | `chase` | 8.13 | 19.01 | 11.51 | 4.51 | 52 / 111 / 83 |
   | `animateComplex` | 19.33 | 46.20 | 38.82 | 20.72 | 218 / 291 / 244 |

   - Its two keys cost more per frame than `animateValues`' four: 38.82 ms against 29.19 in Node, and 20.72 MB per frame against 10.80.
   - **The MB column is corrected.** The run printed 0.94, 1.19, 2.10, 1.56, 4.51 and 3.34: the bench's bytes gate lost what a scavenge freed inside a measured window, without seeing the scavenge (Consequences). The column holds main's core measured again with the fix, one rep per side and deterministic across two; its times are the run's.
   - Against itself, the paired ratios' medians were within −2.1% to +2.8% in Chromium, −1.7% to +3.6% in Node, and −3.2% to +7.1% in Bun. Bun's `ticksOnly` was off by +7.1%, past ADR-0025's ±3%, so Bun's side of this run counts as too noisy to judge; Node's and Chromium's are within it. `animateComplex` itself: −0.1% (Bun), +3.6% (Node), +2.8% (Chromium).
   - The machine ran slower than at ADR-0025's baseline (`ticksOnly` 5.59 ms in Chromium against 3.72), so these numbers compare within a run, not across ADRs.
8. **The surface.**
   - `InterpolatorEntry<Decoded, Encoded>` keeps its name, and `register` takes it. `resolve` and `interpolate` keep their signatures.
   - The built-ins keep their names, and their order in `defaultInterpolators`: `numberInterpolator` (`Schema.Number`), `arrayInterpolator` (`Schema.Array(Schema.Number)`), `colorInterpolator(mode)`, `unitInterpolator` and `complexInterpolator`.
   - The three string codecs are exported, Tier 2: `UnitString` (`string | number` ↔ `{ value, unit }`), `ColorString` and `ComplexString` (`string` ↔ `{ parts, numbers }`). They're reachable as each entry's `codec` anyway; the names let a custom entry reuse a value kind with a blend of its own.
   - `ComplexString` decodes to `parts`, the pieces around the numbers, split once (`parts.length === numbers.length + 1`). Its encode interleaves them, so the frame never splits a template.
   - `unitOf` stays, for dom's `valueLike`.

9. **Construction cost: sync decodes, and a cache of string pairs (added after the gate run).** The gate run's start times grew: +10 ms (Chromium), +19 ms (Bun) and +55 ms (Node) per 1,000 `animateValues` elements. A probe timed `resolve` per key and three ways to cut it, each prototyped against this branch with the same output on 20 pairs at six progress values. ms per 1,000 elements, each resolving the bench's four keys (a colour, a unit string, a keyword pair, a number), warm / cold (the first 1,000 in a fresh process):

   | Core | Node 22 | Bun 1.3 |
   |---|---|---|
   | main (`871a898`) | 6.6 / 27.3 | 9.9 / 26.7 |
   | this ADR, decisions 1–8 | 13.3 / 59.7 | 12.7 / 55.7 |
   | + a cache of string pairs | 4.2 / 22.2 | 4.1 / 25.2 |
   | + the cache and sync decodes | 4.3 / 20.7 | 4.8 / 19.7 |

   - **Sync decodes.**
     - **The change:** `parseAndFormat` builds both directions from sync getters (`SchemaGetter.transformOptional` and `transform`) in place of `transformEffect`. A parse's `None` leaves the decode without a value, and Schema fails it with its bare `InvalidValue`.
     - **Per key in Node:** a keyword pair 5.1 → 2.4 µs, a unit string 4.4 → 2.9, the bench's path 15.3 → 12.6, its `box-shadow` 8.4 → 5.7. With the cache in place, it matters for values that don't repeat (a width, a path per element), which still miss.
     - **The cost:** a failed decode now says "Expected a valid value", where the codecs said "Expected a number with an optional unit". The descriptive issue was the cost: built in an effectful getter (`transformOptionalEffect`) or in a filter (`Schema.check(Schema.makeFilter(…, { expected }))`), each measured as slow as `transformEffect` or slower, and an `expected` or `message` annotation on the codec doesn't reach the bare issue. The registry discards issues, so only a direct `Schema.decode` of a codec sees the change.
   - **A cache of string pairs, per registry.**
     - **What it keeps:** each pair of strings `resolve` resolves, by `from` then `to` (two `Map`s, so nothing is built to look one up), up to 1,024 pairs. At capacity it starts over, and `register` empties it, since precedence changes. Numbers aren't kept, since they resolve in well under a microsecond, nor arrays, which are keyed by identity.
     - **Why it pays:** elements often animate the same pair (a hover colour, `display`, a shared path). A hit costs 0.4–1.2 µs, against 2.5–15 µs to resolve.
     - **Sharing is safe:** every stream that resolves a pair gets the same closure. The closures are pure, and `complex`'s, which reuses one numbers array, rewrites every number and formats them within each call.
     - **The warning:** a kept pair that can't blend warns once per registry, not once per element: 1,000 elements given `10px` → `1em` log one warning (decision 4).
   - **Not taken: a lighter check on each decode's output,** one property in place of the `Struct`: 0–2 ms per 1,000 elements warm, and nothing measurable cold.

## Considered Options

- **Both shapes side by side, or an adapter for the old one** (decision 1). Rejected: two selection paths, or a non-decoding `match` and a per-frame `interpolate`, kept for no known user.
- **`blend(from, to, t)` returning a decoded value, with a separate `encode`** (decision 2), #65's first sketch. Rejected: the pair's work (two structures, two units, a path alignment) has nowhere to run but every frame, and every frame allocates a decoded value (a `{ value, unit }`; a numbers array as long as the path). **A separate pair step beside that `blend` and `encode`:** three type parameters, and the same value per frame.
- **The three selection passes, kept** (decision 3). Rejected once the code was written: with the coercion in the codec, the second and third passes only ever picked an entry that doesn't decode both endpoints, so they changed no result, and they cost a pair of keywords a second round of decodes.
- **A cheap `match` kept as a guard, decoding only the entry it picks** (decision 3). Rejected: two passes over each string again, and two definitions of what an entry takes, which can disagree, as the colour prefix did.
- **Keeping the `die`, with `blend` throwing inside `Effect.sync`** (decision 4). Rejected: an implicit second channel in the entry's contract, and still one key failing a whole leg. **A typed error in `resolve`'s error channel:** rejected, a Tier 2 signature change and a unit-specific error in the generic registry, and `blendersFor` would still choose between dying and switching.
- **An rgb lerp of Wardic's own** (decision 5). Rejected: a second implementation of culori's rounding, clamping and alpha handling, to save one object per frame.
- **A cache for the one-shot `interpolate`** (decision 6). Rejected in the grill; decision 9's cache in `resolve`, which `interpolate` shares, supersedes it.
- **Sync decodes that keep the descriptive issue** (decision 9): failing from `transformOptionalEffect`, a filter carrying `expected`, or an annotation on the codec. Rejected: the first two cost as much as `transformEffect`, and the annotation never reaches the issue.
- **A lighter check on each decode's output** (decision 9). Not taken: too small to matter.
- **The complex keys added to the existing string workloads** (decision 7). Rejected: one ratio would mix the colour's gain with the complex tier's.

## Consequences

- **Breaking (Tier 2, ADR-0008):** `InterpolatorEntry`'s shape and `register`'s parameter; the built-in entries' fields, where `codec` and `blend` replace `match` and `interpolate`.
- **Behaviour changes:**
  - a pair of strings that can't blend warns once per registry, not once per `resolve` (decision 9);
  - a codec's failed decode says "Expected a valid value" (decision 9);
  - `"10px"` → `"1em"`: a Discrete pair and a warning at `resolve`, where `resolve` died (decision 4);
  - two complex values of different structures: a warning at `resolve` beside the switch they already made;
  - `"#zzz"` and `"rgb(var(--x))"` with a colour: Discrete pairs; `" #000 "`: a blend. All three died on the first frame (decision 5).
- **Costs:**
  - **When a stream is built,** measured after the gate run (a probe, `resolve(from, to)` timed alone, median µs per call, warm):

    | Pair | Node 22 (`871a898` → here) | Bun 1.3 |
    |---|---|---|
    | colour (`#000000` → `#ffffff`) | 0.40 → 2.42 | 0.60 → 2.50 |
    | unit string (`15px` → `200px`) | 2.07 → 3.64 | 2.45 → 3.52 |
    | two keywords (`auto` → `none`) | 2.87 → 4.73 | 3.36 → 4.04 |
    | number | 0.26 → 0.59 | 0.29 → 0.37 |
    | the bench's SVG `d` | 8.02 → 13.71 | 7.81 → 14.45 |
    | the bench's `box-shadow` | 3.01 → 7.48 | 3.41 → 8.16 |

    - Selection decodes through Schema, where a failed decode costs about 1 µs, and `blend` now builds what each frame used to (culori's interpolator, the numbers array).
    - For `animateValues`' four keys in the bench's order (a colour, a unit string, a keyword pair and a number per element), it's +7.3 ms (Node) and +2.8 ms (Bun) per 1,000 elements once warm, and +31 / +27 ms for the first 1,000 in a fresh process.
    - The bench's start time grew more than that: +55 ms (Node), +19 ms (Bun) and +10 ms (Chromium) per 1,000 `animateValues` elements (below). `resolve`'s own time accounts for about 7 of Node's 55 ms once warm, and where the rest goes isn't measured.
    - Start time is reported, not gated (ADR-0025, decision 4). It's paid once per leg, on mount and at each Retarget, in the frame the leg starts. In Chromium, `animateValues`' 10 ms per 1,000 elements is repaid by its per-frame saving (1.7 ms) in about 6 frames.
  - **Per frame, measured:** `bun run bench:core --base 871a898` at the implementation, with the bytes fix below: 11 paired reps, 1,000 elements, median head / base ratio [p25–p75]. Every workload passes both gates, and every noise control is within ±3% (`ticksOnly`: −1.0% Bun, −1.2% Node, −0.7% Chromium).

    | Workload | Bun | Node | Chromium | Node MB per frame | Start ms (Bun / Node / Chromium) |
    |---|---|---|---|---|---|
    | `springValues` | −2.1% [−3.1% – +0.5%] | −4.0% [−9.4% – +3.2%] | −5.1% [−9.2% – +0.4%] | 5.50 → 5.50 | 110 → 112 / 104 → 102 / 58 → 59 |
    | `animateValues` | −5.0% [−8.4% – −4.0%] | −10.3% [−12.9% – −6.6%] | −9.5% [−14.6% – −7.7%] | 10.80 → 7.10 | 316 → 335 / 267 → 321 / 166 → 176 |
    | `springBlend` | −5.5% [−9.5% – −3.6%] | −0.2% [−4.1% – +1.6%] | −10.0% [−13.6% – −5.8%] | 10.26 → 6.56 | 248 → 269 / 200 → 238 / 134 → 148 |
    | `chase` | +1.8% [−4.6% – +4.9%] | +1.6% [−1.7% – +3.4%] | +3.0% [−5.6% – +5.8%] | 4.51 → 4.51 | 98 → 98 / 79 → 81 / 44 → 44 |
    | `animateComplex` | −21.5% [−25.4% – −20.5%] | −40.0% [−42.1% – −36.5%] | −23.5% [−30.1% – −22.9%] | 20.72 → 8.62 | 288 → 332 / 239 → 277 / 181 → 197 |

    - The complex tier gains most: no parse, no template split, and one numbers array per pair.
    - Node's bytes fall 34–58% on the three workloads that blend strings; the three that don't (`ticksOnly` at 3.09 MB, `springValues`, `chase`) are unchanged to the byte.
- **The bench's bytes gate counted wrong, and is fixed (`packages/core/bench/one.mjs`).** It skipped a round with a GC in its window, counting GCs with a `PerformanceObserver`, whose entries arrive as a task; a window only awaits microtasks, so it never saw one. Under `--trace-gc`, main's core scavenged in most `animateValues`, `springBlend` and `animateComplex` windows while the observer counted 0, and the heap delta lost what each scavenge freed. The core that allocated more was under-counted more, so this ADR's first gate run failed `animateValues`, `springBlend` and `animateComplex` on bytes (2.10 → 2.85 MB, 1.56 → 6.56, 3.34 → 8.62) that it had cut. The hook now counts the used heap plus every byte a GC has freed, from a `v8.GCProfiler`, which reports synchronously, and every round counts. Per blender, with nothing collected unseen: a colour 4,240 → 524 bytes per call, the bench's `d` 10,521 → 1,582, its `box-shadow` 3,708 → 571; unit strings, numbers and Discrete pairs unchanged.
- **The per-frame path** (`docs/agents/effect-first.md`): "each Interpolator's `interpolate`" becomes "the closures each Interpolator's `blend` returns". `complex`'s blend keeps its counted loop, in `interpolate/complex.ts`, where lint already allows one.
- **Pinned by:**
  - core, node:
    - `codecs.test.ts`: each codec's decode, what it rejects, and its round trip through `Schema.decode` / `encode` against the plain format (a colour canonicalises to `rgb(…)`, idempotently; a complex value's numbers come back in their shortest form);
    - `interpolate.test.ts`: each built-in decoding its kind and blending through `blend`; `resolve("10px", "20em")` as a Discrete pair with one warning, where it died; a custom entry in the new shape taking precedence;
    - `complex-interpolate.test.ts`: `ComplexString` decoding two or more numbers, and `blend` returning `None` for two structures;
    - `discrete-pair.test.ts` DP1–DP3 through `resolve`, and DP10–DP13: incompatible units, colours culori rejects, an untrimmed colour that blends, and the warning only for a pair an entry decodes both endpoints of;
  - unchanged, and passing: the rest of `interpolate.test.ts`'s and `discrete-pair.test.ts`' registry cases, `@wardic/test`'s `spring-blend` and `visibility-keys`, and solid's `string-keys.browser.test.tsx` and `svg.browser.test.tsx`'s path morph.

## Amendment to ADR-0015 and ADR-0024

- **ADR-0015:** the complex tier is a codec, `ComplexString`, that decodes a string carrying two or more numbers into its parts and numbers. Two complex values of different structures are still a Discrete pair, and `resolve` now logs a warning for them (decision 4).
- **ADR-0024:** a Discrete pair is decided in one place, `resolve`: when no entry decodes both endpoints, or an entry decodes both and its `blend` returns `None`. It's no longer a fallback in the registry, the `unit` interpolator and the `complex` interpolator each. Two lengths in different units are a Discrete pair (decision 4).
