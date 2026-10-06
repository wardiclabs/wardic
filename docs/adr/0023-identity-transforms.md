# Identity transforms: `project` leaves out a transform at its identity, and writes `none` when nothing is left

`project` writes no function for a transform key at its **Identity** (1 for `scale`, `scaleX` and `scaleY`, 0 for the rest), and writes `transform: none` when every transform key it's given is at its identity, as Motion does (#57). Before, it wrote a function for every key, so an element at rest at `scale: 1` or `x: 0` kept `transform: scale(1)` or `translateX(0px)` inline, which makes it a stacking context and the containing block of its `position: fixed` and `absolute` descendants.

This amends ADR-0009 (the projection transform's woven terms), ADR-0014 (an svg-inner element's `none`), ADR-0021 (the Starting style of an identity `initial`) and ADR-0022 (which left #57 open).

## Why

- **An identity transform isn't `none` to CSS.** CSS Transforms 1, §3 (W3C Candidate Recommendation, 14 February 2019): "Any value other than none for the transform property results in the creation of a stacking context … also causes the element to establish a containing block for all descendants." So `scale(1)` paints the element as `none` does, but not its descendants: a `position: fixed` child is placed against the element instead of the viewport, and a child's `z-index` stacks inside it.
- **Since #47 it reached most animated elements** (at `3f6ea26`, [identity-transform.md](../research/identity-transform.md)):
  - every transform key a gesture sets returns to its identity and rests there (ADR-0022), so any element ever hovered, pressed or dragged on a transform key rested as a stacking context;
  - the house entrance, `initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}`, settles at `translateX(0px)`;
  - an identity `initial` server-rendered `transform: scale(1)`;
  - on the projection path, a returned `rotate` or `skew` rested at `rotate(0deg)`.
- **Motion writes `none`** (read at `16c6122`, run on `motion` 13.5.0):
  - its transform builder leaves out each value at its identity and returns `"none"` when nothing is left (`build-transform.ts:36-57`, `:86-87`), and its projection transform leaves out an identity rotate or skew (`projection/styles/transform.ts:44-50`);
  - after `whileHover`, `whileTap` and a `Reorder.Item`'s `whileDrag` return, `transform: none` is inline (C1, C2, C10 in [base-values.md](../research/base-values.md));
  - an identity `initial` server-renders `transform:none` (S1–S3);
  - a class's `transform: scale(0.5)` stays overridden at rest (C5).

## Decisions (grilled 2026-10-06 against Motion @ `16c6122` and `motion` 13.5.0)

- **Every frame, in `project` (decision 1).**
  - The rule is part of the pure `project` (ADR-0002), on every frame, the client's and the server's alike. A frame whose transform keys are all at their identity writes `none`; one with no transform key writes no `transform`.
  - Not only at rest: `project` gets a value-map, not a rest state, and the gate projects merged maps with no settle flag. Rest-only would take a new rest signal from the spine through the gate into `project`, and the Starting style, a rest state too, would need it as well.
  - Mid-flight, a transform reaches its identity exactly only at an endpoint (a tween leaving 0, a keyframe at 1), where the element was or will be at rest anyway.
- **`none`, written, not left out (decision 2).**
  - So a class's transform stays overridden once a gesture returns, as in Motion (C5) and as ADR-0022's decision 5 assumes.
  - Leaving `transform` out would split the sinks: the signal sink would drop it (the class's transform shows again), and the commit sink, which writes only the keys a patch has, would keep the last frame's transform inline.
  - With no transform key at all, `project` still writes no `transform`, so an element that never animates one keeps its class's.
- **Motion's identity test (decision 3).**
  - A number is at its identity when it equals it; a string when `parseFloat` gives it (`build-transform.ts:42-48`). So `"0px"`, `"0%"`, `"0deg"`, `"-0px"` and `"1"` are identities, and `"calc(0px)"`, `"var(--x)"` (`NaN`) and `scale: "100%"` (100) are written.
  - Exact, with no tolerance: a spring that Settles sets its value to its target (`stepper.ts:99-103`) and a tween ends at its interpolator's value at 1, so a returned key rests exactly at its identity, and a value near it mid-flight is still written.
  - Strings come to rest at identity too: a returned `whileHover={{ x: "10%" }}` rests at `x: "0"`, its identity as `valueLike` coerces it to a string target (ADR-0022), which wrote `translateX(0)`.
  - A stricter parse (core's unit grammar) would only differ on invalid CSS such as `"0abc"`.
- **The projection path takes the same test (decision 4, amends ADR-0009).**
  - Its translation, tree scale and element scale already left out their identities, and `none` was its result with nothing left. Its woven `rotate` / `rotateX` / `rotateY` / `rotateZ` / `skewX` / `skewY` were written whenever present, and `z` was left out only as the number 0, so a `layout` element whose `whileHover` rotate returned rested at `rotate(0deg)`.
  - Now each is left out at its identity by the test above. Motion's projection transform leaves them out by truthiness (`projection/styles/transform.ts:44-50`), the same for a number.
- **The Starting style follows (decision 5, amends ADR-0021).**
  - The Starting style stays `project(resolveInitial(config))` (ADR-0003), so an `initial` whose transform keys are all at identity server-renders `transform: none`, and the hydrating client holds it (the Hydration hold). It's Motion's server markup (S1–S3, S6, S7, S11, S12).
  - A custom Renderer's hydration seed is the DOM's `project` (ADR-0021, decision 2), so it follows too.
- **SVG routing is unchanged (decision 6, amends ADR-0014).**
  - `none` is a `transform` like any other: an svg-inner element that receives it still gets `transform-box: fill-box` and `transform-origin: 50% 50%` unless set, as in Motion (`build-attrs.ts:59-71`; S10). Neither does anything without a transform, and they stay put while the transform switches between `none` and a function.
- **The per-frame cost, as measured (decision 7).**
  - `project` before and after, minified production bundles, 21 reps alternating, medians ([identity-transform.md](../research/identity-transform.md)):
    - mid-animation, numeric values: +4–12 ns per call in Chromium 147 (inside the reps' spread), +20–49 ns in Bun 1.3.14 (JavaScriptCore);
    - string values: +55–78 ns per call, one `parseFloat` per transform key;
    - at rest: 28–72 ns per call cheaper, since `none` is cheaper to build than a function string.
  - At 1000 elements animating a numeric transform, about +4–50 µs per frame against a 16.7 ms frame.

## Considered Options

- **Only at rest** (decision 1). Rejected: a rest signal into the pure `project`, or a post-process of its patch in the gate, for a difference that shows only at a transform's endpoints; and Motion applies the rule every frame.
- **Leaving `transform` out** (decision 2). Rejected: a class's transform would show again (C5, as ADR-0022 rejected for releasing every key), and the commit sink would keep a stale transform.
- **Numbers only** (decision 3). Rejected: a key returned in a unit would still rest as a stacking context, and the server markup would differ from Motion's for a string `initial` (S6, S7, S12).
- **The normal path only** (decision 4). Rejected: a `layout` element or a `Reorder.Item` whose rotate returned would still rest as a stacking context.
- **Keeping the server's identity markup** (decision 5), by opting `startingStyle` out. Rejected: the Starting style would no longer be `project(resolveInitial(config))`, and the first frame after mount would switch `scale(1)` to `none`.
- **No `transform-box` / `transform-origin` with `none`** (decision 6). Rejected: Motion adds them (S10), and the signal sink would remove and add both each time a gesture starts and returns.
- **A guard before the string path's `parseFloat`** (decision 7). Rejected: it saves only on string transforms, at the risk of drifting from Motion's test.
- **Always writing a present `z`** (or `translateZ`), to keep `translateZ(0px)` as a compositing-layer hint. Rejected: `z: 0` would stay a stacking context, the bug itself, and Motion renders `none` (S11).

## Consequences

- **No new surface.** `Patch`, the `Renderer` contract, the routing and the gate are unchanged; only `project`'s output for identity transforms changes.
- **Breaking:**
  - An element whose transform keys are all at their identity has `transform: none`, at rest after a gesture or an `animate` that settles at identity, and in the server markup of an identity `initial`. It's no longer a stacking context or the containing block of its `fixed` and `absolute` descendants there.
  - `z: 0` (or `translateZ: 0`) no longer writes `translateZ(0px)`. An element that relied on it for its own compositing layer needs `will-change: transform` in its style.
  - A server-markup snapshot of an identity `initial` changes from `transform: scale(1)` (or `translateX(0px)`, …) to `transform: none`.
- **Unchanged readers of the inline transform:** the Measure pass saves and restores it as a string (`projection.ts:1188-1239`, `measure.ts:44-49`); the scale correctors treat `none` as no transform (`scale-correction.ts:188`).
- **Where Wardic still differs from Motion:** with no transform key left, Motion writes `none` if it wrote a transform before (`build-styles.ts:59-65`). `project` is stateless, so it writes nothing then. A transform key the gate has written stays in its value-map (ADR-0022: a transform key has no `style` link to be handed back to), so its identity's `none` is what rests.
- **Costs:** decision 7.
- **Pinned by** (written red, before the fix):
  - `@wardic/dom`, node tier: `identity-transform.node.test.ts` (IT1–: the normal path's identities, mixed keys, no transform key, decision 3's strings, all fifteen keys; the projection path's woven terms and `z`; an svg-inner element split by tag) and `starting-style.node.test.ts` (ST15–ST16: an identity `initial`'s Starting style, HTML and svg-inner);
  - `renderer.browser.test.ts`: `{ x: 10, y: 0 }` now projects `translateX(10px)`, and a commit back to identity writes `none` over the transform before it;
  - `@wardic/solid`, in Chromium:
    - `base-values.browser.test.tsx` (M27–: `none` inline once C1, C2 and C10 return; C5's class transform still overridden; the house entrance settles to `none`; a `position: fixed` child placed against the viewport once a hover returns);
    - `base-values-sinks.browser.test.tsx` (K7–: the commit sinks, `wardic.create(Component)` and `use:ward`);
    - `projection-transform.browser.test.ts` (PT5: a `layout` element's returned rotate);
  - the server tier: `server.ssr.test.tsx` (SV20: an identity `initial` renders `transform: none`, and with a non-identity key only that key's function);
  - the hydrate project: F15 (an identity `initial` holds `none` through hydration, then animates from it).
