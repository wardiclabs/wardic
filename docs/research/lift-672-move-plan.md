# #672: the lift's move plan

The spine and the Flush gate move out of `@wardic/solid` and `@wardic/dom` into core, behind ports, and the Solid-free modules around them follow (ADR-0069 decision 2, ADR-0071 decisions 4–8). `@wardic/foldkit` then drives each element through the same spine as Solid, with no Solid in sight.

**Status:** refreshed by #672's build grill (2026-11-14, Q1–Q24, [issuecomment-6885943992](https://github.com/wardiclabs/wardic/issues/672#issuecomment-6885943992)), recorded in ADR-0071's *Amendment (#672)*. It replaces the plan #561's round 7 accepted, read at `15f723d` (2026-11-09). Since then #665, #712, #706, #746, #516, #680 and #240 changed 96 files in `packages/solid/src`.

Read at `3538869` (1.1.0, 2026-11-14). Line counts are that commit's, of the file a module comes from; a `~` is part of one.

## The rule

**A module moves only if a moved module imports it, or Foldkit's decided API needs it** (Q12). Solid-free code that only Solid calls stays in solid until a second binding needs it.

**What a move commit holds** (Q5, Q16):
- **The code keeps its shape:** its names, its exports and its signatures, but where a port changes one. No reshaping into ADR-0028's form; that waits until a module leaves `unstable/`, if one ever does.
- **Imports, and the moved files' docs for their new home.** An import takes the form the module's new home asks, a core module as a namespace (`pipeable.md`'s rule 5), and a moved file's header says where it lives now (and, in core, names no CSS or DOM, #609). Any other change the move needs (core's lint, a rename, a port, a retype) is a commit of its own before it, in the file where it is, so `git show --color-moved=dimmed-zebra` shows the move as a move. A split (`config.ts`) is a change, not a move, and says so.
- **Names** (Q6): a module is named for its file, in PascalCase, with no `Dom` prefix (ADR-0041 keeps that for service implementations): `spine.ts` → `Spine`, `presence-controller.ts` → `PresenceController`. The exceptions are the files that split; they're named in the tables.

## Where each module goes

### To core, `@wardic/core/unstable/<Module>`

| Module | Lines | PR |
|---|---|---|
| dom's `internal/report.ts` → `Report` | 69 | 1 |
| the pure half of dom's `internal/starting-style.ts` → `Stops` | ~197 of 396 | 1 |
| dom's `internal/runner.ts` and `runtime.ts`'s `WardicServices` and `WardicEnv` → `WardicServices` | 78, ~25 | 1 |
| `reactivity.ts` → `Reactivity` | 29 | 1 |
| `config.ts`'s generic half, with the controls' interface and mark from `animation-controls.ts` → `Config` (Q24, Q25) | ~270 of 864, ~30 | 1 |
| the slot half of `member-hold.ts` (Q14) | ~30 | 2 |
| `timelines.ts`'s key → `Timelines` (Q15) | ~25 | 2 |
| `presence-record.ts` | 196 | 3 |
| `variant-target.ts` | 240 | 3 |
| `wardic-config-value.ts` | 150 | 3 |
| `frame-time.ts` | 45 | 3 |
| `retarget-legs.ts` | 1,049 | 3 |
| `live-style.ts` | 471 | 3 |
| `animation-controls.ts` | 206 | 4 |
| `variant-tree.ts` | 638 | 4 |
| `appear.ts`'s handoff half → `AppearHandoff` | ~450 | 4 |
| dom's `internal/gate.ts` → `FlushGate` | 706 | 4 |
| `spine.ts` | 3,540 | 4 |

**Why `animation-controls`, `variant-tree` and `appear`'s handoff wait for the spine** (found at the build): `animation-controls.ts` imports the spine's `Snapshot`, `variant-tree.ts` imports `animation-controls`, and `appear.ts` imports `variant-tree`. Moved before the spine, core would import solid; moved with it, each move stays a move. The controls' interface and mark, which `WardConfig` names, went ahead into `config.ts`, and with it to core's `Config`, in PR 1.

### To dom, `@wardic/dom/unstable/<Module>`

| Module | Lines | PR |
|---|---|---|
| `config.ts`'s DOM half → `WardConfig` (Q24) | ~590 of 864 | 1 |
| `gesture-info.ts`, `drag-controls.ts`, `drag-constraints.ts` | 81, 94, 103 | 1 |
| `dragDefaultsOf` and `applyDragDefaults`, from `spine.ts` → `DragDefaults` (Q11) | ~20 | 2 |
| `appear.ts`'s server sampler → `AppearSampler`, with `server-interpolators.ts` | ~430, 33 | 4 |
| `batch.ts` → `BatchMembers` (core has `Batch`), `batch-handoff.ts` → `BatchHandoff` | 3,078, 73 | 5 |
| the filler half of `member-hold.ts` (Q14) | ~210 | 5 |
| `imperative.ts` (Q13: the DOM's `animate`, its Subjects elements and selectors) | 1,052 | 5 |
| `presence-controller.ts` | 1,732 | 5 |
| `feature.ts`, `gesture-features.ts`, `features/*` (15 files), `press.ts` | 491, 35, 549, 40 | 6 |
| `owner-scope.ts`, `instant.ts` | 31, 90 | 6 |
| `drag-track.ts`, `drag-transition.ts` | 955, 43 | 6 |
| `layout-member.ts`, `layout-group.ts` | 315, 32 | 6 |
| `runtime.ts`'s `ProjectionOptions` | 1 | 6 |

Service ids follow their modules: `"@wardic/solid/HoverGesture"` becomes `"@wardic/dom/HoverGesture"`, and so on.

### Staying in solid

- The Batch's gestures and its Reorder group: `batch-gestures`, `lazy-batch-gestures`, `batch-reorder`, `batch-reorder-places`. Only Solid's `createBatch` and `BatchGroup` use them; a Foldkit Batch is beyond Motion parity.
- `gesture-callbacks.ts`: each binding keeps its own gesture start (Q8). Only the Features' services move.
- `runtime.ts`'s provider half (`WardicContextValue`, `clientContext`, `serverContext`): both Solids' provider record. Foldkit's provider slice decides whether to share it.
- `messages`, `spans-check`, `ward-keys`, `instance-features`, `wardic-instance`, `reorder-values`, `scroll-values`, `motion-props`: Solid's providers, props and instances.

**Solid's own modules keep their imports** through a one-line re-export where a moved module had importers (`config.ts`, `reactivity.ts`, `gesture-info.ts`, …). Each goes once its last importer has moved, in PR 6.

## The ports (PR 2)

**Required members of `WardicServices`** (Q19), each a `Context.Service` in core:
- **Own values,** with the gate's inline read and the CSS-text parse `live-style.ts` reads through `Style.over`;
- **Measured pairs,** which `retarget-legs.ts` reads too (`MeasuredPair.Requested`, `.measured`);
- **Variables;**
- **Appear's handoff;**
- **the server's Starting style;**
- **the Transform template,** a member of the Renderer port.

**Who gives them:** `DomLive` gives the DOM's; `@wardic/test`'s `TestLive` gives headless ones (no own values, no measured pairs, no variables, no handoff, core's plain template); a server render, which builds no runtime (ADR-0021), gives dom's as constants in `serverContext`, beside `SERVER_POSITIONAL_KEYS`. An env assembled from dom's parts without `DomLive` stops typechecking; none is documented.

**How the spine reaches them:** the provider resolves each once into its record, and the spine gets them through its options, as `positionalKeys` and `defaultTransition` already come (`spine.ts:1880`). An exported helper that reads one takes it as a parameter (`holdsVariable(from, to, stops, variables)`).

**Dropped:** drag defaults (Q11: `makeElementSpine` never reads them; the bindings call the two helpers, which go to dom) and subject resolution (Q20: once `imperative.ts` is dom's, nothing that moves to core checks a Subject's kind; `Subject` stays, as a type).

**Structural interfaces in core** (Q15), where an import would point from core into dom:
- `SpineDrag { takeRelease }`: all the spine calls of the drag track (`spine.ts:2490`);
- `SpineConfig`: the fields of `WardConfig` the spine and `animation-controls` read, typed without DOM types; dom's `WardConfig` extends it;
- the gate's timeline calls (sync and cancel, `gate.ts:350-370`, `:617-640`), which dom's `TimelineValue` satisfies;
- `Timelines`' key, with its element a Subject and its runtime a Runner. Its implementation stays in dom's `scroll` Feature.

**`member-hold.ts` splits** (Q14): its slot (`MemberHold`, `MemberHolds`, `memberHoldsNow`, and a `provideMemberHolds(holds)` setter) goes to core beside the spine, page-wide module state as now, which links code in and holds no provider's data; its filler (`makeMemberHold`, `provideBatchHolds()`) goes to dom beside `BatchMembers`. The cycle between the spine and the hold goes.

**The spine's other DOM names** take core's forms: its `queueMicrotask` a local declaration (as `Clock.ts` has), and `DRAG_HOOKS`' keys and `SpineHost.element` the Subject type.

After PR 2, `spine.ts` imports nothing from `@wardic/dom` but `FlushGate`'s types.

## The config types (Q24, Q25)

Core's `Config` declares `interface ValueKeys {}`, the keys an Environment animates and the values each takes, and builds every config type on it: `WardicTransition`, `WardicVariant`, `WardicTargetValues` and the rest, each with its name and shape. dom's `WardConfig` fills it:

```ts
declare module "@wardic/core/unstable/Config" {
  interface ValueKeys extends WardicValues {}
}
```

With dom in a program, every app's, each type is exactly what it was; core's own build sees an empty map, and its code reads keys by name at run time, as it did. Solid's `declare module "solid-js"` for its directives is the precedent. One Environment fills the map: a scene's keys come through `@wardic/three`'s own `animate` types (ADR-0069 decision 4). The six types whose reader docs name CSS keep them on an alias in dom. The grill's sketch named it `Values`; the review renamed it `ValueKeys` (Q25), since core's `Values` module is a values record.

## The order: six PRs, one at a time off `main` (Q2, Q21)

1. **Foundations** (built, below).
2. **Ports in place,** while the spine is still in solid: the port services, the structural interfaces, `member-hold`'s slot, `DragDefaults`. The only PR with runtime changes.
3. **Leaves to core:** core's lint met in place first (Q16), then `presence-record`, `variant-target`, `wardic-config-value`, `frame-time`, `retarget-legs`, `live-style`.
4. **The spine and what imports it:** `animation-controls`, `variant-tree`, `appear`'s split, the gate, the spine; the moved files' comments rewritten without DOM names (#609).
5. **The Batch, `animate` and presence, to dom:** `BatchMembers`, `BatchHandoff`, the hold's filler, `imperative`, `presence-controller`.
6. **The Features, to dom:** Q9's `PropFeature` and Q10's registry in place first, then `feature`, `gesture-features`, `features/*`, `press`, `owner-scope`, `instant`, the drag track, `layout-member`, `layout-group`, `ProjectionOptions`; **Feature**'s glossary wording; solid's re-exports with no importer left.

**Every commit** passes typecheck, lint, `test`, `test:browser` and `size`. **Every PR** also runs `bench:solid` (paired base and head, after `wardic-quiet`), `bench:core` and `pack:check`; a bench that fails is bisected by commit, PR 2's by each port's commit (Q3).

**Each PR adds a `patch` changeset** until the 1.2 Foldkit release (Q4). **Size** (Q23): if PR 2's ports cross a budget, it rises by exactly what was measured, recorded in ADR-0067; a move must fit the 0.5 KB room, and one that doesn't is investigated.

**ESLint:** core has no rule against DOM globals: its `lib: ["ES2022"]` keeps them out. It does enforce `BOOL_OPERANDS`, which solid and dom don't: the core-bound files fail it 15 times (`spine.ts` 6, `appear.ts` 6, `retarget-legs.ts`, `variant-target.ts` and `starting-style.ts` 1 each), each met before its move. The gate joins core's `PER_FRAME_LOOPS` in its move commit; `batch.ts` takes its `MOUNT_PATH_LOOPS` entry with it.

## How each step shows it's structural

| Check | Expected | Why it shows the move is structural |
|---|---|---|
| `bun run typecheck`, `bun run lint` | clean | The moved code keeps its types; core's `lib` keeps DOM globals out. |
| `bun run test`, `bun run test:browser` | unchanged pass counts | 16 test files outside `v2/` and 6 inside import a moved module directly; only their import paths change, through solid's re-exports. They stay in solid (Q17), but one that uses no Solid and tests one moved module, which moves with it. |
| `bun run bench:solid` (paired) | flat | Per-element mount, Retarget and unmount. PR 2's property loads are the one new cost. |
| `bun run bench:core` | flat | Core's engine is untouched. |
| `bun run size` | flat, within the budgets' 0.5 KB | Code that crosses a package boundary can minify differently. |
| `bun run pack:check` | passes | Core's and dom's `"./*"` export resolves `unstable/<Module>`; `./internal/*` stays `null`. TypeDoc documents `src/*.ts` only, so no `unstable/` module reaches the reference. |

## Built in PR 1

Ten commits after this one, each through every per-commit gate. A move's commit changes imports and its file's header; each change it needed came first:

1. **`Report`'s `reportFailure` is named `failure`,** in dom, as `@wardic/dom/Report` named it, and dom's modules take `Report` as a namespace. Then **`Report` moves to core**; `@wardic/dom/Report` re-exports it.
2. **`isStops` meets `BOOL_OPERANDS`** in dom. Then **`Stops`** moves: `toValues`, `splitValues`, `valuesAt`, `keyframesOf`, `resolveInitial` and their types; `@wardic/dom/Style` re-exports them. Its marked mount-path loop keeps #540's exemption in a core block of its own (`CORE_MOUNT_PATH_LOOPS`), under core's rules otherwise.
3. **`WardicServices`:** `WardicServices`, `WardicEnv`, the Runner and `makeRunner`. dom's gate, projection system and Reorder controller make their runners from core; solid's `runtime.ts` keeps `WardicEnv` and `WardicServices` as aliases with their reader docs; the runner's test (RN1–RN6) moves to core's tests.
4. **`Reactivity`** moves to core.
5. **The spine, `live-style`, `timelines`, `imperative`, `presence-controller` and `frame-time` take a `WardicServices.Runner<WardicServices.WardicServices>`,** not Solid's `ManagedRuntime`, which they use only as a runner. `batch.ts` and `batch-handoff.ts` keep theirs until PR 5: `batch-reorder`, which stays in solid, closes its Scope on their runtime with `OwnerScope.close`, whose `runSyncExit` the Runner lacks (*Open*, below).
6. **The controls' interface, its definition and its mark move into `config.ts`,** which names them, out of `animation-controls.ts`, which moves with the spine. Then **`config.ts` splits** (Q24, Q25), with `GestureInfo`, `DragControls` and `DragConstraints` to dom, their headers written for their new home. dom depends on `csstype` now: its emitted types name it.
7. **The review's fixes:** the site's reference keeps documenting what dom's Tier 2 faces re-export from core's `unstable/` (its run took every core file as external, so dom's `Report` page lost its members and `Style` its starting values); `Stops`' examples unqualified; `pipeable.md` on `unstable/` modules; `effect-first.md`'s mount-path sites; one lint list for core's rules without the loop rule.

Solid's own modules import the moved ones through one-line re-exports (`config.ts`, `reactivity.ts`, `gesture-info.ts`, `drag-controls.ts`, `drag-constraints.ts`).

**Measured** (the bench host, after `wardic-quiet`, against `main`):
- **`size`:** every app flat at every commit: `s1-slim` 94.0 of 94.5 KB gzipped, `s2-slim` 115.4 of 115.9.
- **`bench:solid`** passes, both bindings, warm: Solid 1 mount −0.8%, retarget −1.7%, restRetarget +1.5%, unmount −1.8%; Solid 2 mount +2.3% (IQR −1.0% to +3.1%), retarget −0.0%, restRetarget −1.3%, unmount +0.8%. Bytes and retained flat; every layout scene within its gate.
- **`bench:core`** passes every workload on every engine (noise controls −2.1%, +0.4%, +0.0%).
- Both ran on the first build of these commits, whose code differs from this one's only in import forms, a type's name (`ValueKeys`) and where the controls' interface was declared in between.

## Open

- **`OwnerScope.close` on a Runner** (Q10, PR 5–6). It closes a Scope with `runSyncExit`, so a finalizer that suspends is reported, not thrown into Solid's cleanup (#618, decision 5). A Runner has `runSync` alone, and `runSync(Effect.exit(…))` throws on a suspending finalizer. Either the Runner gains `runSyncExit`, which `ManagedRuntime` has and `makeRunner` can give, or the close catches the throw.
- **`appear.ts`'s split line,** export by export: inferred from its imports and its callers'. PR 4 reads it in full, with `AppearGroup`, which `variant-tree.ts` reads, and `childDelayOf`, which the sampler calls.
- **The ports' cost:** PR 2's `bench:solid` measures it.
