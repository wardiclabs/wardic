# The flush gate takes its frames from the Environment, and lives in `@wardic/dom`

#52 found the flush gate (ADR-0006) calling `requestAnimationFrame` and `cancelAnimationFrame` itself, in the Solid binding, where only the Clock could reach the Environment's Refresh frames. The grill makes the Clock's `RefreshFrameSource` an Environment member: a core service of its own, which `ClockDomLive` provides beside the Clock it builds from it, and from which the gate requests its flushes. The gate moves to `@wardic/dom`, framework-free, with `batch` handed in by the binding. On the web nothing changes. DOM's member *is* `requestAnimationFrame`, so the gate makes the same calls in the same order, with the same frame of latency, and nothing is added per frame. The member's contract gains the two order rules the browser keeps, so ADR-0017's steady order (the gate's flush, then the Clock's tick) holds on every Environment. The seam turns #73 (a same-frame flush) and #114 (React Native's one `requestAnimationFrame`) into small changes later; it decides neither. This amends ADR-0006, ADR-0017 and ADR-0028.

## Why

- **#52's two problems:**
  - **A browser global in a binding.** `scheduleFlush` calls `requestAnimationFrame` (`packages/solid/src/gate.ts:217` at `0364cef`), and `dispose` calls `cancelAnimationFrame` (`:277`). A non-DOM Environment would need the gate on its frames, not the browser's.
  - **The gate is framework-free except for Solid's `batch()`,** like the projection coordinator, which already lives in `@wardic/dom` behind a `ProjectionSink`. A React binding would have to rewrite it.
- **Where things stood at `0364cef`:**
  - **The Environment's frames reach only the Clock.** `ClockDomLive` hands `requestAnimationFrame` / `cancelAnimationFrame` straight to `Clock.fromRefreshFrames` (`packages/dom/src/clock.ts:22-28`). The source isn't a service, so nothing else in the Environment can reach it.
  - **The gate already reads the Environment once, when it's built:** `runtime.runSync(Renderer)` (`gate.ts:145`).
  - **Solid appears in the gate twice:** the `batch` import, used in `flush` (`:209`) and `flushPass` (`:250`), and the `WardicServices` type. Its one DOM dependency is the commit sink's restore, which reads `target.style.getPropertyValue(dashCase(key))` (`inlineValueOf`, `:88`; ADR-0016 *Amendment (Reorder)*, ADR-0022).
  - **`@wardic/test`'s Clocks have no frame source:** `layer(frames)` and `pushable()` are plain `ticks` streams (`packages/test/src/clock.ts:13-20`, `:58-79`). Every gate test drives frames by stubbing the global rAF (`packages/solid/test/gate.browser.test.tsx:37-38`).
- **What a Refresh frame is on the web:** two rAF callbacks, run in the order requested. First the gate's flush, which a write requested during the last frame's tick, then the Clock's tick, which the Clock requested from inside its last callback (`docs/research/clock-and-scheduler.md`, Part I, Q1). The browser drains microtasks after each rAF callback (HTML §8.12, research note Part II), so a Measure pass queued by an effect inside the gate's `batch()` runs between the two. ADR-0018's *Consequences* depend on that.
- **Four issues build on this seam:**
  - **#73**, a flush at the end of the Frame loop's tick, "needs #52" (ADR-0027, decision 10);
  - **#114**, one `requestAnimationFrame` for the tick and the flush on React Native, filed by ADR-0030's decision 13;
  - **#79**, the gate's flush as about 80% of the loop's JS per frame;
  - **#27**, a dedupe against what the gate last applied.

## Decisions (grilled 2026-10-11 against effect 4.0.2's `dist`)

