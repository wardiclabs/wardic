# #672: the lift's move plan

The spine and the Flush gate move out of `@wardic/solid` and `@wardic/dom` into core, behind ports (ADR-0069 decision 2). The Solid-free modules around them follow, placed by #561's round 6 (Q21, Q22). This is the plan, for review before any code.

**Status:** accepted in #561's round 7 (Q28–Q32, 2026-11-09). Work starts after the grill ends (Q33).

Read at `15f723d` (2026-11-09). Line counts are today's.

## What moves, by the import graph

### Placed by Q21

| Module | Lines | Goes to |
|---|---|---|
| `spine.ts` | 3,423 | core |
| `retarget-legs.ts` | 1,049 | core |
| `variant-target.ts` | 240 | core |
| `variant-tree.ts` | 638 | core |
| `presence-record.ts` | 189 | core |
| `live-style.ts` | 450 | core |
| `imperative.ts` | 793 | core |
| `reactivity.ts` (the port) | 29 | core |
| `presence-controller.ts` | 1,494 | dom |
| `drag-track.ts` | 937 | dom |
| `feature.ts` | 359 | dom |
| `gesture-features.ts` | 35 | dom |
| `config.ts` | 805 | split: generic types to core, `WardConfig` to dom |
| `runtime.ts` | 410 | split: `WardicServices` and the Runner to core; the `ManagedRuntime` provider stays |
| dom's `internal/report.ts` | 60 | core (Q22) |
| dom's `Style`, its pure half | ~190 | core |
| dom's `internal/gate.ts` | 594 | core |

### Pulled in, and not placed by Q21

The modules above import ten more solid-local modules. None of them imports Solid (grep of every file for `solid-js`, `@solidjs` and `@solid-primitives`: none).

| Module | Lines | Its DOM | Imported by | Proposed |
|---|---|---|---|---|
| `appear.ts` | 804 | `@wardic/dom/Appear`, `DomRenderer`, `DomDefaultTransition`, `DomPositionalKeys`, `OwnValues`, and through `server-interpolators.ts` `Color` and `DomInterpolators` | spine (`enterServer`, `Handoff`, `keyOf`, `MountAnimation`, `repeatsForever`, `ServerAppear`, `skippedField`, `startAtOf`), variant-tree (`AppearGroup`), runtime (`ServerAppear`) | **split**: what the spine and variant tree read goes to core as Appear's handoff port; the server sampler goes to dom |
| `server-interpolators.ts` | 33 | `Color`, `DomInterpolators` | appear | dom, with the sampler |
| `animation-controls.ts` | 206 | none (config types, spine's `Snapshot`) | spine, variant-tree, config | core |
| `frame-time.ts` | 45 | `performance.now()` | spine | core, its clock read from core's `Clock` and keyed by the Runner |
| `wardic-config-value.ts` | 150 | none | runtime, drag-track | core |
| `instant.ts` | 90 | `ProjectionSystem` | runtime | dom |
| `drag-constraints.ts` | 103 | `ProjectionSystem`, container elements | drag-track, config | dom |
| `drag-controls.ts` | 94 | none | drag-track, config | dom, beside drag-track |
| `drag-transition.ts` | 43 | `ProjectionSystem` | drag-track | dom |
| `gesture-info.ts` | 81 | DOM event types | config | dom, with `WardConfig` |
| `owner-scope.ts` | 31 | none (typed on `ManagedRuntime`) | feature | dom, retyped on the Runner and a Scope |

## The ports

### The spine's own DOM uses

From `grep` on `spine.ts`.

| Used today | Count | Becomes |
|---|---|---|
| `OwnValues.styleValueOf`, `valueLike`, `of` | 9 | **Own values** (ADR-0068) |
| `MeasuredPair.needs`, `measure` | 5 | **Measured pairs** (ADR-0068) |
| `Variables.isValue`, `values` | 4 | **Variables** (ADR-0069) |
| `Appear.release`, `matches` | 2 | **Appear's handoff** (ADR-0069) |
| `DomRenderer.TEMPLATE`, `TransformTemplate`, `heldTransformOf` | 5 | **New:** the Transform template, a member of the Renderer port |
| `Style.starting` | 1 | **New:** the server's Starting style, a member beside Appear's handoff |
| `Style.dragDefaults`, `DragDefaults`, `DRAG` | 4 | **New:** drag defaults, filled by dom's drag Feature, since only a draggable element needs them |
| `Style.Stops` | 4 | No port: a type, moving to core with the pure half of `Style` |
| `FlushGate.Shape`, `Sink` | 6 | No port: the gate moves to core |
| `Report.failure`, `debugKept` | 3 | No port: `Report` moves to core (Q22) |

### The gate's own

| Used today | Becomes |
|---|---|
| `inlineValueOf`: `style.getPropertyValue(dashCase(key))`, the element's inline value | **New:** the inline read, a member of Own values |
| `TEMPLATE_KEY` from dom's renderer | the Transform template member above |

### Subject resolution

ADR-0068 decision 3: the `nodeType` checks in `imperative.ts` and `ward.tsx` become the Environment's is-Subject check. `HTMLElement` in the moved signatures becomes a Subject.

### How the spine reaches them

**Proposed:**
- Each port is a `Context.Service` in core, filled in `DomLive` by a dom Layer, as core's Environment members are today (`Renderer`, `Probe`, `PositionalKeys`).
- The provider resolves them once, when it builds `WardicServices`. The spine then reads them as plain fields of the record it already holds.

**Why:**
- Elements never do a Context lookup, and the per-element path gains nothing but the property load, which `bench:solid` checks.
- Solid's provider and the Foldkit provider (`Layer.buildWithScope`) build the same record.

## Order

**Each commit:**
- compiles, and passes `bun run test` and `bun run test:browser`;
- leaves Solid's public API and behaviour unchanged;
- updates `eslint.config.js`'s per-file lists (`PER_FRAME_LOOPS`, `PER_FRAME_READS` and the dom lists naming `internal/gate.ts`) in the same commit that moves a listed file.

**The idea that carries the plan:** put the ports in while the spine is still in solid (PR 2). Then every later move is a plain file move whose diff is imports only.

**PR 1: the foundations.** No behaviour changes; Solid's code imports from the new places.
1. `Report` to `@wardic/core/unstable/Report`. `@wardic/dom/Report` re-exports it.
2. The pure half of dom's `Style` to core: `toValues`, `splitValues`, `valuesAt`, `keyframesOf`, `Stops`, `StopAt`, `resolveInitial`. dom's `Style` re-exports them.
3. The Runner shape and `WardicServices` to core:
   - dom's `internal/runner.ts` `Runner` becomes core's, re-exported;
   - `WardicRuntime` parameters become `Runner`. A `ManagedRuntime` meets the shape, so Solid passes its runtime unchanged.
4. The `Reactivity` port to core. Solid's two implementations stay in solid.
5. `config.ts` splits:
   - transition, variant and target types, generic over keys, to core;
   - `WardConfig`, `gesture-info.ts` and the drag types to dom.

   solid's `config.ts` re-exports both, so its public types don't change.

**PR 2: the ports, in place.**
1. Core gets the port services:
   - Own values with its inline read;
   - Measured pairs;
   - Variables;
   - Appear's handoff;
   - the server's Starting style;
   - the Transform template;
   - drag defaults;
   - subject resolution.
2. dom fills each one in `DomLive`.
3. `WardicServices` carries them.
4. The spine, the gate and `imperative.ts` switch to them, still in their old files.

After this PR, `spine.ts` imports nothing from `@wardic/dom` except `FlushGate`'s types.

**PR 3: the leaves, to core.** One commit each, imports only:
- `presence-record`, `variant-target`, `wardic-config-value`, `animation-controls` and `frame-time`;
- `retarget-legs` and `live-style`;
- `appear.ts`'s split: its handoff half to core, and its sampler with `server-interpolators` to dom;
- `variant-tree`.

**PR 4: the gate, the spine and `imperative`.**
1. The gate to `@wardic/core/unstable/FlushGate`. `@wardic/dom/FlushGate` (Tier 2, ADR-0041) re-exports it, with dom's Layer.
2. The spine to `@wardic/core/unstable/Spine`.
3. `imperative` to core.
4. The moved files' comments get rewritten without DOM names (#609 covers core's docs).

