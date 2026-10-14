# Scale-correction registry for projected styles (P2)

A scaling layout projection (ADR-0009) counter-scales an element's *geometry* via the transform, but CSS properties that aren't part of the transform — `border-radius`, `box-shadow` — are still visually distorted by that scale (a 2× element renders a 10px radius as 20px). P2 corrects them with an extensible **scale-corrector registry** (modelled on Motion's `scaleCorrectors`): per-frame, for a scaled projection node, each registered corrector reads the element's own value and emits a **corrected CSS string** that, once the transform scales it, renders as the authored value. The corrected value is written into the node's gate entry as an ordinary style key, so the **Renderer stays pure** (ADR-0002/0006) — it just applies the value the projection computed.

## Why

Geometric counter-scale lives in the transform build (P1) and can't touch non-geometric CSS. `border-radius`/`box-shadow` need a *value*-level correction computed from the same per-frame scale. Doing it in the Renderer would make `project` read element state and do property-specific math (impure, and a grab-bag of special cases); doing it as an independent value spine can't see the projection scale. The projection coordinator already has the node, the per-frame `delta`, and `treeScale` — it is the one place with both the element and the scale, so it owns the correction, and a registry keeps the property-specific knowledge out of the core engine and open to extension.

## Decisions (grilled)

- **Automatic, not opt-in.** Every projecting element with a non-trivial radius/shadow is corrected (Motion parity). The cost is a `getComputedStyle` read in the *already-running* measure read-phase, and a correction is only *written* when the node is actually scaled — so idle and unscaled elements pay nothing.
- **Scale = `delta.scale × treeScale`, per axis.** `sx = delta.x.scale × treeScale.x`, `sy = delta.y.scale × treeScale.y` is the true visual scale on the element. Per-axis offsets/radii correct exactly; scalar components (blur/spread) use the arithmetic mean `(sx+sy)/2` (no exact value exists under non-uniform scale — Motion's pragmatic choice).
- **`getComputedStyle` resolves units, so "full grammar" is px + %.** The browser resolves em/rem/etc. to px in computed style, leaving only px (correct via `/scale`) and `%` (passes through — a percentage stays the same fraction of each scaled dimension, so it is self-correcting). Reading the resolved values gives full-grammar parity for free.
- **Full `border-radius` grammar via the four longhands.** Read `borderTopLeftRadius`…`borderBottomLeftRadius` (each `"H V"` or `"H"`), correct each component (px → `/sx` horizontal, `/sy` vertical; `%` passthrough), reassemble into the elliptical shorthand `TLh TRh BRh BLh / TLv TRv BRv BLv`. Covers 1–4 value forms, elliptical, per-corner, mixed px/%.
- **Full `box-shadow` grammar via a paren-aware parser.** Split on top-level commas (ignoring commas inside `rgb()`/`hsl()`), parse each layer (`inset?`, color verbatim, 1–4 px lengths), correct `offsetX/sx`, `offsetY/sy`, `blur`+`spread`/mean, reassemble + rejoin. Covers multi-layer, inset, missing blur/spread, any color format.
- **Self-contained correctors in a registry (in `@wardic/dom`).** Each entry is `{ key, read(el) → base, correct(base, sx, sy) → string }` — it owns both reading its base (measure phase) and emitting the corrected value (derive phase). Ship `borderRadius` + `boxShadow` built in; a public `addScaleCorrector` API is deferred (the registry makes it a one-liner later).
- **Corrected values flow as ordinary style keys.** The projection writes `{ borderRadius, boxShadow }` into the same gate entry as `@projection`; the Renderer's existing non-transform-key copy applies them verbatim (strings pass through `formatStyleValue` untouched). For a presence-retained leaving Follower they ride the direct Renderer commit alongside `@projection`.

## Considered Options

- **Correct inside the Renderer.** Rejected: makes `project` impure (read element state) and a property-specific special-case pile — violates ADR-0002/0006.
- **Opt-in per element (`correct={false}` default-on, or a prop to enable).** Rejected for v0.1: diverges from Motion's automatic behaviour and surprises users whose radii distort; the cost is bounded (read-phase `getComputedStyle`, write-only-when-scaled). A perf escape hatch can be added if profiling demands it.
- **Documented-limit subset (px-only, single shadow).** Rejected (pre-release, no compatibility cost): `getComputedStyle` normalisation makes full grammar nearly free for `border-radius`, and the `box-shadow` parser is bounded — so ship full parity now.

## Consequences

- `@wardic/dom` gains a `scale-correction` module (the corrector interface + the two built-ins + the registry). The projection coordinator reads each corrector's base at measure (skipping trivial `"0px"`/`"none"`) and writes corrected values in derive when a node is scaled (and the base back at rest). The Renderer is unchanged (stays pure).
- Idle/unscaled elements pay nothing; a scaled element pays one `getComputedStyle` per measure + a string build per corrected key per frame.
- Percentage radii and exotic-but-valid CSS work because the browser's computed-style normalisation feeds the correctors resolved px/%. Animating `border-radius`/`box-shadow` *while* a layout element scales is the one conflict (the corrector and the value spine both write the key — last write wins); a documented v0.1 edge.
- Extending to a new scale-corrected property is adding one registry entry; a public registration API is the natural follow-up.

## Note (#166, 2026-10-14): a handover's blended radius

During a `layoutId` handover the radius corrector writes a blend instead of the node's own base: the twin's radius as drawn, eased into the Lead's own (ADR-0010 *Amendment (#166)*). A Follower is drawn with its Lead's. A blended radius is written at any scale, unit scale included, corrected for the scale like any base. The write after the blend puts the node's own back, as the restore at unit scale does. A node with no radius of its own blends from or to none rounded (`ZERO_RADIUS`). The once-at-first-measure read and its limit are unchanged.