1. **The gate's frames come from the Environment's `RefreshFrameSource`.**
   - **The web is unchanged by construction.** DOM's member is `requestAnimationFrame` / `cancelAnimationFrame`, so the gate makes the same requests, in the same order, with the same microtask checkpoint between its flush and the Clock's tick, and the same frame of latency (ADR-0006).
   - **#114 becomes a change to one Environment.** React Native's member runs one platform `requestAnimationFrame` and calls every pending request from it, so the gate's flush and the Clock's tick share one task and one Fabric commit. Neither the gate nor the Clock changes. A core helper could do the fan-out for any Environment; that's #114's to decide.
   - **#73 becomes a hook on the Frame loop.** The gate flushes at the end of the loop's tick, and keeps its source request for writes made outside a tick. Where the hook lives and how the Priming tick and step change are #73's.
   - **Rejected:**
     - **A new member both draw from, with fixed steps** (Motion's batcher: one platform request per Refresh frame, the flush step before the tick step). On the web it either makes one rAF call for both, which moves every microtask between the gate's callback and the Clock's to after the tick and so changes ADR-0018's timing, or one call per step, which is this decision under another name. It would fix the order within a frame now, which is #73's and #114's to decide, and it adds a fan-out call per frame on the web. It's where #114 may end up, as one Environment's member, not everyone's contract.
     - **The Frame loop's tick:** flushing at the start of the loop's next tick keeps the latency while the loop runs, but some writes have no tick coming. The drag track writes from input with nothing on the loop (ADR-0027, decision 5). The last run's settled Frame is written in the tick that ends the burst (`takeUntil`). `release` (ADR-0022) and the Priming step write outside a tick. So the gate would either have to start the loop, a Cold start whose Priming tick would flush a drag move in its own task and change the latency, or keep its own frame request as well, which is this decision plus a second path. It also puts a binding concern into core's loop.
2. **The member is its own service, in its own core module: `@wardic/core/RefreshFrameSource`.**
   - **ADR-0028's decision 11:** module `RefreshFrameSource` holds the key `RefreshFrameSource.RefreshFrameSource`, its shape and its `layer(source)`. The shape is today's interface (`requestFrame`, `cancelFrame`, `now?`), moved out of `Clock` with no alias. The name stays because CONTEXT.md's **Refresh frame** and ADR-0017 already use it. `RefreshFrames.RefreshFrames` was shorter, but it reads like a list of frames.
   - **One handle type.** A service can't be generic, so the shape's handle is `unknown`. `cancelAnimationFrame: (handle: number) => void` isn't assignable to `(handle: unknown) => void` under strict function types, so DOM wraps `cancelFrame`, which runs only on a cancel, never per frame. `requestFrame` stays `requestAnimationFrame` itself.
   - **`Clock.layer`,** which needs the member, builds the Clock from it. `Clock.fromRefreshFrames(source)` stays, Tier 2, for a Clock over a source that isn't in the Environment (core's Clock tests, the bench harness).
   - **`ClockDomLive` provides both from one value:** `Layer<Clock | RefreshFrameSource>`. Its one `requireGlobal("ClockDomLive", "requestAnimationFrame")` stays the first step of its build, so the client-only error doesn't change (decision 5).
   - **`WardicEnv` and `WardicServices` gain the member.** That breaks custom Environments, with no alias, since core is unpublished. `ProjectionRuntime` doesn't gain it, because the projection never requests frames.
   - **`TestLive` provides a source that never calls back,** matching its Clock, which never ticks. A test fires frames through `pushable()` (decision 6).
   - **Rejected:**
     - **A field on `Clock`:** every test Clock and fake Clock would have to carry a frame source. An Environment couldn't wrap its frames (#114's fan-out) without rebuilding its Clock. And the gate would depend on the Clock for something that isn't time.
     - **A second key in the Clock module (`Clock.RefreshFrameSource`, in place):** the smallest change, but after #52 the source is the Clock's peer, not a part of it. `FrameLoop.CheckFrames` is the only second key in a module, and it's a `Reference` with a default.
     - **A separate `RefreshFrameSourceDomLive` Layer:** it changes the client-only error's Layer name, and it invites replacing one service without the other, so the Clock and the gate would end up on different frames.