**PR 5: the DOM-bound modules, to `@wardic/dom/unstable/`:** `instant`, `drag-constraints`, `drag-controls`, `drag-transition`, `drag-track`, `presence-controller`, `feature`, `gesture-features` and `owner-scope`.

**Changesets:** the PRs change what core and dom ship (new `unstable/` modules), so each adds a changeset (CLAUDE.md, #560). The packages are a fixed group, so all four version together.

## How each step shows it's structural

| Check | Expected | Why it shows the move is structural |
|---|---|---|
| `bun run typecheck`, `bun run lint` | clean | The moved code keeps its types, and core's lint keeps DOM globals out. |
| `bun run test` and `bun run test:browser` | unchanged pass counts | The 182 files in `packages/solid/test` drive the spine through Solid. 13 of them import a moving module directly, and only their import paths change. |
| `bun run bench:solid`, paired base and head, after `wardic-quiet` | flat | Per-element mount, Retarget and unmount. The ports' property loads are the one new cost. |
| `bun run bench:core` | flat | Core's engine is untouched. The new modules aren't on its bench path. |
| `bun run size` (solid's bundle, ADR-0067) | flat, within a few hundred bytes | Code that crosses a package boundary can minify differently. Any growth is reported, not explained away. |
| `bun run pack:check` | passes | Core's `"./*": "./src/*.ts"` export already resolves `unstable/<Module>`. `./internal/*` stays `null`. |

## Not decided here

- Final module names under `unstable/` (`Spine`, `FlushGate`, `Report`, `Stops` for the pure half of `Style`, `AppearHandoff`, `AppearSampler`, and so on).
- Where the Solid tests that import a moved module directly should live once the move is done. During the move they stay in solid.

## Not checked

- `appear.ts`'s split line, export by export, is *inferred* from its imports and its callers' imports. PR 3 reads it in full.
- Whether `frame-time.ts`'s `performance.now()` can come from core's `Clock` with no change in timing.
- The cost of the ports' property loads (PR 2's `bench:solid` measures it).
