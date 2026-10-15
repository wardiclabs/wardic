# Interactive features split: recognition in core, response in binding

Gestures and layout animations are split along a single seam: **recognition** — interpreting environment input/geometry into a portable signal — lives in `@wardic/core`; **response** — naming states, propagating them through a component tree, timing them against a render lifecycle, and rendering JSX — lives in the framework binding. Concretely, core ships the gesture **Recognizers** (`hover`, `press`, `drag`, `inView`, `focus`) as Stream combinators over `InputSource` (and `Probe` for `inView`; recognizers need no `Clock` — that enters only at the `decay`-based Fling fusion), the pure layout combinator `flip(from: Bounds, to: Bounds)` (the FLIP Invert→Play math), and the pure `resolveOverrides` merge that resolves an Override stack to a target. The binding maps real events into `InputSource`, decides *when* to measure for FLIP, matches `layoutId`s, owns the named gesture priority order and variant names, and renders. This reverses the original plan (`docs/plans/v0.1.md`), which placed `createDrag`, `createHover`, `createLayout`, `<LayoutGroup>`, and `<AnimatePresence>` entirely in `@wardic/solid` — the services existed as portability hooks but no portable logic sat on them.

A second, sharper consequence of the seam: **composing a Recognizer with a Primitive is core, not binding.** A drag-release **Fling** — the `drag` sample stream switching into a `decay` seeded from the release velocity — is shipped as a core fusion combinator, so a binding-less environment (terminal, canvas) gets momentum without a framework. This revises the line in ADR-0001 / `CONTEXT.md` that "interruption (Retarget) is the binding's responsibility": that remains true for the *cached-Snapshot Retarget a framework performs*, but pure stream composition is not exclusively a binding act. "Response = binding" means variant-naming, tree propagation, lifecycle timing, and JSX — not all value flow.

## Considered Options

- **Thin core, fat binding (the original plan).** All gesture state machines and FLIP math reimplemented per binding. Rejected: every new environment (react, native, terminal, canvas) re-pays the cost and the behaviours drift; binding-less environments get nothing. The `InputSource`/`Probe` comments already declared the intent that "the engine's gesture logic stays portable" — the plan's placement contradicted it.
- **Fat core.** Core additionally owns the named priority stack (`hover<tap<drag<…`) and variant-tree orchestration. Rejected: it bakes one opinionated interaction vocabulary and a component-model (variant trees, mount/unmount lifecycle) into an engine that has no framework, coupling core to assumptions it cannot honour.

## Consequences