3. **The gate moves to `@wardic/dom`, with `batch` from the binding.**
   - **`makeFlushGate(runtime, { batch })`,** Tier 2 and exported for binding authors, beside `makeProjectionSystem(runtime, sink, options)`. Its runtime is `ManagedRuntime<Renderer | RefreshFrameSource>`, the way `ProjectionRuntime` names what it needs.
   - **`batch`'s contract:** run `apply`, and return once every cell write inside it will reach the screen before the next paint. Solid 1's `batch` meets it.
   - **`INERT_GATE` moves with it,** since it's the server gate every binding needs (ADR-0021, decision 9). `FlushGate` and `FlushSink` move too. `ProjectionSink` stays the engine's narrower seam, because its tests use a fake sink.
   - **Solid keeps** the provider's wiring (`makeFlushGate(runtime, { batch })`) and `useWardicGate`, and re-exports the types. It drops its own `makeFlushGate` export, with no alias.
   - **Checked against a React binding:** its per-frame writes would go through commit sinks (refs and direct style writes, as Motion's do), with `batch` the identity function. If it used state sinks, `batch` would be `flushSync`, because React renders an update made in a rAF callback after the paint unless it's flushed (inferred, not measured). Either way the gate doesn't change. That's ADR-0006's own expectation: "only the cell and flush differ, not the driving model".
   - **Checked against Solid 2:** `docs/plans/upgrade-targets.md` lists the gate's `batch` as a timing guarantee to re-prove. If Solid 2 defers updates, its binding passes `(apply) => { apply(); flush() }` (inferred; Solid 2's `batch` isn't researched yet). That changes one argument, not the gate.
   - **CONTEXT.md gains Flush gate,** now that every binding shares it.
   - **Rejected:**
     - **Core:** the restore read would have to go behind the Renderer, and nothing outside the DOM calls for that ("a combinator needs a caller"). When a non-DOM Environment and a binding exist (#114's React Native), moving the gate to core is a small change: only `inlineValueOf` holds it in dom.
     - **Leave it in solid:** each binding would write its own gate. That's ADR-0004's "thin core, fat binding", which it rejected for recognition, and ADR-0010's reason to keep the crossfade registry out of the binding.
4. **The member's contract states the browser's two order rules.**
   - **The rules:** a Refresh frame's callbacks run in the order they were requested, and a callback requested while a frame's callbacks run waits for the next frame. `requestAnimationFrame` keeps both (HTML §8.12 runs a snapshot of the callback map, in order). Until now the interface said only "call back later, never inside `requestFrame`".
   - **Why they're stated:** once two callers share one source, ADR-0017's steady order ("its write requests the gate's next frame *before* the loop requests its own") stops being a browser fact and becomes something every Environment's source has to keep. Without the rules, a React Native source could run the tick before the flush, giving RN a same-frame flush while the web has a frame of latency, the drift ADR-0004 exists to prevent.
   - **Neither #73 nor #114 is decided:**
     - **#73** changes the order on purpose, at the end of the loop's tick, a seam on the loop, for every Environment at once.
     - **#114** writes a source that keeps both rules. It's left to decide whether that source runs each next callback from a microtask, so a microtask the flush queued (an effect's Measure pass, ADR-0018) still runs before the tick, as it does on the web. A plain loop over the callbacks would run that pass after the tick.
   - **ADR-0017's known edge doesn't change:** a Clock started from a rAF callback that runs before a pending gate flush still paints its first value one frame early, then repeats it once.
5. **The server and the client-only error don't change: ADR-0021 stays whole.**
   - **No gate is built on a server.** The provider's `isServer` branch hands down `INERT_GATE` and never calls `makeFlushGate` (`packages/solid/src/provider.tsx:109-121`). The gate reads the member with `runtime.runSync`, as it reads the Renderer, only on the client.
   - **`requireGlobal` still raises its error:** `ClockDomLive`'s check stays first (decision 2), so `server-guard.node.test.ts` G1's message is unchanged. The gate no longer reads a browser global, so it needs no check of its own.
   - **The client builds at the same moment.** The first `runSync` is still inside `makeFlushGate` (`provider.tsx:130`), so the timing ADR-0017 and ADR-0018 depend on is unchanged (ADR-0021, decision 3).
   - **A custom Environment without the member** doesn't type-check as a `WardicEnv`.
6. **Tests.**
   - **`TestClock.pushable()` also provides a `RefreshFrameSource`.** `advance(dt)` fires the frames requested so far, in request order, then publishes `dt`, so one `advance` is one Refresh frame in the web's order: the flush, then the tick. Its Clock stays a `PubSub`, not `fromRefreshFrames`, so no Priming tick appears and no test's frame counts move. `testLayer` and `TestLive` provide the source that never fires (decision 2).
   - **The gate's own tests move to dom's node tier** (`gate.node.test.ts`), on the pushable frames with an identity `batch`. Of the 24 in `gate.browser.test.tsx`:
     - 14 move to the node tier. The ones that need DOM's `project` run on `RendererDomLive`, which builds anywhere (ADR-0021, decision 7).
     - The 7 that commit to a real element (the commit sink, the pass's commit, GK1, GK2, GR2, GR3, GR5) move to dom's browser tier.
     - The 3 that test Solid's `batch` and effects (inside a root owner; one effect run for two entries; an effect's write during the pass's flush) stay in solid's browser tier, where they test what solid injects.
   - **A guard that keeps frame globals out of the bindings:**
     - an ESLint `no-restricted-globals` rule on `requestAnimationFrame` and `cancelAnimationFrame` in `packages/{dom,solid}/src`, with `dom/src/clock.ts` exempt, as the repo holds its per-file rules (`PER_FRAME_LOOPS`);
     - a browser test: an Environment whose source records its requests, where a gate write goes through it and the global is never called.
   - **The browser tests that count painted frames need nothing.** On `DomLive` the member is rAF, so `clock-cold-start`, `measure-pass-timing`, `frame-loop` and the drag and layout tests show the web didn't change, and they must pass untouched. The stubs of the global on `DomLive` keep working: `ClockDomLive` reads the global as it builds, and every test stubs before that.
   - **Three browser tests build their own Environment from `ClockDomLive` with `Layer.provide`,** which keeps a dependency's services private (`Layer.d.ts`, `provide` against `provideMerge`): `frame-loop.browser.test.tsx:59`, `projection-coordinator.browser.test.ts:145` and `error-reporting.browser.test.tsx:57`. Each keeps the member visible.
   - **The browser tier's microtask polyfill stays,** as it's #32's and #67's.
7. **The hot path: nothing is added per frame.**
   - **`write`** doesn't change.
   - **`scheduleFlush`** calls `requestFrame(flush)` where it called `requestAnimationFrame(flush)`, still once per frame, at the first write. The gate takes `requestFrame` out of the member once, when it's built. On DOM that's the global function itself, not a wrapper.
   - **`flush`** calls the injected `batch` where it called the imported one, still once per frame.
   - **`cancelFrame`** is wrapped on DOM (decision 2), but it runs only on `dispose`.
   - **The gate calls `requestFrame` on its own, never as `source.requestFrame(cb)`.** A browser throws "Illegal invocation" when `requestAnimationFrame` runs with `this` bound to anything but the window. The Clock already does this (`packages/core/src/Clock.ts:125-128`).
   - **Not measured in the grill.** No call is added, so a prototype measured now would measure the code each slice lands. Each slice that touches the gate runs the `.tmp/75-frames/` page probe once on the bench server as its gate (ADR-0027, *Implementation in #75*): paired against main, N = 100 and 1,000, FLIPs alone and with 2N legs, 11 reps. Each total should land within ±2% with its spread around 0, as #75's did. A total that doesn't is a finding to explain before merging.
8. **How #52 lands.** Each slice adds an *Implementation in* section here.
   - **This record first,** docs only:
     - ADR-0031;
     - an *Amendment (#52)* each to ADR-0006 (the gate is dom's, with `batch` from the binding and its frames from the Environment), ADR-0017 (the source is an Environment member, and decision 1's steady order is its contract) and ADR-0028 (decision 11's table);
     - CONTEXT.md: **Flush gate** (new), and **Environment** and **Refresh frame** with the member.
   - **#122 (slice 1), core, dom, test, solid: the Environment's `RefreshFrameSource`, and the gate's frames from it** (decisions 1, 2, 4 to 7). It needs nothing but this record.
     - core: the `RefreshFrameSource` module, with its contract's two rules, and `Clock.layer`. `Clock.RefreshFrameSource` goes.
     - dom: `ClockDomLive: Layer<Clock | RefreshFrameSource>`.
     - test: `TestLive`'s source, and `pushable()`'s.
     - solid: `WardicEnv` and `WardicServices` gain the member, and the gate, still in solid, requests its frames from it.
     - The lint rule, the recording-source test, the gate's tests on the pushable frames, and the three custom Environments.
   - **#123 (slice 2), dom, solid: the flush gate moves to `@wardic/dom`, with `batch` from the binding** (decisions 3 and 6). It's blocked by #122, whose pushable frames its node tests need. Moving first would only carry the raw rAF into dom.
     - dom: `makeFlushGate(runtime, { batch })`, `FlushGate`, `FlushSink` and `INERT_GATE`.
     - solid: the provider injects Solid's `batch`, and solid drops its `makeFlushGate` export.
     - The gate's tests split across dom's node and browser tiers and solid's (decision 6); `upgrade-targets.md`'s note on the gate's `batch`. It closes #52.
   - **Comments, not slices:** #73 (decisions 1 and 4: its hook on the loop, the source request kept as the fallback, and an order change made for every Environment), #114 (decisions 1 and 4: one source that keeps both rules, and the microtask question), #79 (decisions 3 and 6: the flush it profiles is dom's, and testable in node).

## Considered Options

- **A new member that the Clock and the gate both draw from, with fixed steps.** Rejected (decision 1): on the web it changes ADR-0018's microtask timing or collapses into this decision, it decides #73's and #114's order now, and it adds a call per frame.
- **The Frame loop's tick as the gate's frames.** Rejected (decision 1): writes outside a tick would need the gate's own request anyway, or a Cold start that changes the latency.
- **A field on `Clock`, a second key in the Clock module, or a separate DOM Layer for the source.** Rejected (decision 2).
- **The gate in core, or left in solid.** Rejected (decision 3): core has no caller outside the DOM yet, and leaving it in solid makes every binding rewrite it.
- **The source's contract without order rules.** Rejected (decision 4): each Environment could order the flush and the tick its own way.
- **`pushable()`'s Clock built with `fromRefreshFrames`,** so a test gets the real Cold start. Rejected (decision 6): a Priming tick would appear in every test on it, and frame counts would move for no gain in what the gate's tests check.
- **Measuring a prototype in the grill.** Not done (decision 7): nothing is added per frame, and each slice runs the probe on the code it lands.
- **One slice.** Rejected (decision 8): slice 1 changes a contract across four packages, and slice 2 moves code behind a new seam. Each review is about one thing.

## Consequences

- **Breaking, for Environment and binding authors:**
  - `Clock.RefreshFrameSource` moves to `RefreshFrameSource.RefreshFrameSource`, a service;
  - `WardicEnv` needs the member;
  - `ClockDomLive` provides `Clock | RefreshFrameSource`;
  - `makeFlushGate` moves to `@wardic/dom` and needs `batch`.

  Core is unpublished, so nothing is aliased.
- **The web is unchanged:** the same rAF calls in the same order, the same microtask checkpoint between the flush and the tick, and the same one frame of latency. The painted-frame tests prove it by passing untouched.
- **No binding touches a frame global.** The lint rule holds `packages/{dom,solid}/src`, with `ClockDomLive` the one place that reads `requestAnimationFrame`.
- **ADR-0017's steady order is a contract,** kept by every Environment's source, not a property of the browser.
- **#114 is one Environment's source, and #73 is a hook on the Frame loop.** Neither needs the gate's frames moved again.
- **The gate is framework-free and testable in node.** A React binding passes its `batch` and its sinks, and #27's dedupe and #79's profile work on the one gate every binding shares.
- **Core still reads no DOM:** the gate's one DOM read stays in dom, and it's the only thing between the gate and core.
