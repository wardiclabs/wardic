# @wardic/foldkit (#561): the frame-order probes, P1–P10, P13, P14, P17 and P19–P22

> **Read at:** 2026-11-08 (UTC) · **Sources:**
> - **Foldkit:** `foldkit@0.170.0` from npm, installed with `--ignore-scripts --legacy-peer-deps` into `probes:node_modules/`. Its `dist/runtime/renderer.js` is byte-identical to the note's tarball (`shasum` `cb22adee…`). Source citations are to the note's clone (`fk:`, `fkweb:`).
> - **Effect:** `effect@4.1.1`, one copy, the repo's `node_modules/.bun/effect@4.1.1/node_modules/effect`.
>   - Foldkit's and `@effect/platform-browser@4.1.1`'s `effect` resolve there (their peers weren't installed).
>   - The probe server pre-bundles nothing, so every module is served from that one root. P0's resource list shows one `effect` root: 210 files in Chromium, 192 in Firefox, and 0 pre-bundled deps.
> - **Wardic** at `15f723d11fb1679c8eebe788ffbde74371b3ad94` (branch `test/pe3-resize-event`), from source:
>   - `@wardic/core` and `@wardic/dom` through their `@wardic/source` condition, resolved as if imported from `packages/solid`. The repo root links no `@wardic/*`.
>   - By relative path: `packages/solid/src/imperative.ts` (its `scopedAnimate`) and `packages/dom/src/internal/runner.ts` (its `makeRunner`).
>   - An esbuild bundle of `imperative.ts`, `spine.ts` and `presence-controller.ts`, with only `effect` and `culori` external, has no `solid-js` input (`probes:check/closure.mjs`).
> - **Browsers:** headless, 800×600 at DPR 1, from the devshell's `PLAYWRIGHT_BROWSERS_PATH`, driven by Playwright 1.59.1:
>   - Chromium 147.0.7727.15 (Playwright's headless shell, revision 1217);
>   - Firefox 148.0.2 (Playwright's build 1511).
> - **Tooling:** Node 22.22.3; Vite 6.4.2's dev server (P14 and P13 also as production builds served by `vite preview`); TypeScript 7.0.2 (the probes typecheck clean). P20 d's Solid page: `solid-js@1.9.18` (packages/solid's copy) and `vite-plugin-solid@2.11.15`, `@wardic/solid` from source.
> - **P21's Foldkit** is the Blocks and Layers preview's canary, `foldkit@0.170.0-canary.54f8bcd443b4` (snapshot `54f8bcd`), in `probes-preview:` (= `.tmp/561-foldkit/probes-preview/`) with the same one `effect`. Source citations to it are `fkp:` (the preview worktree, as [`foldkit-blocks-preview.md`](foldkit-blocks-preview.md)'s).
> - **P17 ran in Bun 1.3.13** (`--conditions=@wardic/source --conditions=browser`, so `solid-js` is its client build), with no browser.
> - **P13–P22 were run 2026-11-09 (UTC)** on `wardic-bench` (16 cores, `performance` governor), with the same browsers. P13's timing ran alone on the box, after `wardic-quiet` passed.
> - **Method:**
>   - **Instrumentation.** `probes:src/instrument.ts` runs first on every page (the first module script, with no imports). It wraps `requestAnimationFrame`, `queueMicrotask`, `setTimeout`, `MutationObserver` and `ResizeObserver`.
>     - Each callback is logged with the frame it ran in (frames are counted by distinct rAF timestamps), the callback it ran inside, and who queued it.
>     - "Who queued it" is the queuing call's first stack line: `fk-render` is Foldkit's renderer (`renderFramePlain`), `fk-sched` its microtask scheduler, `w-clock` Wardic's Clock tick, `w-gate` the gate's own frame, `w-microtask` core's `Microtask.next` (the Measure pass's end-of-task microtask).
>     - The pass itself is logged by the nodes' `onBeforeMeasure` / `onMeasure`.
>   - **Paint markers.** A frame's first rAF callback posts a `MessageChannel` message, and its handler reads the probe's watchers: what the frame painted, unless another task ran between.
>   - **Drawn frames (Chromium only).** A trace (`devtools.timeline`, `…timeline.frame`, `blink.user_timing`, `disabled-by-default-devtools.screenshot`) gives each drawn frame's screenshot (a 498×374 JPEG).
>     - The screenshots are decoded in a page canvas, as region mean colours or row scans.
>     - They're lined up with the log by `performance.mark`s on the same trace clock. A screenshot shows the last committed frame.
>   - **Clicks** are `element.click()` in a timer task: synthetic, not input events. P20 c's pointer moves are real input (CDP `Input.dispatchMouseEvent` in Chromium).
  - **P13 times with no stack captures:** `probes:src/lite.ts` wraps only `requestAnimationFrame` (start, end, callback name) and `ResizeObserver`, keeps a heartbeat rAF loop, and marks Foldkit's frames for the trace. The page reads its own clock, cross-origin isolated.
> - **A Firefox caveat.** After an idle spell, Firefox's refresh driver sometimes ran frame N+1 0.1–3 ms after frame N, before the marker's task, so that marker reads N+1's state. The analyzers flag these (`paintNLate`). Every Firefox mismatch below is one, and the rAF order is unaffected. Firefox has no drawn-frame evidence here.
> - **Each probe's files:**
>   - in `probes:` (= `.tmp/561-foldkit/probes/`, gitignored): `<probe>.html`, `src/<probe>.ts`, the analyzer `analyze-<probe>.mjs` or `check-<probe>-shots.mjs`, and raw logs in `results/`;
>   - the driver is `run.mjs` (`node run.mjs p1 --runs 10 --query mode=cold --tag cold [--trace]`, with the dev server `vite --config vite.config.ts` on 127.0.0.1:5199); P13's is `run-p13.mjs`, P20's `run-p20.mjs` (`--input`, `--port`); `run-p13-all.sh`, `run-p19-all.sh` and `run-p20-all.sh` run each set.
> - **Prefixes:** as [`foldkit-binding.md`](foldkit-binding.md)'s (`fk:`, `fkweb:`, `fx:`, `wardic:`), plus `probes:`. "Note B.1" is a section of that note.

Companion to [`foldkit-binding.md`](foldkit-binding.md): it runs the note's B.4 probes P1–P10, a new P14 for hydration, and, for round 6 of the grill, P13 (R5 Q19's trigger cost), P19 (R5 Q17's leaver order) and P20 (R5 Q20's held frame); then P17 (R6 Q23's `Reactivity` port), P21 (the Blocks and Layers preview on its canary) and P22 (Solid 1's presence under a reorder). P11 and P12 didn't run.

## Summary

1. **The frame order is as the note read it** (P1, P3; 40 runs plus 6 traced).
   - **The order.** The click's `update` runs on the click's stack. Its Command starts in that task's microtask and sees the pre-patch DOM. In frame N:
     - (warm only) Wardic's tick;
     - then Foldkit's rAF callback: the patch, then the drain, then `afterCommit`'s waiters, all inside that callback;
     - then the Measure pass, in the microtask after it;
     - then the paint.
   - **One held frame.** The patch frame paints the origin projection, and the first step is N+1, cold and warm alike. In Chromium's drawn frames the box leaves its old place from the next frame on, never jumps and never leaves a gap.
2. **Registration inside the patch works** (P2), the provider-after-children case included.
   - Children's Mounts start first. The provider builds Wardic's Layer synchronously in its `insert` hook, and `Deferred.doneUnsafe` resumes each child inline, before the provider's own next line.
   - Every registration and first `animate` call lands inside Foldkit's rAF callback, and the pass runs before the paint. No drawn frame shows an element without its Starting style or its siblings' projection.
3. **A trap: an `OnMount` a later render adds to a kept DOM node never runs** (P2 c, 6/6).
   - The case: an unkeyed `div` at the same place as the one before. snabbdom keeps the node, and `OnMount` binds only to `insert`.
   - Its children sit at their Starting style (`opacity: 0`) for good: invisible.
4. **A sync release sees the element connected, at its box, inside `destroy`** (P4, 20/20).
   - An `Effect.yieldNow` or an `Effect.sleep(0)` release resumes on Foldkit's microtask scheduler after the removal, still before that frame's paint.
   - A 5 ms sleep resumes after the paint.
5. **A Declared layout change needs the Command route** (P5, 60 runs).
   - **The Command** (`animateLayout(constVoid)`, then `afterCommit`, then `notify()`) animates every item from its pre-patch box, even when the retained boxes are stale.
   - **No trigger:** the items jump.
   - **The per-render accessor's `notify()`** animates from the retained boxes: right when they're fresh, drawn 40 px off after a change no trigger saw.
6. **`h.Prop` isn't public.** In 0.170.0 `Prop` is exported only from Foldkit's internal `html/index.js`. The public way to make one is a `CustomElement.define` spec's property factory, and it works on a built-in `div` (P6).
   - **What holds** (P6, 12/12):
     - one setter call per fresh value, in document order, a parent's before its children's;
     - none for the same reference;
     - none when the view drops an object-valued Prop (`resetProperty` resets primitives only);
     - a DevTools replay writes the historical value synchronously inside `jumpTo`, and `resume` writes the live one back at the next frame.
7. **A Message offered from inside Wardic's tick** runs `update` in the Foldkit-scheduler microtask right after the tick, in the same frame; its patch lands in N+1 (P7, 12/12).
8. **Presence by re-insert from a `MutationObserver` works**, and so does an injected snabbdom `remove` hook, with identical DOM results (P8, 30 runs plus 9 traced).
   - The leaver is drawn in every frame of its exit, and a later insert lands right.
   - **But a keyed reorder moves the known nodes around it:** after a reverse it sits first (`b,d,c,x,a`), no longer beside its old neighbour.
9. **Foldkit's scheduler reaches Wardic's forks from both a Mount and `resources`** (P9, 10/10).
   - A runner fork that yields resumes on a Foldkit-scheduler microtask.
   - C2's MemoMap inferences hold: a Mount that `Effect.provide`s Wardic's Layer builds a new one each time; a Command's `Effect.provide` reuses the one in `resources`.
10. **`viewTransition` and Wardic layout compound, as the note inferred** (P10, 20 runs; 2 browsers for the order, Chromium for the pixels).
    - **The capture.** The patch, a `layoutId` handover and Wardic's pass all run in the transition's update callback, so the browser captures the new state with the origin projection drawn: old == new for every group.
    - **With `viewTransitionName`s,** each drawn position interpolates from the origin toward the element Wardic is moving: drawn x is 50 when the DOM's is 120.
    - **Without them,** the root crossfade shows a static ghost at the origin over the live motion.
11. **Hydration keeps the server's inline style and makes no DOM change** (P14, 39 runs).
    - **When the Mount runs:**
      - in production, synchronously inside `Runtime.hydrate()`, 30–49 ms after first contentful paint;
      - under Vite's dev server, about 500 ms later: Foldkit waits that long for its own Vite plugin's model-preservation reply.
    - **No flicker.** The server HTML paints first with the card invisible. From the first frame after hydration the card only fades in, at 6% opacity in the first frame, and nothing paints it at its final state early.
    - **No rewrite.** A later re-render writes nothing over Wardic's values.
12. **The only `<head>` channel is the server entry's `renderDocument(…, { head })`.** It's trusted HTML per render call, and the view runs synchronously inside `renderToString`, so a binding can collect Appear CSS there.
    - The view's `Document` has no head field.
    - A view's `h.style([], [css])` serializes as raw text in the body, and hydration keeps it.
13. **A Measure pass every render costs the whole tree's reads, even when nothing moved** (P13; production build, 9,600 timed renders, both browsers).
    - **A pass that finds nothing** still resets every node's transform, reads every box and restores the transforms: N reads and 2N style writes. At N = 1,000 that's 3.4–3.9 ms in Chromium and 6.5–8.0 ms in Firefox, the same from the patch as from a plain task. At N = 50, 0.4–0.5 and 0.8–1.0 ms.
    - **A `MutationObserver` on the provider** (trigger 3), for kind b (one text changes) at N = 1,000: Wardic's JS is 3.79 / 4.02 ms (median / p95) in Chromium with an `attributeFilter`, 3.98 / 4.32 when the callback ignores `style`. That's under ADR-0027's 4 ms at the median, just over at p95. Firefox: 6.66 / 7.36 and 7.25 / 7.82, over.
    - **The observer itself is cheap** (≤ 0.12 ms a frame). `attributeFilter` is the better guard: ignoring `style` in the callback still makes a record for each of the pass's own 2N writes, and a delivery on every animation frame.
    - **No render frame went long** (none of 9,600 by the page's heartbeat). A 1,000-item reorder with its pass is near Chromium's budget: 16.4–16.9 ms busy, at most 19.3 ms a frame.
14. **Re-placing leavers by `orderOf` after each patch works, and never fights Foldkit's next patch,** once two things change in the plan (P19; 11 scenarios, a 750-step fuzz, both browsers, drawn frames).
    - **What holds:**
      - Foldkit's known nodes always end in the Model's order, and its moves are the same with leavers present or not;
      - every leaver is drawn at its `orderOf` place in every frame of its exit;
      - the observer makes exactly one delivery per patch;
      - nothing threw.
    - **Every leaver must be re-placed, not just this change's,** and not by `backPlaceOf`'s nearest neighbour: that missed 8 of 667 fuzz deliveries, and placing in the order's order against the element before missed none.
    - **The controller needs keys on the DOM,** and a take-over for a key that re-enters while its leaver exits: Foldkit makes a fresh element for it.
    - **Side finding:** `orderOf` follows Motion 14.9's arithmetic, not quite its own comment's rule (20 of 667).
15. **Every update-driven start holds one frame; Solid's same click holds none** (P20; 130 runs).
    - **The cases:** a Retarget through the props channel (from rest, or of a running leg, x or opacity), a layout move, and a Reorder-style swap from a real `pointermove`. Each paints its origin in the patch's frame N and moves at N+1, cold and warm, in both browsers.
    - **An interruption** shows the old motion advanced by frame N's tick (no stall), and the new one starts there at N+1 (no jump).
    - **Chromium dispatches the CDP pointer move before that frame's rAF callbacks,** so the swap's patch runs in the event's own frame: one held frame, not two.
    - **In ms,** warm, the held frame is a whole frame: 24.2 ms from click to first moved paint, against Solid's 10.0, in Chromium; 32 against 11 in Firefox.
16. **The preview's Mount rules hold as run on its canary** (P21; `0.170.0-canary.54f8bcd443b4`, 15 runs, Chromium).
    - **A raw `{ name, f }` Mount runs in a child Block** with no registration and no check firing, and `Effect.serviceOption` finds a service from `program.provide(layer)`. The Layer is built about 7 ms before the first Mount, so that Mount already sees it.
    - **A fused `OnMount` passes every check** when it spreads the user's Layer-backed action (`{ ...user(), f }`): the checks read the user's own symbol keys. Without them it passes too, as a raw Mount, but loses the user Mount's identity (*inferred*).
    - **New for the binding: a kept element's Mount restarts inside the patch.** When the acquiring Block occurrence retires, the release and the next acquire run in Foldkit's rAF callback, on the same connected element. So Wardic's register has to tell a restart from a mount, or it replays `initial`.
    - `Stream.merge` in a fused `f` starts both parts a scheduler microtask after the render callback, so Wardic's part should start before the fork. Hydration wasn't run.
17. **The `Reactivity` port works if `watch` re-reads once per patch, not after each delivery** (P17; Bun, the real `live-style.ts`, `followTemplate` and `variant-tree.ts`, against Solid 1's port).
    - **With one global re-read per patch,** every real change matches Solid's values and stagger slots. It fires a subset of Solid's: never for an equal value or an equal rebuilt array, but always for a fresh function, by reference.
    - **Re-reading after each delivery** fires an intermediate value: a child sees its parent's new name with its own old config, then its own. It also costs watches × deliveries per patch: 1,206 against 354 `Equal.equals` here.
    - **Re-reading an element's own watches** misses every change for a child whose config is the same reference (no delivery, P6).
    - **The cost:** one `Equal.equals` per watch per patch; 1,000 elements × 3 watches re-read in 0.48–0.60 ms (Bun). Through the port itself, an element has one watch per accessor-valued style key, plus one for a `transformTemplate`.
18. **Solid 1's presence drifts from Motion's order when the list reorders during an exit** (P22; 6 runs, Chromium). It's a real bug, and it needs only one leaver.
    - `[a, b, c]` to `[a, c]`, then `[c, a]` while b exits, draws `c b a` until the exit ends. Motion draws `c a b`.
    - Solid's `reconcileArrays` moves its nodes around the leaver, and the controller re-places only the change's own leavers. P19's fix (re-place every leaver after every change) would apply (*inferred*).

## P1, the frame order (with P3)

**Setup** (`probes:src/p1.ts`, `analyze-p1.mjs`, `check-p1-shots.mjs`). The pieces:
- A Foldkit element whose root Mount builds Wardic's Layer (`probes:src/wardic.ts`: `DomProjectionSystem.layer` over `FlushGate.layer` over `DomLive`, as dom's `services.browser.test.ts` builds it) and registers `.mover` with the gate and the engine.
- An own accessor on the mover for a `wardicDep` Prop, whose setter calls the node's `notify()`.
- A click toggles the mover's `left` (20 ↔ 320 px) and `wardicDep` together.
- **Warm:** a repeating Wardic animation keeps the Clock ticking. **Cold:** nothing runs.
- 10 runs per mode and browser, plus 3 + 3 traced in Chromium.

| Step (frame N = the patch's) | Chromium cold | Chromium warm | Firefox cold | Firefox warm |
|---|---|---|---|---|
| rAF callbacks in frame N | Foldkit's | Clock's, then Foldkit's | Foldkit's | Clock's, then Foldkit's |
| The click's Command starts | Foldkit-scheduler microtask after the click task, box at x = 20 (pre-patch): 10/10 | 10/10 | 10/10 | 10/10 |
| Accessor's `notify()` | inside Foldkit's callback, during the patch: 10/10 | 10/10 | 10/10 | 10/10 |
| Measure pass | `Microtask.next` after Foldkit's callback, frame N, before the marker: 10/10 | 10/10 | 10/10 | 10/10 |
| Frame N's marker | origin projection (`translate3d(-300px…)`, drawn at x = 20): 10/10 | 10/10 | 7/10; 3 late reads (first step) | 10/10 |
| First step (`onLayoutAnimationStart`) | N+1: 10/10 | 10/10 | 10/10 | 10/10 |
| The Clock's first request | from the pass's microtask | already ticking | from the pass's microtask | already ticking |

**Drawn frames** (Chromium, 3 cold + 3 warm):
- the first drawn frame after the click shows the box whole at its old place;
- from the next it leaves by about 10 px a frame;
- its new place stays empty until it arrives (24 frames on);
- no jump, no gap.

**Verdict: confirmed, cold and warm** (high confidence: 40 runs, plus drawn frames in Chromium).
- **Warm:** tick, patch, pass, paint.
- **Cold:** patch, pass, paint.
- **Both:** first step at N+1, so one frame held after Foldkit's own wait for frame N.

## P3, `afterCommit`'s resumption

**Setup:** P1's click also returns a Command that `yield*`s `Render.afterCommit` and reads the mover's box. An element the click inserts has a Mount that emits a Message during the patch, to place the drain. Same 40 runs.

| Check | Result |
|---|---|
| Where the waiter resumes | inside Foldkit's rAF callback (`raf:fk-render`), 40/40 |
| What it sees | the mover at its new box (x = 320), no projection yet, 40/40 |
| The patch's emitted Message | its `update` ran before the waiter, inside the same callback, 40/40 |
| Against the pass | before it, 40/40 |

**Verdict: confirmed**: inside Foldkit's rAF callback, after the patch and the drain, before the Measure pass's microtask. High confidence.

## P2, registration inside the patch

**Setup** (`probes:src/p2.ts`, `analyze-p2.mjs`). The pieces:
- Each Wardic element's Mount finds its provider by `closest("[data-provider]")`.
- It awaits the provider's `Deferred` (get-or-create, keyed by the provider element), registers with the gate and the engine, and animates its `.inner` from the Starting style in `h.Style` (`opacity: 0`) to 1.
- **a:** the provider is the root, built at boot. A click inserts an item above three layout items.
- **b:** a click inserts a keyed provider and three children in one patch.
- **c:** as b, but unkeyed, over an empty `div` at the same place.
- 10 runs of a and b per browser, 3 of c, and 3 + 3 traced (a, b) in Chromium.

| Check | a, Chromium | a, Firefox | b, Chromium | b, Firefox | c (both) |
|---|---|---|---|---|---|
| Provider steps in the patch | (built at boot) | (built at boot) | Mount → built → Deferred done | same | **the provider's Mount never runs** |
| Registrations and `animate` calls | inside Foldkit's callback: 10/10 | 10/10 | 10/10 (children resumed inline by `Deferred.doneUnsafe`, before the provider's next line) | 10/10 | none |
| Pass after the callback, before the marker | 10/10 | 10/10 | 10/10 | 10/10 | none |
| Frame N's marker: entering opacity | 0: 10/10 | 0: 5/10; 5 late reads (0.056) | 0/0/0: 10/10 | 8/10; 2 late reads | 0/0/0 for good |
| Frame N's marker: siblings | at their old y (50/98/146): 10/10 | 5/10; 5 late reads (+2 px) | (none) | (none) | (none) |

**Drawn frames** (Chromium):
- **b:** the first drawn change after the click is the first step (about 6% opacity), then a steady fade; no frame shows a child fully visible early.
- **a:** the last sibling's new place stays empty for 5 frames, then fills gradually; no jump.

**Timing, once:** the provider's Layer build inside its `insert` hook took 3.0 ms in Chromium and 2 ms in Firefox (dev server, unminified; not a benchmark).

**Verdict: confirmed** for both shapes: every registration is done before the checkpoint, and `Deferred.doneUnsafe` resumes waiters inline. High confidence.
- **New, for the binding (c):** an `OnMount` added to an element snabbdom keeps never runs. `sameVnode` matches by selector, key and identity (`fk:src/snabbdom/init.ts:11-25`), and the handler binds only `insert` and `destroy`, plus a `postpatch` used only for replay (`fk:src/html/index.ts:2522-2556`).
- So a `w.div` rendered where an `h.div` was, unkeyed, stays unmounted and keeps its Starting style. The binding has to key its elements, or tell users to.

## P4, release timing at removal

**Setup** (`probes:src/p4.ts`, `analyze-p4.mjs`):
- Four elements, each with one `acquireRelease` in its Mount's Stream.
- A click removes all four in one patch.
- A `MutationObserver` logs the removal's delivery.
- 10 runs per browser.

| Release | Runs in | Element then | Against the removal and the paint |
|---|---|---|---|
| `Effect.sync` | `destroy`, inside Foldkit's rAF callback | connected, at its box (y = 50) | before the removal: 20/20 |
| `Effect.yieldNow` first | a Foldkit-scheduler microtask | disconnected, zero box | after the removal's delivery, before frame N's paint: 20/20 |
| `Effect.sleep(0)` first | a Foldkit-scheduler microtask | disconnected, zero box | after the removal, before the paint: 20/20 |
| `Effect.sleep("5 millis")` first | an Effect timer | disconnected | after the paint: 20/20 |
| `OnUnmount`'s Message | `update` inside Foldkit's callback (the drain) | (none) | 20/20 |

**Verdict: confirmed, with a refinement.** A sync release sees the element connected with its pre-removal box, and an async one runs after the removal. But `Effect.sleep(0)` under Foldkit's scheduler is a microtask, so such a release still runs before that frame's paint. High confidence.

## P5, a Declared layout change through a Command

**Setup** (`probes:src/p5.ts`, `analyze-p5.mjs`):
- Four keyed layout items under a root provider. A click reverses them.
- **The triggers:** `none`; `accessor` (the provider's own accessor for a Prop the view renders fresh every render calls `projection.notify()`: P6's moment); `command` (the update returns a Command: `animateLayout(constVoid)`, then `Render.afterCommit`, then `notify()`).
- **Stale:** before the click, a raw DOM write outside Foldkit grows a header above the list by 40 px. No trigger sees it: no pass ran between registration and the click, in any run.
- Each item's painted y in frame N is classed against its pre-click y. 5 runs per cell and browser.

| Trigger | Fresh boxes, Chromium | Fresh, Firefox | Stale boxes, Chromium | Stale, Firefox |
|---|---|---|---|---|
| none | jump (drawn at the new slot): 5/5 | 5/5 | jump: 5/5 | 5/5 |
| accessor | from the pre-click box: 5/5 | 3/5; 2 late reads (first step) | **drawn 40 px off** (the retained box): 5/5 | 1/5; 4 late reads (off 40 px plus the first step) |
| command | from the pre-click box: 5/5 | 2/5; 3 late reads | from the pre-click box: 5/5 | 3/5; 2 late reads |

- The Command's `animateLayout` measured every node fresh in its own microtask, before the patch (y = 90, the header's growth included).
- The end-of-task pass that followed animated nothing.
- `notify()` from the waiter then gave the pass that animates.

**Verdict: confirmed.** The items animate from their pre-patch boxes through the Command; with no Command they jump. Against P6's moment: it's right only while the retained boxes are, which ADR-0038 predicts for a change no trigger sees. That decides Q14's C question (D.7 C): the retained box is wrong there, and the Command route is right. High confidence in Chromium; Firefox agrees wherever its marker isn't late.

## P6, the props channel

**Setup** (`probes:src/p6.ts`):
- Five elements in document order: S0, P (children C1, C2), S2.
- Each renders a `wardic` Prop minted by a `CustomElement.define` spec's property factory (`probes:src/lib.ts`): `h.Prop` isn't on the public builder.
- A Mount installs an own accessor on all five.
- **Renders:** `fresh` (new objects); `same` (the same references, only a text changes); `drop` (P's view omits the Prop); `back` (P gets one again, fresh).
- **DevTools:** through `foldkit/devtools-host`'s `__setDevToolsOverlay`, a probe "overlay" that keeps the store, then `store.jumpTo(INIT_INDEX)` and `store.resume`, with `devTools: { show: "Always", mode: "TimeTravel" }`.
- 6 runs per browser.

| Step | Setter calls (12/12 runs, both browsers) |
|---|---|
| fresh | S0, P, C1, C2, S2, in that order, inside Foldkit's rAF callback |
| same | none; no getter calls either |
| drop | none: the old object stays on P |
| back | S0, P, C1, C2, S2 |
| replay (`jumpTo(INIT_INDEX)`) | all five with the init values, **synchronously in the task that called `jumpTo`**, not in a rAF |
| resume | all five with the live values, at the next frame's render |

**Verdict: confirmed**: one call per render that builds a fresh value, before the element's children are patched, and replay writes the historical value. High confidence.
- **What the note has wrong:** the note's `h.Prop` (D.2 A, B.2, Summary 6) isn't public API. `Prop` is exported only from `fk:src/html/index.ts:1306`, outside `foldkit/html` (`fk:src/html/public.ts`).
- **The public route:** a CustomElement property factory builds the same attribute (`fk:src/customElement/index.ts:221-226`), and the props module writes it on any element.
- **Dropping an object Prop is silent:** `resetProperty` resets only booleans, strings and numbers (`fk:src/propsModule.ts:67-77`). The binding's release, not the accessor, must see an element stop being Wardic's.
- **A replay render is no rAF frame,** so a Retarget it causes runs in an ordinary task.

## P7, a callback's Message

**Setup** (`probes:src/p7.ts`):
- P1's mover, whose `onLayoutAnimationStart` and `onLayoutAnimationComplete` (both called inside Wardic's tick) offer a Message into the provider Mount's Stream queue with `Queue.offerUnsafe`.
- Its `update` changes a badge's text.
- 6 runs per browser.

| Message | Offered in | `update` runs in | Patch | Painted |
|---|---|---|---|---|
| Started | Wardic's tick (`raf:w-clock`) | the Foldkit-scheduler microtask after the tick, same frame: 12/12 | N+1: 12/12 | N+1: 12/12 |
| Completed | Wardic's tick | same: 12/12 | N+1 | N+1 |

**Verdict: confirmed.** High confidence. For a Mount that emits during the patch, P3 adds that its `update` runs inside Foldkit's rAF callback (the drain), not in the checkpoint.

## P8, presence

**Setup** (`probes:src/p8.ts`, `check-p8-shots.mjs`):
- **The list:** keyed `a, b, c, d`; `b` blue, the others green, an inserted `x` yellow.
- **Steps:** remove `b`; 100 ms later insert `x` after `a`; 100 ms later reverse the list. `b`'s exit is a 400 ms WAAPI fade to 0.5.
- **`mo`:** the presence's Mount observes its own `childList`. In the callback it re-inserts each removed, disconnected child before the record's `nextSibling` (or after its `previousSibling`), runs the exit, then removes it.
- **`hook`:** a `remove` hook set on `b`'s built vnode (`vnode.data.hook.remove`; internal, as `VNode` isn't exported).
- **`none`:** nothing keeps it.
- 5 runs per mode and browser, plus 3 traced per mode in Chromium.

| Mode | Kept by | Markers during the exit | DOM order (both browsers, 10/10) | Drawn frames with `b` (Chromium) |
|---|---|---|---|---|
| mo | the observer's callback, a microtask before the removal frame's paint | `b` present in every marker | `abcd`, then `abxcd`, then `bdcxa`; final `dcxa` | 25 of 26 in each run (the last is after its own removal) |
| hook | the hook, inside Foldkit's rAF callback | present in every marker | the same orders | 24–25 of 25–26 |
| none | (nothing) | missing at once | `acd`, `axcd`, `dcxa` | 0 |

**Verdict:**
- **Confirmed:** no frame paints the leaver missing, in drawn frames too. An insert during its exit lands right: `x` after `a` and the leaver, before `c`.
- **Refuted in part:** "a keyed reorder leaves it where the controller put it". Foldkit never moves the leaver, an unknown node, but moves the known nodes around it, so after the reverse it's first, not after `a`. The `remove` hook gives exactly the same orders: it's snabbdom's own behaviour for a node pending removal.
- **The rest holds:**
  - the observer saw the reorder's 6 records and correctly ignored moved (connected) nodes;
  - the final order is the view's.
- High confidence. The order caveat is the binding's: Motion's AnimatePresence keeps an exiting child at its slot in the rendered order.

## P9, the scheduler

**Setup** (`probes:src/p9.ts`):
- dom's `makeRunner`, what `FlushGate.make` and `DomProjectionSystem.make` fork with, as #208's RN3 uses it.
- Built with Wardic's Layer in a Mount's Scope, and in the program's `resources`, which the first (init) Command builds.
- A runner fork that `yield*`s `Effect.yieldNow` logs where it resumes.
- Plus C2's MemoMap question.
- 5 runs per browser.

| Context | Scheduler where Wardic's Layer is built | Fork resumes in | MemoMap |
|---|---|---|---|
| Mount (init render) | Foldkit's `MixedScheduler("async")` | a Foldkit-scheduler microtask: 10/10 | `Effect.provide(wardicLayer)` twice gives two gates, and neither is the Mount's own build: 10/10 |
| `resources` (via a Command) | `async` | a Foldkit-scheduler microtask: 10/10 | the Command's `Effect.provide(wardicLayer)` returns the gate already in `resources`: 10/10 |

**Verdict: confirmed**: a microtask in both. High confidence. It also settles C2's two inferences: a Mount builds fresh, a Command reuses `resources`.

## P10, `viewTransition`

**Setup** (`probes:src/p10.ts`, `check-p10-shots.mjs`):
- The program's predicate transitions `Clicked`. That render moves P1's mover (20 → 320) and swaps a `layoutId: "pill"` pair: `#tab-a` (left 20) goes and `#tab-b` (left 320) comes.
- `document.startViewTransition` is wrapped: the call, its update callback, `ready` (the group animations' keyframes and the elements' boxes) and `finished` are logged.
- `named=1` gives both elements a `viewTransitionName` in `h.Style`.
- Groups animate 0.5 s, linear.
- 4 runs per variant and browser, plus 2 + 2 traced in Chromium. Both browsers have the API.

| Check (16/16 runs, both browsers) | Result |
|---|---|
| `startViewTransition` called | inside Foldkit's rAF callback in frame N; that frame paints the old DOM |
| The update callback | a later task in the same frame count: the patch runs there, `tab-a`'s node disposed and `tab-b`'s registered (the handover) |
| Wardic's pass | in the update callback's microtask, before `ready` |
| At `ready` | mover and pill both drawn at x = 20 (origin projection, `translate3d(-300px…)`) |
| Captured group keyframes, named | mover (20,60) → (20,60), pill (20,200) → (20,200): no geometry change; root (0,0) → (0,0) |

**Drawn frames** (Chromium), against the DOM's x each frame:

| Shot | named=1: drawn | named=1: DOM | named=0: drawn | named=0: DOM |
|---|---|---|---|---|
| 0 | 19 | 20 | 19 | 20 |
| 5 | 27 | 70 | 19 (ghost) | 70 |
| 10 | 50 | 120 | 21 (ghost) | 120 |
| 13 | 72 | 150 | pill: two copies (154 coloured columns) | 150 |
| 20 | 148 | 220 | 222 | 220 |
| 32 | 320 | 320 | 320 | 320 |

**Verdict: confirmed, and more precisely shaped.** The new snapshot captures the origin projection, and the morph and Wardic's FLIP run on top of each other.
- **Named:** the drawn position fits 20 + p·(live − 20), with p the transition's progress. Motion that looks doubly eased: slow out, then catching up.
- **Unnamed:** the root crossfade shows a static ghost at the origin while the live element moves under it.
- It holds for a plain `layout` element as well as a `layoutId` handover, so the A.12 row's widening stands.
- Confidence: high for Chromium; for Firefox, high for the order and capture data, untested for pixels.

## P14, hydration and first paint

**Setup** (`probes:src/p14/app.ts`, `ssr.mts`, `src/p14/client.ts`, `analyze-p14.mjs`, `check-p14-shots.mjs`):
- **Server:** `node ssr.mts` runs `Server.renderToString({ init, view }, { buildId })` and `Server.renderDocument(…, { head })`. `head` carries the page CSS and the instrumentation script. The view renders a card with `h.Style({ opacity: "0", transform: "translateY(8px)" })` and an `OnMount`, plus an `h.style` element.
- **Client:** `Runtime.hydrate`. The card's Mount builds Wardic's Layer and animates it to opacity 1, y 0 over 0.3 s, linear.
  - **from=own:** `{ opacity: 1, y: 0 }`, origins as the plain-element path reads them.
  - **from=explicit:** `{ opacity: [0, 1], y: [8, 0] }`, the Starting style as the first keyframe, as a binding's spine starts from `initial`.
- **Logged:** a `MutationObserver` set before `hydrate` logs every style and child-list change. A re-render after the animation checks for rewrites.
- **Runs:** dev 5 + 5 per browser, plus 3 + 3 traced; production (`vite build`, `vite preview`) explicit 5 per browser, plus 3 traced.

| Check | Dev server | Production build |
|---|---|---|
| When the Mount runs | in a timer task about 500 ms after `hydrate()` returns: Foldkit's wait for its Vite plugin's model-preservation reply (`fk:src/runtime/modelPreservationBridge.ts:29`, `:35-63`), which these probes don't install | **synchronously inside `Runtime.hydrate()`**, in the client module's task: 13/13 |
| Mount against the first frame after hydration | before it: 26/26 | before it: 13/13 |
| Style writes during hydration | 0 (the Mount reads `opacity: 0; transform: translateY(8px)` intact) | 0 |
| Child-list changes during hydration | 0 (the body `<style>` and every node adopted as served) | 0 |
| First paint after hydration | opacity 0.056; y 7.56 (explicit) or 0 (own) | opacity 0.056, y 7.56 |
| Paints going back (opacity down or y up) | 0 | 0 |
| First paint at full opacity | the landing frame (paint 18–19, 0.3 s at 60 Hz) | paint 18 |
| Writes after a later re-render | 0 (Foldkit's style module leaves Wardic's values) | 0 |
| Drawn frames (Chromium) | server HTML first (FCP), card invisible for about 760 ms until the Mount, then darkening steadily, never back | the same, 30–49 ms from FCP to the Mount |

- **Starting style keys.** In both variants the first write to the card was the gate's own frame callback in frame 1, `opacity: 0; transform: none`, before the Clock's. The tick then wrote the first step in the same frame, so no painted frame showed it.
  - With `from=own`, the plain-element path takes `y`'s origin as its target, so the 8 px drop happens at once at about 6% opacity: that's the probe's animation path, not Foldkit.
  - For the binding: the Starting style's keys must reach the gate's values at registration, as the spine's start values do. Otherwise a gate flush in a frame with no tick after it (a delayed animation, say) would draw over them. Not tested further.
- **The head channel.** The view's `Document` has `title`, `lang`, `dir`, `canonical`, `ogUrl` and `body` only (`fk:src/html/index.ts:295-302`).
  - **`renderDocument`'s `head`** is "trusted HTML to add to the head", one string per call (`fk:src/experimental/server/document.ts:36-41`, `:53-84`). A host that uses `injectIntoTemplate` owns its whole template (`template.ts:720`).
  - **Collecting it.** The view runs synchronously inside `renderToString` (`server.ts:1220-1240`), so a binding's server entry can collect Appear's CSS during the render and pass one `<style>` through `head`.
  - **In the view.** `h.style([], [css])` serializes as raw text in the body (`serialize.ts:66-72`) and hydrates untouched. That's a channel too, outside `<head>`.

**Verdict:**
- **Hydration flicker: none.** No frame paints the element at its final state before the animation starts, and none jumps back. Drawn frames confirm it in Chromium; the paint markers agree in Firefox.
- **Timing:** `insert` hooks and Mounts run in the hydration task, before the first paint after hydration. That's synchronous in production; under the dev server it's delayed about 500 ms by Foldkit's plugin wait.
- **Hydration keeps the server's inline style.**
- High confidence for Chromium; medium-high for Firefox (markers only).

## P13, what a Measure pass every render costs

**The question:** should a `MutationObserver` on the provider's subtree run a pass after every patch that changed the DOM (R5 Q19; D.7 D)? Measured, not decided.

**Setup** (`probes:p13.html`, `src/p13.ts`, `src/lite.ts`, `src/wardic-timed.ts`, `run-p13.mjs`, `run-p13-all.sh`, `analyze-p13.mjs`):
- **The build:** production (`PROBE_PAGES=p13 PROBE_OUT=dist-p13 vite build`, unminified), served by `vite preview` on 127.0.0.1.
  - Cross-origin isolated (`PROBE_COI=1`: COOP + COEP), so `performance.now()` resolves to 5 µs in Chromium and 20 µs in Firefox. Both pages report `crossOriginIsolated`.
  - `wardic-quiet` passed (0.2% busy) first. Nothing else of mine ran during the timing.
- **The app:** a Foldkit element with N keyed items in a vertical list (16 px tall, fixed width), each registered with the gate and the engine as P1's `.mover` is, with a 0.15 s linear tween. The root renders a fresh `wardic` Prop every render, in every cell, so each cell's patch does the same work.
- **Render kinds,** each a Message from a click in a timer task:
  - **a:** a Model field the view doesn't read, so the view's output is identical;
  - **b:** item N/2's text, its box fixed, so no box moves;
  - **cr:** a keyed reverse of all N;
  - **cg:** item 0's class toggles its height 16 ↔ 36 px, shifting every item after it.
- **Triggers,** each on top of registration and the engine's shared `ResizeObserver` (Solid's coverage):
  - **none:** nothing more (trigger 1);
  - **render:** the root's own accessor for its Prop calls `projection.notify()`, P6's setter (trigger 2);
  - **mo-ignore:** a `MutationObserver` on the root (`childList`, `attributes`, `characterData`, `subtree`) that calls `notify()` when a delivery holds any record but a `style` attribute change (trigger 3);
  - **mo-filter:** the same, with `attributeFilter: ["class", "hidden", "id"]`, so no `style` write makes a record at all (trigger 3, its other guard).
  - Disconnecting during the pass wasn't tried: the gate writes `style` on every animation frame too, not only in the pass, and `disconnect()` empties the observer's record queue (the DOM Standard, *not re-read for this note*), so a patch's records queued before it would need `takeRecords()` first.
- **The reference** (`refa`, `refb`): a plain click listener in a timer task calls `notify()`, so the pass runs at the end of an ordinary task. In `refb` the listener first writes item N/2's text node itself.
- **Timed,** on the page's clock, with no stack captures (`lite.ts`):
  - **pass:** each round of the pass (`sink.flushPass`: reset, read, FLIP, the pass's own writes), through a sink wrapped around the gate (`DomProjectionSystem.make`);
  - **fk:** Foldkit's rAF callback (`renderFramePlain`: view, patch, drain);
  - **mo:** the observer's deliveries in that frame;
  - **Wardic JS:** pass + mo + the engine's own `ResizeObserver` delivery;
  - **span:** from Foldkit's callback start to the end of the pass's microtask (for `cg` under `none`, the end of the `ResizeObserver` delivery's pass, so the frame's style and layout are inside it);
  - **long:** a heartbeat rAF loop sees every frame; a frame is long when the next starts more than 25 ms after it;
  - **trace** (Chromium, 2 more runs a cell): each render frame's main-thread work between two `BeginMainThreadFrame`s, as script, rendering (style, layout, pre-paint, paint, layerize, commit) and both ("busy").
- **Runs:** per cell and browser, 5 runs of 5 warm-up renders and 30 timed renders per kind (150 renders a cell, 4,800 a browser), cells interleaved in each run; plus the 2 traced Chromium runs (60 renders a cell).

**What a pass does when no box moved** (from `wardic:packages/dom/src/internal/projection.ts`):
- **Yes, it resets every transform and reads every box.** `runMeasurePass` (`:3693-4152`), per pass, for every registered node:
  - `computeTree()` walks each node's DOM ancestry and marks the depth order stale, so `inDepthOrder()` sorts all N again (`:2830-2836`, `:2872-2895`);
  - **write:** saves `style.transform` and sets it to `""` (`:3708-3732`). An at-rest node's transform is `none` (read back in P13), so this is a real change;
  - **read:** `getBoundingClientRect()` per node (the first forces style, and layout if the patch dirtied it), the document's scroll, the page boxes' sizes, and each node's live computed `position` and its ancestors' for the scroll fold (`:3760-3790`, `:3068`, `:3092-3103`);
  - `readsAsBefore` then finds nothing moved, so no ancestor transform is read (`:3808-3816`);
  - **write:** restores every transform (`:3847-3860`), a second real change;
  - the FLIP loop skips every node (`boxesEqual`, `:4113`), nothing is seeded, and `flushPass` commits nothing (`internal/gate.ts:528-546`).
- So a pass that finds nothing still costs N reads and 2N inline-style writes, and leaves N elements' style to recalculate in that frame's rendering. Under `mo-ignore` those 2N writes are 2N `style` records (2,001 a pass at N = 1,000, below).

**The pass, and Wardic's JS in the frame** (ms, median / p95; Chromium "Chr", Firefox "FF"; 150 renders a cell):

| N | Kind | Trigger | Renders with a pass | Pass, Chr | Pass, FF | Wardic JS, Chr | Wardic JS, FF |
|---|---|---|---|---|---|---|---|
| 50 | a | none, mo-ignore, mo-filter | 0 | – | – | 0 | 0 |
| 50 | a | render | 150 | 0.37 / 0.53 | 0.84 / 1.06 | 0.37 / 0.53 | 0.84 / 1.06 |
| 50 | b | none | 0 | – | – | 0 | 0 |
| 50 | b | render | 150 | 0.49 / 0.54 | 0.94 / 1.12 | 0.49 / 0.54 | 0.94 / 1.12 |
| 50 | b | mo-ignore | 150 | 0.53 / 0.70 | 1.00 / 1.32 | 0.57 / 0.75 | 1.08 / 1.42 |
| 50 | b | mo-filter | 150 | 0.48 / 0.68 | 1.04 / 1.26 | 0.52 / 0.73 | 1.14 / 1.34 |
| 50 | cr | none | 0 (items jump) | – | – | 0 | 0 |
| 50 | cr | render / mo-ignore / mo-filter | 150 | 1.09–1.10 / 1.36–1.42 | 1.78–1.86 / 2.27–2.52 | 1.10–1.13 / 1.36–1.46 | 1.78–1.94 / 2.28–2.59 |
| 50 | cg | none (the `ResizeObserver`) | 150 | 0.56 / 0.81 | 1.28 / 1.59 | 0.62 / 0.88 | 1.39 / 1.75 |
| 50 | cg | render / mo-ignore / mo-filter | 150 | 0.69–0.70 / 0.74–0.79 | 1.32–1.42 / 1.52–1.62 | 0.70–0.75 / 0.76–0.84 | 1.38–1.53 / 1.58–1.73 |
| 1,000 | a | none, mo-ignore, mo-filter | 0 | – | – | 0 | 0 |
| 1,000 | a | render | 150 | 3.43 / 3.86 | 6.51 / 7.37 | 3.43 / 3.86 | 6.51 / 7.37 |
| 1,000 | b | none | 0 | – | – | 0 | 0 |
| 1,000 | b | render | 150 | 3.69 / 3.80 | 6.59 / 7.35 | 3.69 / 3.80 | 6.59 / 7.35 |
| 1,000 | b | **mo-ignore** | 150 | 3.91 / 4.22 | 7.12 / 7.70 | **3.98 / 4.32** | **7.25 / 7.82** |
| 1,000 | b | **mo-filter** | 150 | 3.76 / 3.98 | 6.58 / 7.29 | **3.79 / 4.02** | **6.66 / 7.36** |
| 1,000 | cr | none | 0 (items jump) | – | – | 0 | 0 |
| 1,000 | cr | render | 150 | 6.36 / 7.24 | 8.45 / 10.18 | 6.36 / 7.24 | 8.45 / 10.18 |
| 1,000 | cr | mo-ignore | 150 | 6.20 / 6.78 | 9.02 / 11.90 | 6.31 / 6.90 | 9.14 / 12.01 |
| 1,000 | cr | mo-filter | 150 | 5.95 / 6.75 | 8.56 / 10.59 | 6.00 / 6.81 | 8.63 / 10.66 |
| 1,000 | cg | none (the `ResizeObserver`) | 150 | 3.44 / 3.73 | 6.88 / 7.33 | 3.49 / 3.78 | 6.98 / 7.43 |
| 1,000 | cg | render | 150 | 3.93 / 4.09 | 7.22 / 7.70 | 3.95 / 4.11 | 7.24 / 7.72 |
| 1,000 | cg | mo-ignore | 150 | 4.10 / 4.43 | 7.48 / 8.00 | 4.18 / 4.51 | 7.60 / 8.13 |
| 1,000 | cg | mo-filter | 150 | 3.99 / 4.18 | 7.15 / 7.83 | 4.03 / 4.23 | 7.23 / 7.95 |

**The frame,** from Foldkit's callback start to the pass's end ("span"), and Chromium's traced main thread ("busy", 60 renders a cell), ms, median / p95:

| N | Kind | Trigger | fk, Chr | fk, FF | Span, Chr | Span, FF | Busy, Chr | Busy > 16.7 ms |
|---|---|---|---|---|---|---|---|---|
| 1,000 | a | none | 1.53 / 2.19 | 2.06 / 2.79 | 1.53 / 2.19 | 2.06 / 2.79 | 1.89 / 2.90 | 0 |
| 1,000 | a | render | 1.22 / 2.10 | 1.96 / 2.56 | 4.74 / 5.79 | 8.88 / 9.64 | 6.17 / 7.27 | 0 |
| 1,000 | b | none | 1.16 / 1.40 | 2.06 / 2.45 | 1.16 / 1.40 | 2.06 / 2.45 | 2.38 / 3.17 | 0 |
| 1,000 | b | render | 1.23 / 1.38 | 1.95 / 2.45 | 5.01 / 5.21 | 8.96 / 9.69 | 6.76 / 8.46 | 0 |
| 1,000 | b | mo-ignore | 1.14 / 1.33 | 2.28 / 2.74 | 5.33 / 5.77 | 9.90 / 10.30 | 6.76 / 8.85 | 1 / 60 |
| 1,000 | b | mo-filter | 1.15 / 1.31 | 1.98 / 2.39 | 5.01 / 5.41 | 9.12 / 9.70 | 6.75 / 8.47 | 0 |
| 1,000 | cr | none | 3.47 / 4.07 | 5.01 / 5.89 | 3.47 / 4.07 | 5.01 / 5.89 | 9.90 / 11.32 | 0 |
| 1,000 | cr | render | 3.48 / 3.77 | 6.62 / 7.62 | 9.96 / 10.87 | 15.22 / 17.18 | 16.37 / 17.88 | 22 / 60 |
| 1,000 | cr | mo-ignore | 4.09 / 4.47 | 7.43 / 8.31 | 10.72 / 11.47 | 16.95 / 20.08 | 16.76 / 18.01 | 31 / 60 |
| 1,000 | cr | mo-filter | 4.09 / 4.35 | 7.53 / 8.18 | 10.13 / 11.34 | 16.25 / 19.02 | 16.85 / 17.65 | 34 / 60 |
| 1,000 | cg | none | 1.19 / 1.41 | 1.90 / 2.42 | 5.51 / 5.93 | 9.62 / 10.31 | 7.36 / 9.01 | 0 |
| 1,000 | cg | render | 1.26 / 1.48 | 1.96 / 2.37 | 6.72 / 7.24 | 11.82 / 12.52 | 7.32 / 9.21 | 0 |
| 1,000 | cg | mo-ignore | 1.17 / 1.51 | 1.92 / 2.05 | 6.97 / 7.36 | 12.20 / 15.07 | 7.69 / 9.60 | 0 |
| 1,000 | cg | mo-filter | 1.15 / 1.47 | 1.89 / 2.36 | 6.70 / 7.21 | 11.73 / 13.11 | 7.10 / 9.29 | 0 |

- **At N = 50** every frame is small: span 0.3–1.7 ms in Chromium and 0.4–3.0 ms in Firefox (p95 ≤ 2.1 and ≤ 4.0), busy ≤ 3.2 ms median.
- **The traced script time** (Chromium, N = 1,000, b): 1.31 / 2.12 ms with no pass, 5.16–5.33 / 6.90–7.19 with one.

**The reference, a pass from a plain task** (the click listener's `notify()`; task = the listener's start to the pass's end), ms, median / p95:

| N | Ref | Trigger | Pass, Chr | Pass, FF | Task, Chr | Task, FF |
|---|---|---|---|---|---|---|
| 50 | refa (nothing changed) | none | 0.37 / 0.41 | 0.82 / 0.98 | 0.51 / 0.57 | 1.08 / 1.25 |
| 50 | refb (a text written) | none | 0.50 / 0.59 | 0.97 / 1.14 | 0.66 / 0.76 | 1.26 / 1.42 |
| 1,000 | refa | none | 3.41 / 3.61 | 7.74 / 8.17 | 3.57 / 3.74 | 8.00 / 8.43 |
| 1,000 | refa | mo-ignore | 3.84 / 4.06 | 7.96 / 8.44 | 3.98 / 4.19 | 8.20 / 8.66 |
| 1,000 | refa | mo-filter | 3.54 / 3.69 | 7.64 / 8.15 | 3.67 / 3.82 | 7.90 / 8.39 |
| 1,000 | refb | none | 3.71 / 3.88 | 7.99 / 8.44 | 3.88 / 4.05 | 8.29 / 8.77 |

- **Against ADR-0018** (0.4–0.8 ms at 50, 6–10 ms at 1,000, an older host): on this box a pass is 0.37–0.50 ms at 50 and 3.4–3.9 ms at 1,000 in Chromium, 0.8–1.0 and 6.5–8.0 in Firefox. Not comparable across hosts; the paired reference is.
- **The patch's pass costs what a task's does:** at N = 1,000, b's `render` pass is 3.69 ms against `refb`'s 3.71 in Chromium (6.59 against 7.99 in Firefox, the patch's the cheaper).

**The observer itself:**
- **Its deliveries are cheap:** 0.03–0.12 ms a render frame, medians, p95 ≤ 0.18 ms, even with 4,998 records (`cr` at N = 1,000).
- **What a `style` record costs is the writes that make it:**
  - **In the pass.** Under `mo-ignore` the pass's own 2N writes become 2N records (2,001 at N = 1,000 in b). That slows the pass that made them: `refa` 3.84 ms against 3.41 with no observer in Chromium (+0.43), 7.96 against 7.74 in Firefox (+0.22). `mo-filter`'s 3.54 and 7.64 are within noise of none.
  - **On every animation frame.** The gate's flush writes N `style`s, so `mo-ignore` gets a delivery of N records each frame: after `cr` at N = 1,000, Wardic's tick plus delivery is 1.12 / 1.71 ms a frame in Chromium against 0.94 / 1.40 under `render` (1.74 against 1.62 in Firefox). The delivery itself is 0.02 ms; the rest is the records' making. `mo-filter` gets none.
  - **In the patch.** Foldkit's callback for `cr` at N = 1,000 is 4.09 ms under either observer against 3.47–3.48 without one in Chromium: about 0.6 ms for ~2,000 `childList` records.
- **What it covers, against Solid's (`none`):**
  - **a:** no records, so no pass, like `none`.
  - **b:** a pass that finds nothing moved: the whole cost above, for nothing.
  - **cr:** the pass that animates the reorder; `none` jumps.
  - **cg:** a pass `none` gets too, from the engine's `ResizeObserver` after layout. The observer's runs before layout, in the patch's checkpoint.
  - Neither observer variant sees an `h.Style` change (a `style` record): a style change that moves a box without resizing one is missed, as D.7 D says.

**Long frames:**
- **Render frames:** 1 long in 11,520 (9,600 untraced, 1,920 traced): a traced Chromium `cg` frame at N = 50 under `none`, 36 ms (busy 2.5 ms at p95 in that cell, so not the page's work; *inferred*: the tracer or the host).
- **Animation frames:** 2 long in about 54,000: one in Firefox (`cr`, N = 1,000, `mo-filter`), one in a traced Chromium run (`cg`, N = 1,000, `mo-ignore`).
- **The reorder at N = 1,000 is near the budget in Chromium's trace:** busy 16.4–16.9 ms median when a pass runs, above 16.7 ms in 22–34 of 60 frames, which stretched to at most 19.3 ms. The same reorder with no pass is busy 9.9 ms: the pass adds about 6.5 ms of script and about 3.3 ms of rendering (5.9 → 9.1–9.3 ms; the FLIP's first transforms are written in that frame).

**Verdict** (a measurement; nothing decided):
- **Trigger (3) at N = 1,000, kind b (the common case):**
  - **Chromium:** Wardic's JS is 3.79 / 4.02 ms with `mo-filter` and 3.98 / 4.32 with `mo-ignore`. The median is under ADR-0027's 4 ms, the p95 just over. Almost all of it is the pass, which finds nothing moved.
  - **Firefox:** 6.66 / 7.36 and 7.25 / 7.82 ms: over.
  - Foldkit's own callback (1.1–2.3 ms) comes on top, so the frame's span is 5.0–5.3 ms in Chromium and 9.1–9.9 ms in Firefox, against 1.2 and 2.1 ms with no pass.
- **At N = 50** the pass is 0.5 ms in Chromium and 1.0–1.1 ms in Firefox: no budget question.
- **Of the two guards,** an `attributeFilter` without `style` is the cheaper and the safer: no records from the gate's writes, in the pass or on any animation frame. Ignoring `style` in the callback costs 0.1–0.4 ms more a pass at 1,000 and makes a delivery on every animated frame.
- **Confidence:** high for Chromium (production build, 4,800 renders, quiet host, traces agree with the page's clock); medium-high for Firefox (no trace, page clock at 20 µs).

## P19, putting a leaver back after a keyed reorder

**The question:** P8's leaver ends first after a keyed reverse. The proposed fix (R5 Q17): after each patch, re-place every leaver by Solid's `orderOf`. Does that ever fight Foldkit's next patch?

**Setup** (`probes:p19.html`, `src/p19.ts`, `run-p19-all.sh`, `analyze-p19.mjs`, `check-p19-shots.mjs`):
- **The controller,** in the probe only, on P8's re-insert one: the presence's Mount observes its own `childList`. In each delivery (the patch's checkpoint, before paint) it:
  - takes the removed, disconnected children Foldkit removed as new leavers, and starts each one's exit (a 400 ms WAAPI fade to 0.5);
  - takes a fresh child whose key is a leaver's as a take-over (below);
  - computes the order with `orderOf(before, now)`, copied from `wardic:packages/solid/src/presence-controller.ts:372-383`: `before` is the order it placed last time, `now` the known children as the patch left them;
  - puts every leaver, new or still exiting, at its place in that order;
  - drops its own records with `takeRecords()`, and does so again after each exit's removal.
- **Keys on the DOM:** every child is `h.keyed` and carries `data-key`, which the controller reads. Foldkit keeps the key on the vnode only.
- **Logged:** every `insertBefore`, `appendChild` and `removeChild` on the list, by whom (Foldkit or the controller) and whether it moved a child already there; and the reference node, when it was a leaver.
- **Checks:**
  - after every delivery, Foldkit's known children in the Model's order, and the whole list in the computed order;
  - every paint marker (a heartbeat rAF loop gives every frame one), the drawn list against the order placed by then;
  - Chromium's drawn frames, each slot classed by hue (the fade keeps a hue), against the order as that frame painted;
  - Foldkit's own moves against a `keep=none` control: the same Model steps, no presence.
- **Runs:** 11 scenarios, 5 runs per browser plus 3 traced in Chromium; the control once per browser. Plus a fuzz: 5 seeds of 150 random steps 60 ms apart (insert, remove one or two, reverse, shuffle, move, swap, a leaving key back) over keys a–l, so leavers pile up, in both browsers, with and without the presence.

**Predicted from the patch, then run.** How 0.170's fork picks its reference nodes (`fk:src/snabbdom/init.ts:320-391`, `:556-730`):
- **`referenceBefore`** and the tail's `addVnodes` use `firstChildElmIn`: the first *known* element in a range that's still a child (`isChildOf`, from 0.169). Never a leaver.
- **`referenceAfter`** uses `nextSibling(previousEndElm)`, the DOM's next sibling, which can be a leaver. Only "moved right" and "a new vnode at the end" reach it.
- **So Foldkit never moves a leaver,** and puts a known node before one only through `referenceAfter`. Its moves depend on the vnodes alone, so a leaver can't add or remove one.

| # | Scenario (from a b c d; `*` exiting) | Predicted and measured, Foldkit's patch | Placed by `orderOf` | Controller | Foldkit's moves, with / without the presence |
|---|---|---|---|---|---|
| 1 | remove b; reverse | `acd`, then `b*dca` | `ab*cd`, then `dcab*` | 1 re-insert, 1 move | 2 / 2 |
| 2a | remove b; x into b's gap (`a x c d`) | `ab*xcd` (x before c) | `ab*xcd` | none | 0 moves, 1 insert / same |
| 2b | then y into the gap again (`a y x c d`) | `ab*yxcd` (y before x) | `ab*yxcd` | none | 0 moves, 1 insert / same |
| 3 | 1, then a second reorder (`c a d`) | `cadb*`: d put before b, Foldkit's reference the leaver (`nextSibling(a)`) | `cab*d` | 1 more move | 1 / 1 |
| 4 | remove b; remove a, the child it follows | `b*cd` | `a*b*cd` | 1 re-insert | 0 moves, 1 removal / same |
| 5 | remove b; b back at its place | `ab*bcd`: a fresh b, before c | `abcd` | take-over | 0, 1 insert / same |
| 5b | remove b; b back at the end | `ab*cdb` | `acdb` | take-over | 0, 1 insert / same |
| 6 | remove b and c; reverse | `ad`, then `b*c*da` | `ab*c*d`, then `dab*c*` | 2 re-inserts, 2 moves | 1 / 1 |
| 7a | remove a (first); reverse | `bcd`, then `a*dcb` | `a*bcd`, then `a*dcb` | 1 re-insert | 2 / 2 |
| 7b | remove d (last); reverse | `abc`, then `cbad*`: a put before d, the leaver as reference | `abcd*`, then `cd*ba` | 1 re-insert, 1 move | 2 / 2 |
| 8a | remove b; empty the list | `b*` | `a*b*c*d*` | 3 re-inserts | 3 removals / same |
| 8b | remove b; remove the presence element | (no delivery) | (gone) | the Mount's release disconnects the observer in `destroy`; b goes with the list | – |

Every prediction held, in all 5 runs of each scenario in both browsers (identical logs).

**Checks** (each row's 5 runs per browser, both browsers alike):

| Check | 1–8b | Fuzz (5 seeds × 150 steps, per browser) |
|---|---|---|
| Exceptions (page errors, controller throws) | 0 | 0 |
| Known children in the Model's order, after every delivery | 115 / 115 | 667 / 667 |
| The list in `orderOf`'s order, after every delivery | 115 / 115 | 667 / 667 |
| Paint markers drawn in the placed order | 3,071 / 3,071 (Chromium), 3,076 / 3,076 (Firefox) | 2,915 / 2,915, 2,914 / 2,914 |
| Chromium drawn frames in the placed order (3 traced runs a scenario) | 806 / 806, plus 8b's 3 last frames, which draw no list, as its Model has none | not traced |
| Foldkit's moves of known nodes, with / without the presence | identical in every patch (table above) | 511 / 511 |
| Patches whose reference node was a leaver | 3 and 7b's second | 44 |
| Observer deliveries | one per patch (115) | one per patch (667) |
| Deliveries made by the controller's own moves | 0 (its 215 own records dropped) | 0 (896 dropped) |
| Take-overs | 10 (5, 5b) | 45 |

- **Drawn frames, Chromium** (`check-p19-shots.mjs`), e.g. scenario 3: `abcd` ×6, `dcab` ×6, `cabd` ×13, then `cad` once b's exit ends. Scenario 7b: `abcd` ×6, `cdba` ×19, `cba`. The leaver is drawn at its `orderOf` place in every frame of its exit, in every scenario.

**What the fix didn't foresee:**
- **Every leaver needs re-placing, not just this change's.** Foldkit moves its known nodes around a leaver from an earlier change too (3, 6, 7b and the fuzz). Solid's controller puts back only the children that left in the change (`presence-controller.ts:1361-1362`), since Solid moves its own nodes in order.
- **`backPlaceOf` isn't enough for several leavers at once.** Applied to every leaver (right after the nearest child before it that's on the page, else before the nearest one after it), it placed the list off `orderOf`'s order in 8 of 667 fuzz deliveries, in both browsers (`results/p19-back/`, `p19-back-analysis.txt`).
  - **The case:** fuzz seed 1, delivery 17. Foldkit left `d* c k*`, and the order is `d e k c b`, with e and b just removed.
  - **What happened:** d's nearest child on the page after it was k, itself an earlier leaver not yet in place, so d went before k and so after c: the list ended `c b* d* e* k*`.
  - **The fix used here:** place in the order's order, each leaver right after the element before it in the order (the first at the list's start), so each is placed against one already in place. 0 misses in the same 667 deliveries, and in every scenario.
- **The key has to be on the DOM.** To see a key re-enter, the controller needs each child's key. Foldkit doesn't render it, so `w.keyed` has to (here `data-key`), or each `w.*` Mount has to register it.
- **A key re-entering while it exits gets a fresh element.**
  - **What Foldkit does:** the old vnode was removed, so it creates a new node for the key and inserts it at its Model place, by a known reference. For a moment the leaver and the fresh node both sit in the list (`ab*bcd`), but only until the delivery, so no frame draws both.
  - **What the controller does:** cancel the exit, remove the leaver, and start the fresh one from the leaver's state (here opacity 0.81, faded back to 1).
  - **For 5b,** where the fresh node lands elsewhere, the leaver's slot closes in that frame. Starting from the leaver's box is Wardic's take-over (`enteredFrom`, #286), which this probe didn't run.
- **Its own records:** a `takeRecords()` at the end of each delivery and after each exit's removal. With them, no delivery came from the controller's own moves.
- **Removal of the presence element:** its Mount's release runs in `destroy` and disconnects the observer. The exits' end callbacks then remove nodes from a detached list, which they must tolerate. Nothing threw.

**A side finding: `orderOf` isn't quite its comment's rule.**
- **Its comment says** each leaver goes "right after the staying child it followed".
- **Its arithmetic** (`next = i + back + 1`, counting every leaver put back so far, wherever) differs under a reorder with leavers after different staying children: in 20 of 667 fuzz deliveries, a later leaver landed after an earlier one rather than after its own staying child.
- **That's Motion's arithmetic:** `framer-motion@14.9.0`'s `AnimatePresence` does the same (`insertionIndex = presentIndex + exitingChildren.length + 1`, `dist/es/components/AnimatePresence/index.mjs:120-131`, read in `.tmp/519/deps/`). So the controller matches Motion. The comment overstates it.
- **Motion also keeps** every exiting child until all have finished, then drops them together (`:136-143`). This probe removes each leaver at its own exit's end.

**Verdict: the fix works, with the placement changed. It never fights Foldkit's next patch.** High confidence: 11 scenarios × 10 runs and the fuzz, 1,564 checked deliveries over both browsers, 12,000 paint markers, 809 Chromium drawn frames.
- Foldkit's known children always end in the Model's order, and its moves are the same with or without leavers.
- A leaver Foldkit uses as a reference node changes only where Foldkit's node lands, before it, and the next placement fixes that before paint.
- The binding's controller must:
  - re-place every leaver after every patch, in the order's order against the element before it, not by `backPlaceOf`'s nearest neighbour;
  - read keys from the DOM;
  - take over a re-entering key's fresh element;
  - drop its own records.

## P20, the held frame beyond layout

**The question:** P1 showed a layout move from an update-driven render paints its origin in the patch's frame N and moves at N+1. Note B.3 *infers* the same for other starts (R5 Q20). Checked here: a Retarget, an interrupted move, a swap from a pointer event, and Solid on this box as the reference.

**Setup** (`probes:src/p20a.ts`, `p20b.ts`, `p20c.ts`, `p20d.tsx`, their `.html`, `run-p20.mjs`, `run-p20-all.sh`, `analyze-p20.mjs`, `check-p20-shots.mjs`, `vite.solid.config.ts`):
- **Like P1:** dev servers on 127.0.0.1 (5199 for Foldkit; 5198 for Solid), `instrument.ts`'s paint markers in both browsers, and Chromium's drawn frames from traces. Each page runs cold (nothing animating) and warm (a repeating Wardic animation keeps the Clock ticking). Clicks are `element.click()` in a timer task, as P1's.
- **a, a Retarget in the patch:** an own accessor on `.box` for a `wardic` Prop calls `animate(box, target, 0.5 s linear)`. That's the imperative path's plain-element spine (`makeElementSpine`, `wardic:packages/solid/src/imperative.ts:102-131`), so a changed target is the spine's Retarget.
  - The view renders the target from the Model, so the setter runs inside the patch.
  - Click 1: x 0 → 300, or opacity 1 → 0.2, from rest. Click 2, 250 ms later: back to x 0 (opacity 1), a Retarget of the running leg.
- **b, an interrupted layout move:** P1's mover, `left` 20 → 320 at click 1, then on to 620 at click 2, 250 ms later, mid-flight. Click 1 is P1's case, the Foldkit side of d.
- **c, a Reorder-style swap:** four keyed layout items under a root accessor (`notify()` every render, P5's `accessor`).
  - The provider's Mount listens for `pointermove` on the document. Once armed, it offers one `Swapped` Message into its Stream's queue (`Queue.offerUnsafe`), and `update` swaps a and b.
  - **The input is real:** in Chromium, CDP `Input.dispatchMouseEvent` (`mouseMoved`) on the page's CDP session; in Firefox, Playwright's `mouse.move`. Four moves, 20 ms apart.
- **d, the Solid reference:** b's two clicks in `@wardic/solid` (Solid 1, from source): a `wardic.div` with `layout`, `layoutDependency` the position, the same tween. The click handler sets a signal.
- **Runs:** 5 per case, mode and browser, plus 3 traced per case and mode in Chromium (130 runs).

**Held frames,** from the paint markers (frame N = the patch's, or for Solid the first frame after the click; "held" = frames painted after the input before the first moved one):

| Case | Chromium, cold | Chromium, warm | Firefox, cold | Firefox, warm | Held |
|---|---|---|---|---|---|
| a, Retarget from rest (x) | origin at N, first step N+1: 8/8 | 8/8 | 4/5; 1 late read | 5/5 | **1** |
| a, Retarget from rest (opacity) | 8/8 | 8/8 | 3/5; 2 late reads | 5/5 | **1** |
| a, Retarget of a running leg | N: the old leg's step; N+1: the new leg's first: 8/8 | 8/8 | 5/5 | 5/5 | **1** for the new target, no stall |
| b, layout move (P1's) | origin at N, first step N+1: 8/8 | 8/8 | 4/5; 1 late read | 5/5 | **1** |
| b, a move interrupted mid-flight | N: the old flight's step; N+1: the new flight's first: 8/8 | 8/8 | 5/5 | 5/5 | **1** for the new target, no stall |
| c, swap from `pointermove` | patch in the event's frame N, first step N+1: 8/8 | 8/8 | 5/5 | 5/5 | **1** |
| d, Solid layout move | first step in N: 8/8 | 8/8 | 5/5 (3 late reads, moved either way) | 5/5 | **0** |
| d, Solid move interrupted | N: the new motion's first step: 8/8 | 8/8 | 5/5 | 5/5 | **0** |

**Drawn positions around each input,** from the markers (Chromium, run 0, warm; Firefox reads the same within 1 px):

| Case | N-2 | N-1 | N | N+1 | N+2 | N+3 |
|---|---|---|---|---|---|---|
| a, Retarget from rest, x (px) | 20 | 20 | **20** | 30 | 40 | 50 |
| a, Retarget from rest, opacity | 1 | 1 | **1** | 0.973 | 0.947 | 0.920 |
| a, Retarget of a running leg, x | 150 | 160 | **169.9** (+9.9) | 164.9 (−5.0) | 159.9 | 154.9 |
| a, Retarget of a running leg, opacity | 0.653 | 0.627 | **0.600** (−0.027) | 0.614 (+0.014) | 0.627 | 0.640 |
| b, layout move | 20 | 20 | **20** | 30 | 40 | 50 |
| b, interrupted (20 → 320, then → 620) | 150 | 160 | **170** (+10) | 185 (+15) | 200 (+15) | 214.9 |
| c, swap (a's top) | 50 | 50 | **50** | 51.6 | 53.2 | 54.8 |
| d, Solid layout move | 20 | 20 | **30** | 40 | 49.9 | 60 |
| d, Solid interrupted | 159.9 | 169.9 | **185** (+15) | 199.9 | 214.9 | 229.9 |

- **Interruptions don't stall or jump.** Frame N shows the old motion advanced by N's own tick (the tick runs before Foldkit's callback, P1). The new motion starts from there at N+1, at its own rate: 15 px a frame for b's 440 px in 0.5 s; −5 px a frame for a's way back.
- **Drawn frames agree** (Chromium screenshots, `check-p20-shots.mjs`). E.g. b interrupted, cold, run 1: 160.6, 170.3, 179.9, then 194.4, 208.8 px. The origin, then steps, with no jump, no repeat and no gap, in every traced run.

**ms from the input to the first moved paint marker** (median and range of 5 runs; for c, from the listener):

| Case | Chromium, cold | Chromium, warm | Firefox, cold | Firefox, warm |
|---|---|---|---|---|
| a, Retarget (x) | 7.6 (6.3–12.1) | 23.4 (19.5–25.5) | 8 (6–14) | 29 (21–30) |
| a, Retarget (opacity) | 11.2 (6.3–13.7) | 21.2 (17.4–29.9) | 11 (3–19) | 26 (18–34) |
| b, layout move | 10.1 (6.9–18.3) | 24.2 (18.4–31.5) | 10 (3–14) | 32 (31–33) |
| c, swap from `pointermove` | 11.3 (4.7–16.0) | 17.2 (17.1–18.0) | 18 (17–19) | 18 (16–18) |
| **d, Solid layout move** | **6.6 (4.2–7.1)** | **10.0 (3.7–13.0)** | **3 (2–6)** | **11 (5–17)** |

- **Warm, the held frame costs a whole frame:** 24.2 against 10.0 ms in Chromium (b against d), 32 against 11 in Firefox.
- **Cold it costs less, in Chromium** (10.1 against 6.6). Chromium runs the first frame after an idle input at once, with the last vsync's timestamp (e.g. rAF `ts` 1075.9 at `performance.now()` 1088.3), and the next at the next vsync. So the held frame N is that immediate frame, and the step waits only for the rest of the vsync, 4–6 ms here (*inferred*: Chromium's missed-BeginFrame catch-up).
- **Drawn frames,** first moved screenshot, ms after the input (traced Chromium, 3 runs each):

  | Case | Cold | Warm |
  |---|---|---|
  | a (x) | 9.4–17.7 | 24.0–50.5 |
  | b | 8.0–22.6 | 38.1–52.1 |
  | c | 8.3–22.4 | 34.4–34.6 |
  | d, Solid | 6.5–8.5 | 8.4–33.1 |

  - Chromium draws a main-thread frame either in its own vsync or one vsync later, by its scheduler's state. The warm Foldkit runs were all a vsync late (`DrawFrame` at the next `BeginMainThreadFrame`); two of the three Solid ones drew in their own vsync.
  - In the cold `a` runs, the compositor drew N+1 without ever drawing N, so no screenshot shows the origin.
  - So drawn times carry 0–17 ms of the compositor's own latency on top of the held frame. The marker counts above are the binding's.

**c, the pointer event** (traces and log; 8 Chromium runs, 5 Firefox, cold and warm alike):
- **Chromium dispatched the CDP `mouseMoved` before that frame's rAF callbacks.** The `pointermove` `EventDispatch` (1.3 ms) sits right after the frame's `BeginMainThreadFrame` (about 0.1 ms after it), before its first `FireAnimationFrame`. That's rAF-aligned input. Warm, the event waited for that frame: its `timeStamp` is 5–16 ms before the listener ran.
- **The Message's `update`** ran in the Foldkit-scheduler microtask after the listener (0.26–0.29 ms later), still before the frame's rAF callbacks. So Foldkit's `requestAnimationFrame` landed in that frame's list, and **the patch ran in the event's own frame,** about 1.2 ms after the listener.
- **So a Reorder swap holds one frame, not two:** the event's frame paints the origin, and the siblings' first step is at N+1.
- **Firefox:** the same order in all 10 runs. The listener ran in a task before the frame's first rAF callback, about 1 ms before it, and the `update` before the frame. Its `timeStamp` was 2–17 ms earlier (*inferred*: Firefox flushes coalesced mouse moves at its refresh tick, before rAF callbacks; Playwright's `mouse.move`, not native input).

**Verdict: B.3's inference holds for every start tried.**
- **One held frame,** cold and warm, in both browsers, for:
  - a Retarget delivered through the props channel in the patch, from rest or of a running leg, transform or opacity;
  - a layout move;
  - a Reorder-style swap from a pointer event.
- **0 for Solid's same click,** measured here.
- **An interruption neither stalls nor jumps:** frame N shows the old motion advanced by its tick, and the new one starts from there at N+1.
- **In ms,** warm, the held frame is one whole frame (about 14–21 ms more than Solid's first moved paint). Cold in Chromium it's 3–4 ms more, since the patch frame runs at once.
- **Confidence:** high (130 runs; markers in both browsers, drawn frames and traces in Chromium). Firefox's input is Playwright's synthesized one, not native.

## P21, the Blocks and Layers preview on its canary

**The question:** [`foldkit-blocks-preview.md`](foldkit-blocks-preview.md) read the preview's Mount rules from source (its Summary 1–4). Run here: does a raw Mount work in a child Block and see the app's services, when is the Layer built, what does a kept element's restart look like, and do the registration checks accept a fused `OnMount`?

**Setup** (`probes-preview:p21.html`, `src/p21.ts`, `show.mjs`; `probes-preview:` = `.tmp/561-foldkit/probes-preview/`):
- **Packages:** `foldkit@0.170.0-canary.54f8bcd443b4` (the snapshot's canary, `npm view foldkit versions`) and `@effect/platform-browser@4.1.1`, installed with `--omit=peer --legacy-peer-deps`, so `effect` is the repo's one 4.1.1 copy. 0.170.0's `probes:` is untouched. Vite on 127.0.0.1:5197, no pre-bundling, as `probes:vite.config.ts`. No Wardic: a stand-in service.
- **The app** is the preview's own `fkp:src/test/apps/keyedMountOwner.ts` shape: a root Block with a keyed array of two Surface Blocks, `first` and `second`. The root embeds the selected one in one slot (`embedView({ key, slotId })`), so a click on `second` retires `first`'s occurrence there and renders `second`'s on the same `div`.
- **The service:** a `Context.Service` (`ProbeService`), its Layer an `acquireRelease` that logs its build, given with `Runtime.run(program.provide(layer))` (`Program.makeElement`; `Program.make` wants a Document view).
- **The Surface's `div` has one `OnMount`,** by case:
  - `raw`: `{ name, f }`, `R = never`. Its fiber reads `ProbeService` with `Effect.serviceOption`, then holds an `acquireRelease`.
  - `user`: a user's Layer-backed Mount (`SurfaceBlock.makeMountStream`, in the Surface Composition's `mounts`), the control.
  - `fused`: `{ ...user({ label }), f }`. The spread keeps the user action's symbol keys (registration, invocation identity and name); `f` is `Stream.merge` of the user's stream and the raw one.
  - `fused-bare`: `{ name, f }`, the same `f`, no symbol keys.
  - `stray`: a Layer-backed Mount of the Surface's that its Composition doesn't register (the checks' control).
- **The root's `div`** has a raw Mount too.
- **Runs:** 5 cases × 3 runs, Chromium only (`probes:run-p20.mjs p21 --port 5197`). Each case's 3 logs are identical in order. The dev server's Foldkit plugin wait (P14) is live: the app starts about 500 ms after load.

**Results** (run 0; the others alike):

| Case | Checks | First render | The click: `first` retires, `second` renders on the same `div` |
|---|---|---|---|
| raw | nothing thrown | Layer built, views 4.3 ms later, Mount acquired 6.6 ms after the build, in the render's own task; **`serviceOption` finds the service** | `release raw:first`, then `acquire raw:second`, both inside Foldkit's rAF render callback; same element, connected throughout |
| user | nothing thrown | the same order | the same: release, then acquire, in the callback |
| fused | **nothing thrown** | both parts acquired one Foldkit-scheduler microtask after the render (`Stream.merge` forks them) | both released in the callback (raw first), both re-acquired in the next scheduler microtask; same element |
| fused-bare | nothing thrown; the user's handler still runs | as fused | as fused |
| stray | **check 1 throws** at `h.OnMount`: "Mount "P21Surface/Stray" is not registered in this view's Mounts." The app crashes and nothing renders. | – | – |

**1. A raw Mount in a child Block: it runs and sees the root's services.** No check fires with no registration: check 1 needs an owner and check 3 a registration (`fkp:src/html/index.ts:5676-5700`, `fkp:src/runtime/renderer.ts:418-425`). The preview note's Summary 1 and 2 hold as run.

**2. The Layer is built before the first render,** in the same start: about 4 ms before the first view call and 7 ms before the first Mount. So the first Mount already sees the service.
- **Hydration wasn't run.** It needs a server render of a Block app on the canary. P14's `ssr.mts` is 0.170's `Runtime`, so that's a new server entry and build, not cheap. The preview note's order for hydration (handoff validated, then services, then the root graph) stays *inferred*.

**3. The restart on a kept element is a release, then an acquire, on the same connected element, inside the patch** (3/3 per case).
- It's the `postpatch` hook (`fkp:src/html/index.ts:2656-2667`): the new vnode's Mount belongs to another occurrence (`state.instance !== instance`), so it releases the old state and acquires again, after interrupting the old fiber.
- **What the binding sees:** Wardic's unregister and register of one element, painted mid-animation, in one patch. A register that treats it as a fresh mount would replay `initial` (its Starting style) on an element already showing its state. So the binding has to tell a restart from a mount. Not fixed here.
- *Inferred* from the same code: a re-render inside the same occurrence doesn't restart; only an occurrence change (or a DevTools replay owner) does.

**4. A fused `OnMount` passes every check, with or without the user's markers.**
- **With the spread,** the marker `h.OnMount` builds carries the user's registration (`fkp:src/html/index.ts:2627-2636`). The owner check finds the user's Block, and the renderer's walk finds the registration in the program's set. So the fused action needs no marker of its own: the user action's symbol keys, copied by the spread, are exactly what the checks read. A Definition's invocation is a plain object of those keys plus `f` (`fkp:src/mount/index.ts:774-797`).
- **Without them** (`fused-bare`) it passes too, as a raw Mount, and the user's handler still runs: it's rendered in the Block that provides it. What it loses is *inferred*:
  - its identity for the tracker, DevTools and Scene's `resolve` / `expectEnded`;
  - check 1's guard, so rendered in a Block that doesn't provide the handler, it would fail only when the handler lookup runs.
  - So spreading is the binding's form.
- **A cost of `Stream.merge`:** both parts start one scheduler microtask later than a single stream, after the render callback rather than inside it. *Inferred* from P1: still before the paint, but it may land after the Measure pass's microtask. So a fused `f` should run Wardic's register before forking, as a single stream does, to keep P2's "registration inside the patch".

**Verdict:** the preview note's Mount reading holds as run. A raw Mount runs in a child Block and sees `program.provide`'s services from the first Mount on. A fused action passes the checks by carrying the user's own markers. One thing changes the binding: a kept element's Mount restarts within one patch, so Wardic's register must know a restart from a mount. High confidence for the order (15 runs, identical); hydration not run.

## P17, the Foldkit `Reactivity` port

**The decision checked** (R6 Q23): Foldkit has no reactive graph, so the binding fills `wardic:packages/solid/src/reactivity.ts` with:
- accessors as getters over the latest config delivered to the element;
- `watch` re-reading after each delivery and each `notify`, `onChange` on `!Equal.equals(before, now)`;
- `untrack` a plain call;
- `trigger` as `{ track: constVoid, notify }`.

**Setup** (`probes:p17/p17.ts`, `p17/table.mjs`; Bun 1.3.13, `bun --conditions=@wardic/source --conditions=browser p17/p17.ts`, no browser):
- **No test builds these modules on a bare `Reactivity`,** so a scripted sequence is run through four ports and compared:
  - `solid`: Solid 1's own (`wardic:packages/solid/src/solid-reactivity.ts`), each element's config a signal, a render one `batch`;
  - `fk-delivery`: the decision as written, with one registry of watches re-read after each delivery anywhere;
  - `fk-patch`: the same, re-read once after the patch's last delivery;
  - `fk-own`: re-read only the delivered element's own watches (all on `notify`).
- **A delivery is Foldkit's** (P6): one per element whose config is a fresh reference, in document order, the parent's first; a same-reference config gets none.
- **The tree:** a parent with variants and four Variant children, C0–C3. C1's config is one hoisted object, so it gets no delivery after mount.
  - The parent's accessors mirror `wardic:packages/solid/src/variant-node.ts`'s, built from `variant-tree.ts`'s `handedDown`, `nameOf`, `staggerOf` and `triggerKeyOf`. For Solid they're its memos (variant with `sameLabels`, stagger with `sameStagger`, the trigger memo marking slots stale), with `when` and `childrenMayStart` plain functions over them. For Foldkit they're getters, plus one parent watch on the trigger key that marks the slots stale.
  - Each child watches its variant name (as `spine.ts` reads it), logging its slot's index and total when it fires (`extraDelay` reads them at the Retarget). To compare the accessors themselves, it also watches `when`, `childrenMayStart`, `stagger`, index and total, which the binding polls.
  - C0 also runs the real `createLiveStyle` (`live-style.ts`) with an accessor-valued `x`, and the real `followTemplate` (`spine.ts:3367`) for a `transformTemplate`.
- **14 renders** (s0–s13), each case below. The parent's own settle is a `notify`.
- **3 runs:** the four ports' event lists are identical across runs.

| Case (render) | Solid 1 | `fk-delivery` (the decision) | `fk-patch` | `fk-own` |
|---|---|---|---|---|
| A name change reaches the children (s1, s6, s8) | each child once, with its slot (s6: `hidden@3/4` for C3, mounted at s5) | the same values and slots | the same | **C1 never** (no delivery) |
| A stagger child's index or total (C3 mounts at s5; the trigger at s6) | the slot is plain state behind `fresh()`, so a watch never fires; read at the change: `@i/4` | read at the change: the same `@i/4`; as a watch, `total` fires 4 after s6 | the same | C1 never |
| `when: "beforeChildren"` (s7), then the parent settles (`notify`) | `when` fires; `childrenMayStart` false, then true | the same | the same | C1 neither |
| Name change, same `when` (s8) | `when` and `childrenMayStart` fire, with equal values | nothing | nothing | nothing |
| A live-style accessor key, x 0 → 50 (s9), then 50 → 50 (s10) | `50`, then nothing | the same | the same | the same |
| An equal list rebuilt (s4), an equal re-render (s2) | fires for C0 and C2, whose configs were rebuilt (equal values) | nothing | nothing | nothing |
| A fresh function each render: style `x` and `transformTemplate` (s11, s12) | both fire every render | the same | the same | the same |
| One patch: the parent to `wide`, and C2 gets its own `animate: "visible"`, its current name (s13) | C2 fires `visible` once (an equal value) | **C2 fires `wide`, then `visible`**: an intermediate, read after the parent's delivery and before C2's | nothing | nothing |
| Events in all | 135 | 51 | 49 | 41 |

**Mismatches with Solid:**
- **Fewer firings, never a missed change** (`fk-patch`, `fk-delivery`). Solid's `watch` (`on`) fires when a tracked source changes, even to an equal value. The port fires only when the value changes by `Equal.equals`.
  - Wardic's consumers already guard: `followTemplate` checks `next === last`; live-style's `change` is a Retarget to a value, and a key at its target makes no Leg (#448).
  - On every real change, the values and the slots read match Solid's.
- **Fresh functions fire every render,** by reference, in every port. A Foldkit view's inline `transformTemplate` redraws each render.
  - The style key's firing isn't the port's: live-style's own `reconcile` compares a key's source with `===` (`live-style.ts:319`) and re-watches.
  - Solid fires here too only because the probe rebuilt the style. A Solid app's JSX keeps the same function.
- **Re-reading after each delivery glitches** (s13). A child's watch reads the parent's new name with its own old config, so it fires an intermediate Retarget, `wide`, then `visible`. Solid's batch and `fk-patch` fire none.
- **Each element's own watches aren't enough** (`fk-own`). A child whose config is the same reference gets no delivery (P6), so it never hears its parent's name, stagger or `when`. The registry has to be global.
- **The slot stays a snapshot at the trigger** only if the parent's trigger watch is re-read before its children's. Registration order gives that here, as the parent mounts first.
- **Effect's `Equal` caches its answer per object pair** (`fx:src/Equal.ts:208-222`): `Equal.equals(a, b)` is still `true` after `b.x = 2`. It's harmless for immutable configs (Foldkit's Model is), but wrong for a config mutated in place.

**Cost:**
- **Watches per element:**
  - this probe's: 6 per child, 7 for C0, 1 for the parent;
  - through the port in the real modules: one per accessor-valued routed style key (`live-style.ts:280`), plus one for a `transformTemplate` at mount (`spine.ts:3367`);
  - the rest of Solid 1's per-element graph (`variant-node.ts`'s 8 memos and an effect for an element with variants of its own; `create-ward.tsx`'s ~30 computations) isn't behind the port. A Foldkit binding writes it as getters, with a watch where something must react (*inferred*: the target and the trigger key).
- **`Equal.equals` calls,** 30 watches, 13 renders and a notify:
  - `fk-delivery`: 1,206. That's one per watch per delivery, so a patch costs watches × deliveries, quadratic in elements.
  - `fk-patch`: 354, one per watch per patch.
- **Time of one re-read** of n elements × 3 watches (a name string, a function, a fresh equal `staggerOf` object), Bun on this box, 50 reps × 3 runs:
  - n = 100: 0.09–0.15 ms median;
  - n = 1,000: 0.48–0.60 ms median, 0.66–1.11 ms p90.
  - Once per patch that's under ADR-0027's budget. After each of 1,000 deliveries, it's about 500 ms.

**Verdict: the port works, with one change: re-read once per patch, globally, not after each delivery.**
- With that, every real change reaches the right watch with Solid's values, nothing fires an intermediate, and nothing fires for an equal re-render. The one extra firing is a fresh function, by reference.
- Where to re-read is *inferred*: a microtask queued by the patch's first delivery runs after Foldkit's rAF callback, before the paint (P1), plus at each `notify`.
- High confidence for the semantics (deterministic, 3 identical runs); the timings are Bun's, not a browser's.

## P22, Solid 1's presence with several leavers

**The question:** P19 found that Foldkit moves its nodes around older leavers, and that Solid's controller re-places only the change's own leavers (`wardic:packages/solid/src/presence-controller.ts:1361-1362`, `backPlaceOf`, `orderOf`). Does Solid 1's own reconcile do the same, so a leaver drifts from Motion's order?

**Setup** (`probes:p22.html`, `src/p22.tsx`, `analyze-p22.mjs`; P20 d's server, `vite.solid.config.ts` on 127.0.0.1:5198):
- `@wardic/solid` (Solid 1.9.18) from source. An `AnimatePresence` over a keyed `<For>` of `wardic.div`s, each with a 0.4 s linear exit to opacity 0.
- `main`: a b c d e. Remove b and d (t = 700); reverse the rest, both still exiting (t = 800); insert x at index 1 (t = 900).
- `min`: a b c. Remove b; reverse the rest.
- **Logged:** the DOM order a task after each step and at every paint marker. It's compared with `orderOf` (copied from `presence-controller.ts:372-383`) applied to the order expected before.
- **Runs:** 3 per sequence, Chromium.

| Step (`main`) | DOM, leavers `*` | `orderOf` (Motion's) | |
|---|---|---|---|
| remove b, d | a b\* c d\* e | a b\* c d\* e | match |
| reverse | **e b\* c d\* a** | e c a d\* b\* | drift |
| insert x | **e x b\* c d\* a** | e x c a d\* b\* | drift |
| the exits end (~390 ms after the removal) | e x c a | e x c a | match |

| Step (`min`) | DOM | `orderOf` | |
|---|---|---|---|
| remove b | a b\* c | a b\* c | match |
| reverse | **c b\* a** | c a b\* | drift |

**3/3 runs of each,** identical: every paint marker from the reverse to the exits' end draws the drifted order.

**Why:**
- **Solid's `reconcileArrays` moves its nodes around the leavers.** For `[a, c] → [c, a]` it takes the swap path (`solid-js@1.9.18/web/dist/web.js:161-164`), inserting `c` before `a.nextSibling`, which is the leaver `b`, and `a` at the end. The leaver stays where it was, now between the moved nodes. The reverse in `main` takes the same path.
- **The controller moves nothing at the reverse.** It re-places only the leavers of the change (`gone`), and the reverse has none.
- Motion's AnimatePresence recomputes every exiting child's place at each render, so it draws `c a b*`.

**Verdict: a real Solid 1 bug, and it needs only one leaver.** A reorder while a child exits leaves that child between the moved nodes, not at Motion's place, until its exit ends.
- **The smallest reproduction:** `[a, b, c]` to `[a, c]`, then to `[c, a]` within the exit. The DOM is `c b a`, where Motion draws `c a b`.
- **The fix is *inferred*:** P19's (re-place every leaver after every change, in the order's order) applied to Solid's controller. Not filed.
- Solid 2's binding wasn't run.

## The note's *inferred* claims, settled

**Confirmed:**
- **Summary 3, A.12 ("the Measure pass … same frame"):** a trigger fired in the patch runs its pass after the patch, before paint, in the same frame (P1, P2).
- **Summary 5, B.3:** one held frame, warm and cold (P1).
- **A.6:** a sync release finishes in `destroy`, before the removal (P4).
- **A.7, D.6 B:** a re-inserted leaver survives later patches, and inserts place known nodes right (P8). The reorder caveat is below.
- **A.10:** Mounts start on a hydrated page, after adoption (P14).
- **A.5 / D.2:** the style module never rewrites a key whose view value is unchanged, so Wardic's drawn values stay (P14's re-render).
- **A.12, the `viewTransition` row,** and **B.1's `viewTransition` variant:** the update callback carries the patch and the pass, and the new snapshot holds the origin projection, for plain `layout` too (P10).
- **B.1 step 3:** a Command starts in the click task's microtask, before the patch, and sees the pre-patch DOM (P1).
- **B.1 step 4:** a ticking Clock's callback runs before Foldkit's in the frame (P1 warm).
- **B.1 step 5, B.2:** code after `afterCommit` runs inside the rAF callback, after the patch and the drain (P3).
- **B.1 step 6:** a tick-emitted Message's `update` runs in the following microtask, its render at N+1 (P7). A `MutationObserver` callback lands in the checkpoint before paint (P4, P8).
- **B.2's Command route:** it animates from the refreshed boxes (P5).
- **B.2's props write:** a fresh Prop on a root element calls the accessor at the start of the patch, before any descendant (P6), but not through `h.Prop` (below).
- **C2:** a Command's `Effect.provide` reuses `resources`' Layer; a Mount's builds afresh (P9).
- **C6 / Q3 / P9:** Foldkit's microtask scheduler reaches Wardic's forks from a Mount and from `resources` (P9).
- **Q12:** the client's first paint is right, the Starting style rendered by `h.Style` at `create`, before any frame (P2, P14). Inheritance by DOM ancestry wasn't probed.
- **B.3, "A Retarget made in the patch, through the props channel … is drawn at N+1":** confirmed, from rest and mid-flight, transform and opacity (P20 a). So is B.3's one held frame for an interrupted layout move and a pointer-driven swap (P20 b, c).
- **D.6 B / R5 Q17:** a presence that re-places its leavers after each patch never fights Foldkit's next patch (P19), with the changes below.
- **B.1 step 6:** a `MutationObserver` on the provider is delivered in the patch's checkpoint, and the pass it triggers still runs before paint (P13).

**Overturned or corrected:**
- **`h.Prop`** (Summary 6 and 11, B.2, D.2 A, Q11): not on the public builder. Use a CustomElement spec's property factory (P6), or ask Foldkit to export `Prop`.
- **B.3, "A Foldkit patch is always inside a rAF callback"**, A.12's last rows: true only of renders an update schedules.
  - The init render runs in the boot fiber's task: in dev after the plugin wait (P0, P9, P14); in production `Runtime.hydrate` ran it synchronously in its own call (P14). `Runtime.run` shares that start path (`fk:src/runtime/start.ts:86-104`), so it should too (*inferred*: production `run` wasn't built).
  - A DevTools replay renders synchronously in `jumpTo`'s task (P6).
  - Such a render's layout change is ADR-0018's ordinary-task case.
- **B.1 step 6, for Messages emitted during the patch:** their `update` runs inside Foldkit's rAF callback (the drain), not in the microtask checkpoint (P3, P2 b). Only emissions from outside a render frame (Wardic's tick) take the microtask.
- **P4's expectation, "an `Effect.sleep(0)` release runs after removal":** after the removal, yes, but in the same frame's checkpoint, before paint, since sleep(0) resumes on the Foldkit scheduler (P4).
- **P8's expectation, "a keyed reorder leaves it where the controller put it":** the leaver isn't moved, but its neighbours are, so it ends first (P8).
- **D.7 C / Q14:** "C only if P5 shows the retained box is wrong there". P5 shows it is wrong, after any change no trigger sees, and that the Command route is right.
- **D.7 B's "6–10 ms at 1,000 nodes by ADR-0018"** for a pass every render: on this box it's 3.4–3.9 ms in Chromium and 6.5–8.0 ms in Firefox (P13). ADR-0018's host was older, so its range isn't wrong, only not this box's.
- **The fix as stated for R5 Q17, "re-placed by `orderOf`" with Solid's `backPlaceOf`:** placing each leaver by its nearest neighbour on the page misplaces the list when that neighbour is another leaver not yet placed (P19 fuzz, 8 of 667). Leavers from earlier changes need re-placing too, which Solid's controller never does.

**New, not in the note:**
- **An `OnMount` added to a kept DOM node never runs** (P2 c).
- **Dropping an object-valued Prop calls nothing** (P6).
- **Foldkit's dev-only 500 ms boot wait** without `@foldkit/vite-plugin` (P14).
- **Wardic:** in P14 the gate's first flush replaced the Starting style's `transform` one callback before the tick's first step. It was never painted there, but the binding must seed the gate with the Starting style's keys (P14).
- **A pass that finds nothing moved still reads every box and writes every transform twice** (P13, from `projection.ts:3693-4152`), so a trigger per patch costs the full pass on the most common render.
- **A presence needs each child's key in the DOM,** and a take-over when a key re-enters during its exit: Foldkit creates a fresh element and leaves the leaver beside it until the observer's delivery (P19).
- **`orderOf` differs from its own comment under a reorder with several leavers,** as Motion 14.9's `AnimatePresence` does (P19).
- **Chromium's first frame after an idle input runs at once** with the last vsync's timestamp, so the held frame costs the rest of a vsync cold (4–6 ms here) and a whole frame warm (P20, *inferred* mechanism).
- **Chromium dispatches a CDP `mouseMoved` at the start of the frame, before rAF callbacks** (rAF-aligned input), so a Message from a pointer listener patches in that same frame (P20 c).

## Not run

- **P11** (deferred drain) and **P12** (teardown order): outside these briefs. A.3's teardown inference, A.2's frozen-Model inference and B.2's idle `afterCommit` loop are still open.
- **P13's pre-patch tree-wide Measurement** (D.7 C, B.4's "with a pre-patch tree-wide Measurement and without"): not timed. P5 timed the Command route's correctness, not its cost.
- **P13 with a page of other content,** nested layout nodes, scroll containers, or nodes mid-animation at the render: the list is flat, in the document's scroll, at rest. Each of those adds reads to a pass (ancestor transforms, folds), so P13's pass is a floor.
- **The animation frames after a `cg` render** cost Wardic less than `cr`'s (0.15 against 0.94 ms a tick at N = 1,000, Chromium) with as many nodes animating. Seen, not analysed.
- **P19 with Wardic's real presence:** the probe's controller is its own, with WAAPI exits and opacity-only take-overs. `popLayout`, `wait`, a layout take-over (`enteredFrom`) and Motion's "remove every leaver at once" weren't tried.
- **Firefox drawn frames:** Playwright's Firefox has no tracing, so Firefox's visual claims rest on paint markers, late ones flagged.
- **Real input:** clicks are synthetic `element.click()` in timer tasks. Only P20 c sends input: CDP mouse moves in Chromium, Playwright's synthesized ones in Firefox. Touch, pointer capture and ADR-0032's hops aren't covered.
- **Production builds** were made for P14 and P13 only. P1–P10, P19 and P20 ran on the dev server, where Foldkit's dev paths (Model freezing, DevTools, the plugin wait at boot) are live; none sits in their measured frames.
- **WebKit / Safari,** high-refresh displays and a DevTools `Paused` Mount weren't tried.
- **P21's hydration** (the canary's Layer build against hydration's first Mounts): it needs a server render of a Block app on the canary, and P14's `ssr.mts` is 0.170's. Firefox, Wardic's real Layer, and a fused Mount rendered in a Block that doesn't provide its handler weren't tried either; #1922's frame arming isn't in the snapshot.
- **P17 in a browser,** and with Foldkit's real deliveries: the port ran in Bun against a scripted delivery order, so the re-read's place (a microtask after the patch) is *inferred*. Its timings are JavaScriptCore's.
- **P22 in Solid 2, and in Firefox:** only Solid 1's binding, in Chromium. `popLayout` and `wait` weren't tried.