- Core gains an event-driven producer category distinct from clock-driven Primitives: a **Recognizer** emits neither ticks nor a settling `Frame`. State recognizers emit `Stream<boolean>`; Sample recognizers (`drag`/`pan`) emit samples carrying `velocity`. The `Frame` contract is untouched.
- `InputSource` gains a focus/blur event stream so `focus` is fully portable; every Environment Layer (DOM, Test, future native/terminal) must implement it.
- `drag`'s dependency surface is honest and minimal: base `drag` needs only `InputSource` — velocity is a time-windowed estimate from pointer-event `timeStamp`s, so no `Clock`. Shaping is pure and **Probe-free**: `axisLock` and numeric `withinBounds` (with `elastic` as an *option* of `withinBounds`, not a standalone combinator) are stateless `Stream.map`s. Element-relative drag constraints are **not** in core — resolving a container/element ref to a numeric range needs the dragged element's geometry + start + measurement timing, which are binding concerns exactly like FLIP, so the binding resolves them and pipes through core's numeric `withinBounds`. The `withMomentum`/`draggable` Fling convenience composes `drag` + shaping + `decay`, so its superset is `InputSource | Clock` (the `Clock` comes from the decay tail) — `Probe` never enters core drag shaping. *(Refines the original "base drag = InputSource | Clock / element-bounds adds Probe" framing as implementation made the geometry dependencies concrete.)*
- FLIP is inherently post-mount (measurement is a render-lifecycle act, and a position-only move is invisible to `Probe.observeResize`), so it cannot be SSR'd and the first frame may flash — consistent with ADR-0003.
- A new geometry term, **Measurement**, is introduced to avoid colliding with **Snapshot** (a cached motion Frame); and **Override stack** is named deliberately to avoid reusing **Layer** (Effect's service type / the building block of an Environment).
- Scroll is deferred: its `Probe` contract shape (offset vs container/page progress vs velocity) is unsettled, and committing the contract before designing the scroll-linked model is the cost this seam otherwise avoids.
- *Note (#2, 2026-09-28):* the binding still decides **what** triggers a layout measure (`layoutDependency`, which it reports through `notify`); the projection engine now decides **when** a triggered measure runs: in one Measure pass at the end of the task (ADR-0018).
- *Note (#31, 2026-09-29):* A gesture keeps its pointer: `InputSource.pointer(target)` delivers a **Held pointer**'s events wherever they land (the Environment, through core's `heldPointerSource`); `PointerLikeEvent` gains `pointerType`, `button` and `isPrimary`; and the recognizers share one piece of state, **Drag activity** (ADR-0019).
- *Note (Reorder, 2026-09-30):* Reordering is recognition too. Core decides when a drag has passed a neighbour and what the new order is: `makeReorderGroup`, with Motion's Crossover, axis detection, a 100 ms drag direction and the auto-scroll math. The binding owns `values` / `onReorder`, the elements and JSX (ADR-0020). A scroll during a held pointer reaches the gesture as a move (ADR-0019, *Amendment (Reorder)*).
- *Note (#29, 2026-10-12):* Claiming a gesture between nested draggables is recognition too: `Recognizer.drag` takes its target's **Drag claim** on its axes at its start, through the Drag activity. `axisLock` is gone: `Recognizer.drag(target, { axis })` keeps a drag to its axis and claims it, so the two can't disagree. `withinBounds` stays the numeric shaping (ADR-0019, *Amendment (#29)*).
- *Note (#43, 2026-10-15):* A **Keyboard reorder**'s keys are recognized in core too: `InputSource.keyboard(target)` delivers the keys at an element, and core's `Reorder` decides what each does and where the lifted item goes. The binding's response is the Reorder controller's, and core's `Announcer` contract carries its announcements to the Environment (ADR-0037).

## Amendment (#32, 2026-10-11): core ships no Fling; the drag track handles each event in place

- **`Drag.fling` goes, with no alias** (ADR-0032, decision 3). The "second, sharper consequence" above shipped the Fling as a core fusion combinator, so that a binding-less Environment would get momentum without a framework. No such Environment exists, and its only callers were its own tests. Its shape, the drag's samples merged with the grabs and `switchMap`ped into emitting inners, cost 2 dispatcher tasks per element per frame. As a `Stream` it can't be made inline without a `merge` or a `switchMap`.
- **What stands:** composing a Recognizer with a Primitive may be core; it isn't the binding's by definition. The Fling today is the binding's release, over core's `Recognizer.drag` and `Machine.decayVec`. A core Fling comes back with its first binding-less caller, as an `Effect` with a sink (ADR-0032's drag-track shape), not a `Stream`. CONTEXT.md's **Fling** says so.
- **The drag track's shape** (the response half): two consumers, the samples and the grabs, each handled in place as it arrives, with no `merge` and no `switchMap`. The release runs in a `FiberHandle` that the next sample or grab interrupts (ADR-0032, decision 2).

## Amendment (#139, 2026-10-13): a drag's velocity is the pointer's over its last 100 ms

Re-measured on main `3154f2e` against framer-motion 13.4.0 (`.tmp/vel/`; a free `drag` box with each library's default momentum; real Playwright input, Chromium 147 and Firefox 148, 3 runs each; touch through CDP, Chromium only):

- `drag`'s velocity was the pointer's over a trailing 30 ms window, with the release point counted. Headless, the moves arrived about 33 ms apart, and the up about 17 ms after the last move, at the same point. So the window held only those two and read 0: **a free drag never flung.** That held for a flick, a release a frame late, moves 40 ms apart, and touch. Motion read 594–792 px/s for the flick.
- After a 150 ms pause before the release, Motion reads 0. `PanSession` samples its history once a frame, so the frames the pointer stood still count.

Grilled on 2026-10-13:

1. **`drag`'s velocity is Motion's `getVelocity` over the gesture's last 100 ms** (`Velocity.trailing`) (Q1).
   - The `"end"` sample counts the release point as its last point. A pause before letting go therefore weakens the throw, down to none, as ADR-0016's *Amendment (velocity family)* kept for a layout release, and as Motion's per-frame history does.
   - A cancel still reads the moves only, since its coordinates aren't the pointer's. A Stale gesture's end still carries no velocity.
   - The history keeps the press point, the newest point older than the window, and every point inside it. So it reads what the whole gesture's history would, Motion's skip of a stale press point included.
   - Rejected:
     - the moves only: it reads the pointer's own speed, but flings at full speed after a pause, which Motion doesn't;
     - Motion's per-frame history: it would put a `Clock` into `drag`, which otherwise needs none.
2. **Every sample carries it** (Q2), as Motion's `onDrag`/`onPan` `info.velocity` is the same reading on every frame. A `createDrag` reader no longer sees 0 mid-gesture between moves more than 30 ms apart.
   - Rejected: the `"end"` sample only, which gives one field two meanings.
3. **It is the only drag velocity** (Q3). A layout drag's release (ADR-0016, *Amendment (velocity family)*, decision 2) and a Reorder group's direction (ADR-0020) read the sample's velocity, and their own histories go.
   - `Reorder.dragStart` no longer takes a point and a time. `Reorder.dragMove` takes the sample's velocity in place of them.
   - A layout drag past elastic `dragConstraints` now releases with the pointer's velocity, not with its slower elastic offsets'. Motion's does the same.
   - Rejected: only the layout release reading it; keeping three histories.
4. **How far a Fling carries is unchanged** (Q4). A `decayVec` with friction 3 carries about v/3; Motion's drag inertia (`power` 0.8, `timeConstant` 750) carries 0.8·v. That's the release's physics, #140's question; the side-by-side is measured there. *Since ADR-0016's Amendment (#140) a Fling is Motion's inertia on the drag transition, and respects the constraints.*
5. **The layout lab's scenario 13 gains a free-drag box** (Q5). It is recorded by the same drag recorder and judged:
   - **carries on:** a release while moving travels on in the pointer's direction;
   - **stays:** a release made still, or after a pause, stays within 0.5 px of where it was let go;
   - **rests:** the run settles.
   Scenario 13's momentum box switches it too. How far it carries isn't judged.

### Measured on this branch

- **The probe** (`.tmp/vel/`, label `f139`), release velocity in px/s:

  | Scene | Motion | main | this branch |
  |---|---|---|---|
  | flick, let go at once | 594–792 | 0 | 505–511 |
  | let go a frame later | 513–594 | 0 | 396–514 |
  | moves 40 ms apart | 396–517 | 0 | 364–366 |
  | a 150 ms pause, then let go | 0 | 0 | 0 |
  | touch | 599–686 | 0 | 514–590 |

  Motion's per-frame history reads above the pointer's own 606 px/s here.
- **The layout lab**, scripted (`.tmp/vel-lab/drive.ts`, `ONLY=s13f`, Chromium):
  - the free box's flicks (8 moves of 20 px, 35 ms apart, let go at once) read `carries on 64–87 px · let go at 287–290 px/s ✓`;
  - a 500 ms pause reads `stays: 0.00 px ✓`, and momentum off reads `stays ✓`;
  - a slow drag at 25 px/s is shown and not judged;
  - every run reads `rests: settled ✓`.

  On main's engine the flicks read `carries on 0.00 px ✗`.
- **Cost** (`.tmp/139-cost/bench.ts`: Bun, gestures of 4,000 moves through `Recognizer.drag`, the median of 31 interleaved runs). Per pointer event:
  - moves 16 ms apart: 1.60 µs on main, 1.85 µs here (+16%);
  - moves 4 ms apart: 1.53 µs on main, 1.89 µs here (+23%).

  That's about 0.3 µs per event, and a gesture delivers about one event a frame. The recognizer isn't on the per-frame path (ADR-0025: once per Clock tick, per key or per node), so it stays in combinators. The Reorder group and the layout release no longer keep a history each.

### Pinned by

- `packages/test/test/drag.test.ts`:
  - DV1: moves 40 ms apart each carry the pointer's speed;
  - DV2: the headless flick;
  - DV3: a pause weakens the throw, down to none;
  - DV4: a held press doesn't dilute a flick, Motion's stale-point skip;
  - DV5: on 60 seeded gestures, every sample reads what the whole gesture's history would.
- `packages/solid/test/fling.browser.test.tsx`, with the real mouse:
  - FL1: a flick with moves about 50 ms apart carries on;
  - FL2: a 200 ms pause stays;
  - FL3: `dragMomentum={false}` stays;
  - FL4: `dragSnapToOrigin` carries on outward first;
  - FL5: a layout drag past elastic constraints releases at the pointer's velocity: the same carry as an unconstrained one at the same offset, 1.01 against main's 0.27.
- `packages/core/test/reorder-group.test.ts` (its harness passes the velocity a drag sample would carry) and `reorder-controller.browser.test.ts` RC4 and RC5 (its synthetic samples carry their steady speed): the group reads the sample's velocity.
- `examples/layout-lab/test/drag-run.test.ts` FR1–FR8: the free box's `fling` and `rests` lines, and the slot lines that don't judge it.
- On main, DV1–DV3, DV5, FL1, FL4 and FL5 fail. DV4, FL2 and FL3 pin what main already did.
- Mutation-checked: 14 single-point mutations of the new code, each failing the test meant for it.
