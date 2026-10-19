# Appear animations: a server-rendered mount animation plays from first paint, and the engine takes it over at mount

#48 gives Wardic an **Appear animation**: an element's mount animation, which the server's markup starts in CSS from first paint, and which the engine takes over at mount, the **Handoff** (CONTEXT.md). Until now, a server-rendered mount animation stood still until hydration.

It lands in three PRs:
1. core's `Machine.startAt`, and dom's `@wardic/dom/Appear`;
2. the Solid spine's mount legs pulled into one builder, with no change in behaviour;
3. the Solid binding's server and client halves.

This amends ADR-0003 and ADR-0021.

## Why

- **A server-rendered mount animation stood still until hydration.**
  - The server renders the **Starting style**, `project(resolveInitial(config))` (ADR-0003), and a hydrating client keeps it until the element mounts (ADR-0021's **Hydration hold**).
  - So `initial={{ opacity: 0 }}` showed nothing from first paint until the JS had loaded and run, and nothing at all with JS off.
- **#48 was filed as a direction, *server-live resume*:** a long-lived engine on a server whose running animations a client hydrates mid-flight. Its "hard parts" named this gap. Grilled, the gap turned out to be the problem: an app's own data already carries server-owned state into `initial` and `animate`.
- **Motion's nearest equivalent is its *optimised appear*,** which in practice only Framer uses (framer-motion 13.4.0, `animation/optimized-appear/`):
  - An inline script starts WAAPI animations on elements marked `data-framer-appear-id`.
  - At mount, `visual-element-target.mjs` asks `window.MotionHandoffAnimation(id, key)` for that animation's start time and starts its own animation from it.
  - Motion cancels the WAAPI animation two frames later (`MotionCancelOptimisedAnimation`).

## Decisions (grilled 2026-10-19, Q1–Q10 all A)

1. **The problem is the gap before hydration, not a server engine (Q1).** Wardic still builds no runtime on a server (ADR-0021, decision 1).
   - Rejected:
     - a long-lived server engine with per-element snapshots: a second Environment, a snapshot format and clock skew, for state the app's data already carries;
     - wall-clock animations alone: one case of decision 2's, an animation that's a pure function of time;
     - parking it.
2. **A CSS `@keyframes` rule sampled from Wardic's own machines (Q2).**
   - The server steps the mount animation through core's machines and the DOM's `project`, and writes it as one `@keyframes` rule. The element's inline style gets `animation: … linear forwards`.
   - What paints before hydration is what Wardic would have painted. The composed `transform` is sampled whole, so `x` on a spring and `opacity` on a tween animate together exactly.
   - With JS off or failed, it plays through and holds its target. No script is needed: the `<style>` falls under the same `style-src` policy the Starting style's inline styles already need.
   - Rejected:
     - WAAPI from an inline script, as Framer does: it needs a `script-src` allowance, and does nothing without JS;
     - native CSS timing per property (`cubic-bezier`, `linear()`): Wardic composes the transform keys into one `transform`, so keys on different transitions can't share it.
3. **One `<style>` in the `<head>` (Q3),** through the binding's head channel: Solid's `useAssets`, which is called after the render and injected before `</head>` (solid-js 1.9.13 `web/dist/server.js:612`, `:654`).
   - An element whose rule doesn't arrive keeps today's behaviour, held at its Starting style. That happens when a render has no `</head>` (unless the app calls `getAssets()`), and for a `Suspense` chunk streamed after the shell, since `renderToStream` injects assets into the shell only (`:366`).
   - The CSS text comes from `@wardic/dom/Appear`, for any binding.
   - Rejected:
     - a `<style>` after the provider's children: a slow parse paints elements before their rule arrives, and the client has to tolerate the extra node;
     - one before each element: an unkeyed node beside each one, which shifts sibling selectors.
4. **An element qualifies whole, when the server knows its whole mount animation (Q4):**
   - **Values:**
     - static or variant-name `initial` and `animate`;
     - every animated key starting from `initial`, since an `animate`-only key starts from the element's computed style, read after mount (ADR-0022);
     - every start and target something `project` writes without the element: no `auto`, no `var()`, no length pair in mixed units.
   - **Any transition:**
     - a finite `repeat` is sampled in full;
     - an infinite one samples one cycle, played with `animation-iteration-count: infinite`.
   - **Not under `AnimatePresence initial={false}`,** which has no mount animation.
   - **Reduced motion (ADR-0029):**
     - the provider's `"never"` and `"always"` are known on the server and pick the rule;
     - `"user"`, the default, adds the reduced rule under `@media (prefers-reduced-motion: reduce)`, so the browser picks as the client would.
   - **An element that fails a rule keeps its Starting style,** and the `wardic.hydration` debug log says why.
   - Rejected: qualifying per key, which puts an element's keys out of step.
5. **Variant orchestration in full, through a custom property (Q5).**
   - The element's inline style names only `animation: var(--wardic-aN)`. The head's `:root` defines it once the render is done, when every element's index, its siblings' total and every settle time are known.
   - This is needed because Solid writes an element's `style` before rendering its children (`ssrElement`, `server.js:509` then `:532`), so a parent's inline style can't know them.
   - Rules are still shared between elements; each element costs one `:root` declaration.
   - An undefined `var()` makes `animation` invalid, so an element whose rule never arrives keeps its Starting style for free.
   - Qualification is whole across the tree: a child whose start depends on a parent that doesn't qualify doesn't either, nor a parent under `when: "afterChildren"` with a child that doesn't.
   - Rejected: only what's known as each element renders (`delayChildren`, stagger from `"first"`).
6. **The Handoff, by elapsed time, in the first commit (Q6).**
   - At mount, the run finds its `wardic-…` animation (`getAnimations()`) and starts its machines that far in, velocity included (`Machine.startAt`).
   - The elapsed time is read at the run's first tick, inside the frame that draws it: `currentTime` there is the CSS's own time for that frame.
   - In the same task, the first commit writes that frame inline and removes the CSS animation (the gate's `beforeFirstCommit`, ADR-0021 decision 6), so no paint falls between. While it ran, the animation's value beat the inline style.
   - A finished animation, `fill: both` holding its end, hands off settled.
   - The rule's name is the hash of the spec: its starting values, targets, transition and reduced motion. A client whose own spec hashes differently logs it in development and continues its own animation at the same elapsed time.
   - Rejected:
     - reading the drawn values back with `getComputedStyle`: a `transform` reads back as a `matrix()`, and velocity is lost;
     - letting the CSS finish on its own, which no gesture or new target could interrupt.
7. **On by default (Q7).**
   - `<WardicProvider appear={false}>` turns it off for an app, and an element's `appear={false}` (on `wardic.*` and `createWard`'s config) turns it off for that one element.
   - Both are read on the server, once.
   - Rejected: opt-in, which leaves the default server-rendered page hiding its content until hydration.
8. **Where the code lives (Q8):**
   - **core:** `Machine.startAt(at)`, which starts a run partway through, stepped in 60 Hz frames (`Machine.CATCH_UP_DT`), as the sampler steps. It has no CSS.
   - **solid:** one pure builder of the mount legs, shared by the spine and the server sampler so they can't drift; the provider's per-render sheet and `useAssets`; the inline `var()`; orchestration resolved at the end of the render; the `appear` props; the Handoff in the spine.
   - **dom:** `@wardic/dom/Appear`, framework-free (ADR-0021's rule for server work, ADR-0041's layout): the sampler, the spec's name, the cache across requests, the CSS text, and the Handoff's reads.
   - Rejected: everything in solid, where each binding would copy the sampler; the sampler in core, which would write CSS (ADR-0036).
9. **Sampled at 60 Hz, then thinned (Q9).**
   - Kept: the stops a straight line can't stand in for, within a tolerance per key below what a screen shows. A bare number is judged by the unit `project` draws it in: 0.1 px, 0.1°, 0.001 of a scale, 0.002 for the rest. A token in a string is judged by its own unit, `px` and `deg` alike; any other by 1/500 of its range, and never finer than the decimals it's written with (a colour channel's whole byte).
   - Measured, `y` 40→0 px and `opacity` 0→1 (`.tmp/48/density.ts`):

     | Mount animation | Every 60 Hz frame | Thinned |
     |---|---|---|
     | spring, default (170/26) | 67 stops, 3,357 B | 21 stops, 1,057 B |
     | spring, bouncy (400/10) | 107 stops, 5,403 B | 44 stops, 2,222 B |
     | tween easeOut 1.2 s | 73 stops, 3,670 B | 16 stops, 806 B |

   - Rejected: every frame, at 3–6 KB per spec; a coarser fixed rate, which cuts a bouncy spring's overshoot peaks.
10. **Delivery (Q10):** this ADR, CONTEXT.md's two terms, and the three PRs above. PR 3 adds frame-traced hydration fixtures, with JS off and reduced motion among them, and a SolidStart `/appear` route with `?hydrate=<ms>` for a phone check.

## Consequences

- **A server render's markup changes:**
  - one `<style>` in the head;
  - an `animation: var(--wardic-aN)` in each qualifying element's inline style.

  Server-rendered entrances move from first paint, and play through with JS off.
- **A server render pays:**
  - 77–122 µs once per distinct spec per process, to sample it (Bun, `.tmp/48/server-cost.ts`);
  - per qualifying element, through the Solid binding: about 8 µs with reduced motion's default `"user"` (two sets of rules), about 6 µs with `"never"`. The rest of a 100-element render costs about 4.6 µs per element (the ssr project in Node, PR 3).
- **The CSS's size:** a rule of 1–2 KB per distinct spec, and one `:root` declaration (about 70 B) per element: 10 KB for 100 elements over three specs, before compression.
- **A client pays at mount:** one `getAnimations()` per qualifying element, and a catch-up of one machine step per 1/60 s elapsed, once per run. Nothing per frame.
- **Not covered:**
  - a key an SVG element draws as an attribute (ADR-0014) can't be animated in CSS, so that element keeps its Starting style (since *Amendment (#245)*, only one with no CSS property: `width`, `height`, `d`);
  - a mount animation longer than 60 s;
  - a streamed `Suspense` chunk.

## Pinned by

- core, `packages/test/test/combinators.test.ts`, "startAt":
  - the first tick at `at()`;
  - the catch-up's steps;
  - the Frame at `k / 60` equalling 0 plus `k` steps of 1/60 s;
  - `at` read once, at the first tick;
  - settling in the catch-up;
  - no clamping at `MAX_DT`.

  Its dual type is in `packages/core/test/machine.test.ts`.
- dom, `packages/dom/test/appear.node.test.ts` (AP1–AP12):
  - the rule's name, length and stops;
  - every sample within tolerance;
  - peaks kept, discrete flips kept, colours by their quantum;
  - stops equal to `startAt`'s Frames;
  - no rule for an SVG attribute, for unsafe text, or past 60 s;
  - the cache, the name's inputs, the `animation` value, the sheet.
- dom, `packages/dom/test/appear.browser.test.ts` (HA1–HA6, Chromium; Firefox by hand):
  - the element plays the machine;
  - `find` and `matches`;
  - a Handoff with no jump, leaving nothing running;
  - a finished animation still filling;
  - an undefined custom property playing nothing;
  - a delay.

## Implementation (PR 3)

- **On a server:**
  - The provider holds a render's Appear state in its existing context: a new provider component would have moved every hydration key (ADR-0021, decision 4).
  - `serverWard` (`wardic.<tag>`, `createWard`) and the component wrap enter each element. A Variant child joins its parent's group through the server's variant context (`appearGroup`), in render order.
  - `useAssets` writes `<style data-wardic-appear>` with `innerHTML`. Solid escapes a text child, which breaks CSS quoting.
  - A user style's own `animation` is known only when `ward()` is called, so it vetoes the entry after the fact. The element keeps its own `animation`, and its slot stays undefined.
- **Timings:**
  - A child under `when: "beforeChildren"` starts at its parent's settle: the machine's own, stepped in 1/60 s as the sampler does (`Keyframes.settled`, past the rule's trimmed end).
  - Summed in 1/60 s steps, a 0.3 s tween lands just past 0.3 at its 18th step and settles there, but a 0.5 s tween lands just short at its 30th step and settles at the 31st. The settle comes from stepping the machine, not from the duration.
  - A forever-repeating tween is sampled as two runs and the `repeatDelay` after them, with no delay before: one CSS cycle, played `infinite`, its own delay in `animation-delay`. Two runs make the cycle exact for every `repeatType`.
- **The Handoff's start:** `elapsed − animation-delay − the rule's own hold + the client's transition delay`.
  - The difference is a `when` wait the client waited itself. Under it, a child can start a frame before the server's timing said; core's `startAt` holds a negative start.
- **The spec's key:**
  - Canonical text: sorted keys, `undefined`s left out, and an easing by `Easing.nameOf` (the Penner set by name; `cubicBezier`, `steps` and `spring` by their call). An app's own easing function has no name, so its element waits for hydration.
  - Written directly, once per element: built with `Match.value` per value and a sorting `JSON.stringify` replacer, the binding added 26 µs per element; profiled down to 8.
- **Found on the way:**
  - #243: a stagger's `from` (`"last"`, `"center"`) sat in the transition a spring decodes `from` from, and every leg failed. Machines now get a transition without its orchestration fields (`motionOf`).
  - In PR 1: a sampled jump holds to halfway between its frames, and `startAt` holds a negative start.
- **The hydration tests read each frame after its callbacks** (a task posted from `requestAnimationFrame`). Read inside the callback, they saw the engine's previous frame: the engine's tick is a later callback.
- **The hand check, `/appear`** in `examples/solid-start-basic`, with `?hydrate=<ms>`. Headless (`.tmp/48/drive-appear.ts`):
  - hydrated at once, at 300 ms, at 1.2 s, and under reduced motion: every element OK (played by CSS or in its delay, no step at the Handoff, the CSS animation gone);
  - with JS off, each ends at its target and holds; `/ssr` 14/14 with `appear={false}`.

### Pinned by (PR 3)

- `packages/solid/test/appear.ssr.test.tsx`, AR1–AR10:
  - the slot and the head's rule;
  - the off switches;
  - each refusal;
  - reduced motion's three settings;
  - stagger by `from` and direction;
  - `when` both ways;
  - an infinite cycle;
  - hydration keys unchanged;
  - no head;
  - a component wrap and a spread.
- `packages/solid/test/appear.hydrate.browser.test.tsx`, AH1–AH8: server render, then hydration, every frame compared with the machine at its time. That covers a spring and a tween handed off mid-flight, a late hydration, JS off, a stagger, `when`, a loop and reduced motion.
- `packages/solid/test/stagger-when.browser.test.tsx` (f), (g): #243.
- `packages/core/test/easing.test.ts`: `Easing.nameOf`.

## Implementation (PR 1)

- **`Machine.startAt(at)`** reads `at` at a run's first tick. It catches up by stepping `0`, then `CATCH_UP_DT` at a time, then the remainder, stopping at a settled Frame. A negative `delay` is a single step, clamped at `MAX_DT`, so it can't stand in.
- **A negative `at()` holds the start for that long.** PR 3's hydration test found the need. A child under `when: "beforeChildren"` can be let go by its client parent a frame before the server's computed wait ends, and clamped to 0 it ran a frame ahead of its CSS.
- **A spec's machine is a thunk,** built only when its rule isn't cached: a server render builds a mount animation's legs once per spec per process, not once per element.
- **The sampler copies each Frame before the next step.** `springValues` rewrites one Frame per run in place, and the first build's first stop read as the settled one.
- **A rule ends where every later Frame is within tolerance of the settled one,** and draws that Frame as the settled one. A 0.5 s tween stepped in 1/60 s settles a frame after it arrives, when the steps' sum crosses its duration; its rule lasts 0.5 s.
- **A jump holds the Frame before it to halfway, then steps.** A loop's seam (352.5° then 0° on the next frame), a `steps()` easing, a snap, a discrete flip: a line between the two stops drew, on a frame between them, a value the engine never draws. PR 3's hydration test caught a loop spinning backwards. `jumpAt` finds them: a change of text, or a move past its tolerance and four times its neighbours'. Halfway, not a hair before the later Frame: display frames land on the 60 Hz stops give or take a vsync's jitter, and a hold ending 0.17 ms before a stop caught them mid-step.
- **The rule fills forwards, not both.** Through a stagger's delay the element shows its inline Starting style. A reduced rule's first stop has its positional keys already snapped, and the client's snap holds them at their start until the delay ends (ADR-0029); filling backwards showed them snapped early, a step at the Handoff on the phone check's drive.
- **Unsafe text is refused:** `<`, `>`, `{`, `}`, `;`, `\` and `/*` in a declaration. A value from an app's config could otherwise end the `<style>` it sits in.
- **`release` only removes the inline `animation`:** that ends the CSS animation at the task's style update, and a `cancel()` as well changed nothing (a surviving mutation).
- **The elapsed-time read sits at the first tick, not at mount,** so its frame is the one the CSS was drawing. Inside a `requestAnimationFrame` callback, an animation's `currentTime` is the frame's.

## Amendment (#245): SVG attributes, layout nodes and streamed chunks

#245 took up what decision 4 and *Consequences* left out: an SVG element's attribute keys, layout nodes, and a `Suspense` chunk streamed after the shell. Grilled 2026-10-19, Q1–Q6, all A. It lands in three PRs, in this order.

1. **All three, in three PRs (Q1):** SVG attributes, then layout nodes, then streamed chunks, the largest, last.
2. **SVG attributes (Q2): the presentation properties always, the geometry behind `@supports`.**
   - An svg-inner element's keys are attributes (ADR-0014), and CSS can't set an attribute. But a stylesheet's or an animation's value of a property beats a presentation attribute, so a keyframe draws the attribute as its property. At the Handoff the engine writes the attribute in the same task that removes the CSS animation, and the attribute takes over value for value.
   - **Always:** `opacity`, `fill`, `stroke`, `stroke-width`, `fill-opacity`, `stroke-opacity`, `stroke-dasharray`, `stroke-dashoffset`, `stop-color`, `stop-opacity`, `flood-color` and `flood-opacity`, unitless as the attribute is. `pathLength`, `pathOffset` and `pathSpacing` are the stroke dash, so a line drawing itself plays; the `pathLength="1"` beside it never changes and is left to the Starting style.
   - **Behind `@supports`:** SVG 2's geometry, `cx`, `cy`, `r`, `rx`, `ry`, `x` and `y`, in px. Chrome and Firefox draw them from CSS; Safari only in part. A rule lists the ones it writes (`Keyframes.supports`). The binding defines its whole orchestrated group under one `@supports` for every one its members write, so a browser without them keeps the group at its Starting style rather than half of it (decision 4's "whole across the tree", per browser). The reduced block too.
   - **Still waiting for hydration:** `width` and `height`, since `@supports (width: 0px)` holds for HTML in every browser and can't tell whether one draws a `<rect>`'s from CSS (the grilled list had them; found while building); `d`, which Safari has no property for; and `points` and filter primitives' attributes, which have none anywhere.
   - **Thinned by what they mean:** a bare number on an svg-inner element was judged as "the rest", at 0.002, so `cx` from 0 to 100 would have kept nearly every frame. Now a user unit is a CSS px, 0.1; an opacity 0.002; a normalised dash 0.001 of the path.
   - Rejected: the presentation properties alone (a circle growing waits for hydration everywhere); the geometry without a guard (a browser that ignores `cx` in a keyframe holds it still, then jumps at the Handoff).
3. **Layout nodes (Q3): measured past the running animation.** The mount's Measure pass runs at the end of the hydration task, a frame before the Handoff, and clears each node's inline `transform` while it reads; a CSS animation's `transform` beats an inline style, so the box would include wherever the CSS had got. A node registered with an Appear animation is flagged until its Handoff, and while the pass reads boxes it gets an inline `transform: none !important`, which beats an animation in the cascade, then its old value back. The CSS animation's timeline isn't touched: Motion's `MotionCancelOptimisedAnimation` around its measure, without the cancel and replay. Rejected: handing off before the measure (a second Handoff path reading its time away from the frame it draws, which decision 6 chose against); allowing every key but `transform`; refusing them still.
4. **Streamed chunks (Q4): one lazy `<style>` per chunk, moved into the head by the client.**
   - Solid's `$df` inserts a late chunk's server HTML until the page's first delegated event (`_$HY.done`), so a chunk is always inserted, and hydrated at once if the JS is already running. An element in it is at its Starting style only until the JS runs: the gap decision 3 left.
   - **On the server:** once the provider's `useAssets` callback has run (the shell is flushed), every element entering is late. A late element with no late Wardic ancestor renders a server-only thunk after itself, which resolves once its siblings have rendered; the first to resolve writes a `<style data-wardic-appear>` with every entry since the last write, the `@keyframes` this response hasn't sent and their `:root` declarations, and any later one writes nothing. The node is server text with no hydration key: a node that took keys moved the client's and lost list items on the next update (probed).
   - **On the client:** the provider copies those rules into its head sheet and removes the nodes, at setup for chunks that landed before the JS, and through a `MutationObserver` until `DOMContentLoaded` (the stream's end) for later ones, which runs before Solid hydrates the chunk. Copying first keeps a running animation's rule in place through every style update.
   - Rejected: leaving the nodes (a hydrated list keeps a `<style>` between its items, shifting `:nth-child`, until it next updates); a node per element as it renders (orchestration only from what's known then).
5. **A late Variant child of a group led earlier (Q5): a fresh mount from when its chunk lands.** Its CSS starts when `$df` inserts it, so its delay is `delayChildren` and its stagger among that group's late children in the chunk, with no wait on the leader's `beforeChildren`: the leader started at first paint, and CSS can't wait on another element's animation. The client's own timing differs (a chunk that landed before the JS hydrates in one pass with the shell, its items continuing the group's stagger; probed), but the Handoff carries each element on from where its CSS drew, whatever delay the client gives it. A group led inside the chunk plays as in the shell. Rejected: continuing the group's indices (a first late item waiting a stagger step per shell child, long after they finished); holding a late child of an earlier group until hydration.
6. **Delivery (Q6):** an Amendment section per PR's part, here; the README's Appear section; **Late chunk** in CONTEXT.md with PR 3; tests and mutations per PR; `bench:solid` for PRs 2 and 3, which touch client paths; and the SolidStart `/appear` route growing with each, checked on a phone.

### Pinned by (PR 1, SVG attributes)

- `packages/dom/test/appear.node.test.ts`:
  - **AP14:** presentation attributes unitless; a line's stroke dash, its `pathLength` left out and judged at 0.001; `cx` and `r` in px, judged as an HTML `x` is, and listed in `supports`; an opacity attribute at 0.002; `width` and `d` refused.
  - **AP15:** a sheet defines a slot under `@supports` for its rules' geometry and the group's the binding passes, the reduced block too, one condition with its properties in order.
  - **AP8** and **AP12** refuse `stdDeviation` now that `cx` plays.
- `packages/dom/test/appear.browser.test.ts`, **HA7** (Chromium and Firefox): a circle's `cx`, `r`, `stroke-width` and `opacity` and a path's dash play the machine from CSS, and the Handoff to attributes draws where the CSS was.
- `packages/solid/test/appear.ssr.test.tsx`, **AR12:** a `<g>` leading a circle and a path, all three under the circle's condition, in both blocks; a rect writing no geometry outside it; a `width` animation held.
- `packages/solid/test/appear.hydrate.browser.test.tsx`, **AH10:** a circle and a line, server-rendered and hydrated mid-flight, every frame the machine.

### Implementation (PR 1, SVG attributes)

- **dom:** `declarationsOf` draws an svg-inner element's routed attributes as declarations: the presentation set unitless, the geometry set with `px` on a bare number, `pathLength="1"` left out, anything else refused with its names. `Keyframes.supports` lists the geometry a rule writes, in order; `Slot.define(play, reduced?, supports?)` files the slot's declarations under `@supports (p:0px) and …` for its rules' and the binding's, the reduced block's under the same condition inside the media query. `thin` takes the tag, and a bare number on an svg-inner element is judged by `svgTolerance`.
- **solid:** `timings` carries each play's `supports` from the rule it already looked up, and notes whether any rule writes geometry. Only then does `groupSupports` walk each entry to the top of its orchestration and gather the group's.
- **Server cost,** a 100-element render (a staggered list of 50 and 50 cards) in the ssr project, five rounds interleaved with main: Appear's share went from about +8.2 to +8.7 µs per element. The first build looked each element's rule up again and sorted an empty condition every `define`, +1.5 µs; skipping the group pass when no rule writes geometry, and the empty condition at once, took it to the half microsecond left, the sheet's per-`define` bookkeeping.
- **Chromium takes a unitless `cx` in a keyframe:** the `px` is pinned by the node and ssr tests (a mutation dropping it passed the browser ones). And `Easing.easeOut` doesn't exist: a first AP14 tween given it ran linear.
- **The hand check:** `/appear` gained a circle growing across and a line drawing itself. Headless (`.tmp/245/drive-appear.ts`), 12/12 OK hydrated at once, at 300 ms, at 1.2 s and under reduced motion; with JS off the circle ends at `cx` 120 and the line drawn.
