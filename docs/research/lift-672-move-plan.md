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
| the slot half of `member-hold.ts` (Q14), in `spine.ts` since PR 2 | ~75 | 4 |
| `timelines.ts`'s key → `Timelines` (Q15): its options take a `FlushGate.Shape` | ~25 | 4 |
| `Subject` (new: a type, `object`, Q20) | 13 | 3 |
| `presence-record.ts` | 196 | 3 |
| `variant-target.ts` | 240 | 3 |
| `wardic-config-value.ts` | 150 | 3 |
| `frame-time.ts` | 45 | 3 |
| `retarget-legs.ts` | 1,049 | 3 |
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
| `element-setup.ts` → `ElementSetup`, `drag-defaults.ts` → `DragDefaults` (PR2-Q3), out of `spine.ts` in PR 2 | 159, 55 | 5 |
| `live-style.ts` → `LiveStyle` (PR3-Q1: the DOM's `style` prop) | 471 | 3 |
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

**Ports only for what the spine and the modules moving to core read** (PR2-Q1, refining Q19). Every other DOM read goes to dom with the code that makes it, by Q11's rule: a helper only the bindings call needs no port.

**Three ports, each an optional Environment member** (PR2-Q4, refining Q19's required ones), a `Context.Service` in core named for its glossary term (PR2-Q2):
- **`unstable/OwnValues`:** `valueLike` (a raw value in a target's shape), `styleValueOf` (a key's value in a `style`), `recordOf` (a `style` as a record: the CSS-text parse `live-style`'s `split` took from `Style.over`);
- **`unstable/MeasuredPairs`:** `needs` and `measure`. Each pair it returns carries the read of its result (`measured()`, which dom's `DomValues` adds to `MeasuredPair.measure`'s pairs, so dom's Tier 2 module stays as it is), so `retarget-legs`, whose leg reads it at its first step, needs no port; dom's presence controller measures through `DomValues` too;
- **`unstable/VariableValues`:** `isValue` and `values(subject)`, a Subject's Key rule.

**Who gives them** (PR2-Q4):
- **An Environment that isn't the DOM** gives its own: `@wardic/test`'s `testLayer` headless ones (a raw value as it is when it has the target's type, no measured pairs, no variables), a scene's `@wardic/three`'s.
- **`DomLive` gives none.** A DOM binding's element code falls back to dom's `unstable/DomValues` (its three service values, over dom's Tier 2 `OwnValues`, `MeasuredPair` and `Variables`, which stay as they are; and a `layer`, for an Environment that wants them explicit): `element-setup.ts`' `ownValuesOr`, `measuredPairsOr` and `variableValuesOr`.
- **Why not `DomLive`:** an app on it would ship the DOM's port code whatever it animates. A Batch app, which never runs the spine, grew 2.0–3.2% so (measured at the build). Through the elements, only an app that animates one ships it, and the Slim apps already did, through the spine.
- **A server render** gives none either (ADR-0021: no runtime); its elements fall back as a client's do. A server ward reads Own values for `split`.

**How the spine reaches them:** each provider resolves its Environment's once into its record (`ownValues`, `measuredPairs`, `variableValues`, each `undefined` when it gives none; a `useWardic…` hook each), and each element's spine gets it, or the DOM's, in its options, as `positionalKeys` comes. A helper that reads one takes it as a parameter (`holdsVariable`, `measuredOf`, `liveTargetOf`); `SpineHost` carries the two an Imperative animation reads.

**No port for the rest:**
- **Appear's handoff:** a `Handoff` carries what the spine reads of it, `elapsed()` and `delay()`, built where it's found, over its `Animation`. The DOM's (`DomHandoff`) keeps its `Animation` for development's `checkHandoff`, which moves to `element-setup.ts` with `SPINE_DIAGNOSTICS`, so a production build ships none of the match (#746, decision 6).
- **The bindings-only helpers** (PR2-Q3): `startLinksOf`, `releasingAppear`, `restingOf`, `serverStartingStyle` and the Transform template's (`drawnAtRest`, `withTemplate`, `registeredValuesOf`, `heldTransformFor`, `followTemplate`) leave `spine.ts` for solid's `element-setup.ts`; `dragAxisOf`, `dragDefaultsOf` and `applyDragDefaults` (Q11) for `drag-defaults.ts`. They reach `@wardic/dom/unstable/ElementSetup` and `DragDefaults` once what they read has left solid (the spine's types, `appear.ts`, `live-style.ts`). So the server's Starting style and the Transform template need no port.
- **The gate's two DOM edges**, an element's inline value and the renderer's Transform template key, are a `GateEnvironment` that dom's `FlushGate.make`, its only builder, gives it (`gate-environment.ts`).
- **Subject resolution** (Q20): nothing that moves to core checks a Subject's kind.

**Structural interfaces** (Q15), where an import would point from core into dom:
- `SpineDrag { takeRelease }`, in the spine: all it calls of the drag track;
- `SpineConfig`, in core's `Config`: what the spine and `animation-controls` read of a config, in core's types; dom's `WardConfig` extends it;
- `GateTimeline { sync, cancel }`, in the gate, which dom's `TimelineValue` meets;
- `StartLinks`, in the spine: what its binding's `startLinksOf` makes.

**`member-hold.ts` splits** (Q14): its slot (`HoldHost`, `MemberHold`, `MemberHolds`, `memberHoldsNow`, `provideMemberHolds(holds)`) goes into `spine.ts`, page-wide module state as it was; its filler (`makeMemberHold`, `provideBatchHolds()`, which `createBatch` calls) stays, for dom beside `BatchMembers` (PR 5). The cycle between the spine and the hold goes. The slot reaches core with the spine.

**Waiting for PR 4,** since they name what the spine or the gate defines: `Timelines`' key (its options take a `FlushGate.Shape`), and the spine's DOM global types (`HTMLElement`, `Element` in its options, `SpineHost` and `DRAG_HOOKS`), which its in-place commit makes core's Subject type, with its `queueMicrotask` a local declaration.

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
2. **Ports in place,** while the spine is still in solid: the three ports, the structural interfaces, `member-hold`'s slot into the spine, the bindings-only helpers out of it (built, below). The only PR with runtime changes.
3. **The leaves:** core's lint, its lib and #609 met in place first (Q16), then `presence-record`, `variant-target`, `wardic-config-value`, `frame-time` and `retarget-legs` to core, and `live-style` to dom (PR3-Q1) (built, below).
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

## Built in PR 2

Twelve commits after its docs commit, each through every per-commit gate (PR2-Q5: the review's fixes folded into the commits they belong to, so none fails a gate a later commit fixes):

1. **The bindings-only helpers leave `spine.ts`** for `element-setup.ts` and `drag-defaults.ts`; the spine names its `StartLinks`.
2. **A Batch member's hold's slot is the spine's;** `createBatch` fills it (`provideBatchHolds`).
3. **`SpineDrag`** names what the spine calls of a drag.
4. **The gate takes its `GateEnvironment` from `FlushGate.make`,** and names its `GateTimeline`.
5. **A `Handoff` carries `elapsed` and `delay`;** the spine reads no `Animation`, and development's match stays the binding's.
6. **The spine takes `Report` and `Stops` from core;** its template field is typed by its config.
7. **`SpineConfig`,** which dom's `WardConfig` extends.
8. **The Slim element's budgets** raised by what PR 2 measured (Q23; ADR-0067's *Note (#672)*), ahead of the commits that grow them.
9. **Own values,** 10. **Measured pairs,** 11. **Variable values:** each a port, a commit each (Q3).
12. **One context read for the three** (PR2-Q6): the provider's record holds one `ValueReads`, one hook gives it, and `element-setup.ts`' `valueReadsOf` fills its gaps with the DOM's, the shared `DOM_VALUE_READS` for `DomLive`.

**Measured** (`bun run size` against `main`): `s1-slim` 94.0 → 94.7 KB gzipped, `s2-slim` 115.4 → 116.0, the ports' plumbing and the helpers out of the spine (ADR-0067's *Note (#672)*, by module); every other app within its +1% gate, the Batch apps +0.1–0.2%.

**`bench:solid`** (paired, after `wardic-quiet`): the three ports read with a hook each put warm mount at +2.7% (Solid 1) and +4.6% (Solid 2) against `main`, within the gate. One context read (commit 12) measured −1.2% [−3.3% – −0.6%] and −0.8% [−1.2% – −0.2%] against that head, and the PR against `main` +2.1% [−0.2% – +4.1%] and +0.0% [−1.7% – +2.4%]: about PR 1's noise for a pure move. Retarget, restRetarget and unmount within ±1.3%, bytes +0.5–0.6%, retained +0.2–0.3%, every layout scene within its gate. **`bench:core`** passes every workload (Node's `batch/table` bytes on its rerun, its known flap). **`pack:check`** 37 of 37.

## Built in PR 3

Eleven commits after its docs commit, each through every per-commit gate. Five in place, then six moves:

1. **Core's `Subject` type** (`@wardic/core/unstable/Subject`, `object`: Q20's type), and **presence's protocol over it:** its record, context and watch take their Subject as a parameter, core's by default (`PresenceRecord<E>`, `PresenceContextValue<E>`, `PresenceWatch<E>`), and its helpers are generic over it. The protocol is `presence-protocol.ts` until it moves; `presence-record.ts` names it over `Element`, so solid's presence, its spines and its public `PresenceRecord`, `PresenceContextValue`, `PresenceContext` and `usePresenceContext` are what they were, with no cast.
2. **Core's lint and lib, met in place:** `variant-target`'s `sameLabels` and `retarget-legs`' `isSpring` (`BOOL_OPERANDS`); `frame-time` declares `performance` as core's `Clock.ts` does. Each leaf linted under core's rules through stdin: nothing else.
3. **The leaves' comments name no CSS, DOM or page** (#609): a child is shown, not put on the page; an exit starts from its value as given (in `@wardic/dom`, its `style`); `isValidProp` keeps props from being passed on; a presence publishes to the spines below it. The glossary's Starting style and the Measured pairs' px, which core's `MeasuredPairs` names, stay.
4. **The ports' docs name `@wardic/dom`** (#609), not the DOM: PR 2's `OwnValues`, `MeasuredPairs` and `VariableValues`.
5. **`LiveRoutes`** (PR3-Q1): what the spine and the Timelines' keys call of an element's Live values, nine members, among them `turnsWillChangeOn`, which the spine took from `live-style` as a module function and asks the Live style for now (a member of its prototype). `LiveFollower` beside it. The spine imports none of `live-style`. The Timelines' keys name the one member they call (`LiveAtoms`), so `timelines.ts`, which the spine imports, imports nothing of the spine's.
6. **The moves:** `PresenceRecord`, `VariantTarget`, `WardicConfigValue`, `FrameTime` and `RetargetLegs` to core; `LiveStyle` to dom. Each changes its imports to its new home's form (core's modules relative and as namespaces; dom's core subpaths as namespaces) and its header; solid's old paths re-export it, `presence-record.ts` still naming the protocol over `Element`.

**`bench:solid`** (paired, 11 reps, after `wardic-quiet`): warm mount +1.1% [−0.6% – +2.7%] (Solid 1) and −1.0% [−2.9% – +2.2%] (Solid 2) against `main`, Retarget, restRetarget and unmount within ±1.4%, bytes +0.1–0.2%, retained flat, every layout scene within its gate: noise, for a PR of moves. **`bench:core`** passes every workload on all three engines. **`pack:check`** 37 of 37. **Size:** every app within ±0.1% gzipped, the budgets unchanged.

**Why `live-style` is dom's** (PR3-Q1, refining decision 4): it is the DOM's `style` prop, Live values routed through it (ADR-0043), its CSS text, the dropped `transform` string, Motion's will-change (`ACCELERATED` names CSS properties). A scene has no `style`.

## Open

- **The spine's presence, in core** (PR 4). The spine reads the protocol over core's Subject there, and solid's elements hand it a presence over `Element`, which a context over `Subject` doesn't accept (the protocol takes its Subject as an argument, so it's contravariant in it). Either the spine is generic over its Subject, or the binding casts once where it hands the presence on, which holds while a DOM binding registers only elements.
- **Will-change in core's names** (PR 4). `LiveRoutes`' `willChange` and `turnsWillChangeOn` name CSS's `will-change`, and reach core with the spine as member names, which no comment can reword (#610's `pageVisible`).

- **`OwnerScope.close` on a Runner** (Q10, PR 5–6). It closes a Scope with `runSyncExit`, so a finalizer that suspends is reported, not thrown into Solid's cleanup (#618, decision 5). A Runner has `runSync` alone, and `runSync(Effect.exit(…))` throws on a suspending finalizer. Either the Runner gains `runSyncExit`, which `ManagedRuntime` has and `makeRunner` can give, or the close catches the throw.
- **`appear.ts`'s split line,** export by export: inferred from its imports and its callers'. PR 4 reads it in full, with `AppearGroup`, which `variant-tree.ts` reads, and `childDelayOf`, which the sampler calls.
