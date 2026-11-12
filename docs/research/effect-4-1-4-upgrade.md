# Effect `4.1.1` → `4.1.4`, Solid `2.0.0-rc.20` → `rc.21`: what changed for Wardic

> **Read at:** 2026-11-12 (UTC), on `chore/latest-effect-solid2` (installed: `effect` and
> `@effect/vitest` 4.1.4, `solid-js-2` rc.21). **Sources, in order of trust:**
> - GitHub releases. Effect's are in **`Effect-TS/effect`**:
>   [`effect@4.1.2`](https://github.com/Effect-TS/effect/releases/tag/effect%404.1.2) (2026-11-02, 25 entries),
>   [`effect@4.1.3`](https://github.com/Effect-TS/effect/releases/tag/effect%404.1.3) (2026-11-10, 74 entries),
>   [`effect@4.1.4`](https://github.com/Effect-TS/effect/releases/tag/effect%404.1.4) (2026-11-11, 10 entries).
>   `@effect/vitest@4.1.2`–`4.1.4` list dependency bumps only. Solid's are in **`solidjs/solid`**
>   ([`solid-js@2.0.0-rc.21`](https://github.com/solidjs/solid/releases/tag/solid-js%402.0.0-rc.21),
>   [`@solidjs/signals@2.0.0-rc.21`](https://github.com/solidjs/solid/releases/tag/%40solidjs/signals%402.0.0-rc.21),
>   [`@solidjs/web@2.0.0-rc.21`](https://github.com/solidjs/solid/releases/tag/%40solidjs/web%402.0.0-rc.21),
>   `@solidjs/babel-plugin`, `@solidjs/compiler`, `@solidjs/diagnostics`; all 2026-11-04).
>   [`solidjs/solid-router` `v2.0.0-next.44`](https://github.com/solidjs/solid-router/releases/tag/v2.0.0-next.44)
>   (2026-11-04). `solidjs/solid-vite-plugin`
>   [`next.55`](https://github.com/solidjs/solid-vite-plugin/releases/tag/%40solidjs/vite-plugin%403.0.0-next.55),
>   [`next.56`](https://github.com/solidjs/solid-vite-plugin/releases/tag/%40solidjs/vite-plugin%403.0.0-next.56),
>   [`next.57`](https://github.com/solidjs/solid-vite-plugin/releases/tag/%40solidjs/vite-plugin%403.0.0-next.57).
> - The npm tarballs (`npm pack`, each in its own empty scratch directory, nothing run from them): `effect` 4.1.1 / 4.1.4, `@effect/vitest` 4.1.1 / 4.1.4, `solid-js`, `@solidjs/signals`,
>   `@solidjs/web`, `@solidjs/diagnostics` rc.20 / rc.21, `@solidjs/router` next.43 / next.44,
>   `@solidjs/vite-plugin` next.54 / next.57.
>
> **No release notes found for:** `@solidjs/compiler@2.0.0-rc.21` (its GitHub release body is empty
> and `packages/compiler/CHANGELOG.md` at the tag has an empty `## 2.0.0-rc.21` heading; its native
> binary was not diffed). `@solidjs/diagnostics@2.0.0-rc.21` lists only dependency bumps, and its
> tarball differs from rc.20 only in `package.json`. `@solidjs/html`, `universal`, `element`: deps only.
> **One Effect change has no changeset:** the `MutableRef`/`Ref` equality revert (#10247, below).
>
> Effect paths are `src/…` of the 4.1.4 tarball (it ships `src` and `dist`; `dist` line numbers given
> where cited) unless prefixed `wardic:`. Solid paths are the rc.21 tarball's `dist/…`.
> What was run on the bump is in [Checked](#checked).

## Summary

| | Reached by Wardic's shipped code | Reached by tests / examples / site only |
|---|---|---|
| Effect 4.1.2–4.1.4 | The run loop's automatic yield is rewritten (every fiber; behaviour-equivalent at the default budget). `Effect.raceFirst` interrupts the loser at once (`drag-track.ts:569`). `Match.discriminators` reads one more property (3 call sites, not per frame). | `it.effect`'s `TestClock` rewritten (4.1.3) and its warning fork no longer forced interruptible (4.1.4). |
| Solid rc.21 | `createOwner` left solid-js's public types: `element.tsx` used it, and moves to `createRoot`, the same owner. `defer: true` effects mounted by a held update now skip their first run. `latest()` setup read (#335) meets 84353de's `<Show>`/`<Match>` change. | Hydration, `<Loading>`/`<Errored>`, optimistic lists, the keyed `<For>` write skip: the storefront's Solid 2 app, the site, `solid2-start`. |
| `CAUGHT_REACTIVE_READ` | One try/catch around a reactive read, `config-view.ts:131`, by design (#335). It runs under `runWithOwner(null, …)`, so no pass records the throw: **won't warn**. Every other catch wraps app callbacks run outside any pass. | — |
| `OPTIMISTIC_WRITE_BEFORE_LOAD` | The binding makes no optimistic source. | Storefront `cart-drawer` and `wishlist` demos have async optimistic sources (a write before their first answer would throw in dev). |
| Router next.44, vite-plugin next.55–57 | — | Router internals swap `createOwner` for `createRoot`. vite-plugin: the site's published client output loses `.vite/manifest.json`; `solid2-start`'s node server precompresses. |

The other timing internals the 4.1.1 read re-checked are byte-identical or code-identical at 4.1.4
([table](#the-timing-internals-re-read-at-414)). The 4.1.1 doc's line "`MutableRef` is `Equal` by
reference with a random hash" is **no longer true** (reverted in 4.1.2); Wardic compares no
`MutableRef`, so nothing reaches it.

## Effect

`exports` unchanged in shape; `src/internal/version.ts` says `4.1.4`. `@effect/vitest@4.1.4`'s `dist`
is byte-identical to 4.1.1's; its `package.json` peers `vitest >=5.0.0 <6.0.0` (unchanged) and
`effect ^4.1.4`. The `effect-4` skill (Effect's `AGENTS.md`) changed only in its version line.

### The timing internals, re-read at 4.1.4

`cmp` of the 4.1.1 and 4.1.4 `dist` files: **byte-identical** — `Context.js`, `Layer.js`,
`internal/layer.js`, `Scheduler.js`, `ManagedRuntime.js`, `PubSub.js`, `Scope.js`, `FiberSet.js`,
`FiberHandle.js`, `Clock.js`, `Effect.js`, `Channel.js`, `internal/stream.js`, `Tracer.js`,
`internal/tracer.js`, `reactivity/AtomRegistry.js`, `Equal.js`, `Hash.js`, `Option.js`, `Array.js`,
`Record.js`, `Deferred.js`, `Duration.js`. **Changed** — `internal/effect.js` (58 lines),
`internal/core.js` (7), `Stream.js` (11), `reactivity/Atom.js`, `MutableRef.js`, `Ref.js`,
`internal/matcher.js`, `internal/equal.js`. The `src` diff agrees file for file.

| Behaviour Wardic relies on | 4.1.4 source | vs 4.1.1 |
|---|---|---|
| `Effect.runFork` evaluates the new fiber synchronously to its first async point | `runForkWith`, `src/internal/effect.ts:5773` (`dist/internal/effect.js:2536`) | code-identical |
| `ManagedRuntime.runFork` on a built runtime | `src/ManagedRuntime.ts` | byte-identical |
| An `Effect.callback` resume after the fiber yielded re-enters it synchronously | `callbackOptions`, `:1206` (dist `:847`) | code-identical |
| `forkIn(…, { startImmediately: true })` runs the child inline | `forkIn` `:5696`, `forkUnsafe` `:5614` (dist `:2517`, `:2479`) | code-identical (4.1.1's closed-scope change stands) |
| `Effect.whileLoop` never yields; `Effect.forever` yields per iteration | `:5006`, `:2643` (dist `:2217`, `:1432`) | code-identical; an explicit yield now goes through `FiberImpl.yieldNow` (below), same task, same priority |
| The default scheduler, `MixedScheduler`, `MaxOpsBeforeYield` | `src/Scheduler.ts` | byte-identical |
| **The run loop's automatic yield** (when `shouldYield` says so) | `runLoop` `:673-720`, `yieldNow` `:773-783` | **changed** ([#10463](https://github.com/Effect-TS/effect/pull/10463)), behaviour-equivalent at the default budget: below |
| `PubSub.subscribe` + `Stream.fromSubscription`, `Scope.makeUnsafe`, `FiberSet`, `FiberHandle` | their modules | byte-identical (`Stream.ts`'s only hunk is `groupAdjacentBy`, `:15245`) |
| `Clock.sleep` wraps `setTimeout` in `Effect.callback` | `sleep` `:6476` (dist `:2997`); `src/Clock.ts` | code-identical |
| `Layer.merge(a, b)`: the later wins | `src/Layer.ts` | byte-identical |
| `Context` (4.1.1's `maxDepth` field and its per-pull cost) | `src/Context.ts` | byte-identical: the 4.1.1 cost stands |
| `AtomRegistry` | `src/reactivity/AtomRegistry.ts` | byte-identical |
| `Stream.withSpan` (the Clock's and `Machine.toStream`'s span) | `Stream.ts`, `internal/stream.ts`, `Channel.ts`, `Tracer.ts` | code-identical |

### Changed, and reached by Wardic

- **The run loop's automatic yield** ([#10463](https://github.com/Effect-TS/effect/pull/10463), 4.1.3:
  "Fix effects hanging when `Scheduler.MaxOpsBeforeYield` is set to 1 or 2"). In 4.1.1, when the
  scheduler said yield, the loop wrapped the pending instruction as `flatMap(yieldNow, () => prev)`
  and evaluated that. In 4.1.4 it calls `this.yieldNow(current, 0, true)` (`:704`), which schedules
  the pending instruction itself; the resumed slice starts its op count at 1 and skips the budget
  check for that one instruction (`:679-697`). Same task, same priority 0; one `flatMap` and one
  closure fewer per automatic yield. `FiberImpl` gains a field, `_autoYielded` (`:536`, `:557`), so
  **every fiber is one field larger**. `Effect.yieldNow` (`yieldNowWith`, `:1091-1095`) now calls the
  same `fiber.yieldNow(exitVoid, priority)`, with the same `scheduleTask` and resume as before.
  Wardic sets no budget of its own (`wardic:packages/dom/src/internal/runner.ts:60-64` only drops a
  sync scheduler), so the change is behaviour-equivalent for it. It reaches every Wardic fiber that
  runs more than 2,048 ops in one slice, and `wardic:packages/solid/src/reorder-input.ts:60`'s
  explicit `Effect.yieldNow`. The cost wasn't measured.
- **Races interrupt their losers at once** ([#10367](https://github.com/Effect-TS/effect/pull/10367),
  4.1.3). `raceAll`/`raceAllFirst` now call `interruptRaceLosers` from the winner's observer, right
  after `resume` (`:1725`, `:1774`, `:1786-1791`); before, the losers were interrupted only by the
  parent's `onExitUnsafe` when it continued past the race. Wardic: `Effect.raceFirst(run,
  Deferred.await(taken))` at `wardic:packages/solid/src/drag-track.ts:569`, a release racing a
  takeover (#340). `callbackOptions` resumes the parent synchronously (`fiber.evaluate`), so in the
  usual case the loser was already interrupted in the same call stack. The difference is a parent
  that hits its op budget before its `onExit`: a release's Machine could tap one more frame in that
  gap after a takeover, and now can't. Covered by `release-takeover.browser.test.tsx`.
- **`Match.discriminators` skips an undefined handler** ([#10455](https://github.com/Effect-TS/effect/pull/10455),
  4.1.3; `src/internal/matcher.ts:449`): one more property read per match. Wardic's three exhaustive
  matches (`dom/src/internal/projection.ts:498`, `:697`, `dom/src/internal/reorder.ts:450`) all have
  defined handlers, so the result is the same. They run once per (re)start or in the read phase, not
  per frame.
- **Tests only: `it.effect`'s `TestClock`.** `@effect/vitest` provides Effect's own `TestClock`
  (`dist/internal/internal.js:14`, `:53`) to Wardic's 427 `it.effect` tests. 4.1.3 rewrote it as a
  class ([#10326](https://github.com/Effect-TS/effect/pull/10326), "faster and with less memory"); its
  tracking scheduler keeps the same logic (`src/testing/TestClock.ts:492-527`). 4.1.4
  ([#10520](https://github.com/Effect-TS/effect/pull/10520)) drops the `Effect.interruptible` that
  4.1.1 put around the warning fork (4.1.1 `:323-331` → 4.1.4 `:373-381`). Before, that made the first
  sleep interruptible inside an uninterruptible finalizer. Wardic's tests don't sleep in an
  uninterruptible region, and they drive frames with `@wardic/test`'s own `TestClock`.

### Changed, but nothing in Wardic reaches it

- **`MutableRef` and `Ref` compare structurally again.** [#10247](https://github.com/Effect-TS/effect/pull/10247)
  (merged 2026-10-31, no changeset, so in 4.1.2) reverted [#9768](https://github.com/Effect-TS/effect/pull/9768),
  the 4.1.0 change the 4.1.1 doc lists. `MutableRefProto` and `RefProto` have no `Equal`/`Hash` of
  their own (`src/MutableRef.ts:77-80`, `src/Ref.ts:108-113`). On the installed 4.1.4,
  `Equal.equals(MutableRef.make(1), MutableRef.make(1))` is `true` (checked). Wardic compares no ref:
  its one `Equal.equals` (`dom/src/internal/auto-scroll.ts:140`) compares `Option<"start" | "end">`.
  `Option.contains` (`core/src/Recognizer.ts:86`, `dom/src/internal/reorder.ts:412` …) compares the
  values a ref holds, not refs. An atom's default `equals` is `Object.is` (`src/reactivity/Atom.ts:263`).
- `Stream.groupAdjacentBy`. The `Queue` fixes for zero capacity and sliding
  ([#10312](https://github.com/Effect-TS/effect/pull/10312), [#10354](https://github.com/Effect-TS/effect/pull/10354)):
  Wardic's three queues (`core/src/InputFeed.ts:66`, `core/src/internal/watch.ts:48`,
  `dom/src/internal/probe.ts:131`) come from `Stream.callback` with no `bufferSize`, which makes them
  unbounded (`src/Channel.ts:483-484`).
- `Schedule.fixed`/`windowed`/`cron`; `Iterable.filterMapWhile`/`unfold` (Wardic uses `findFirst`,
  `forEach`, `some`); `Atom.withLabel`/`serializable` labels; `Equal` on Bun `Error`s
  (`src/internal/equal.ts`); `StructuralProto` (`src/internal/core.ts:82-95`, used only by `Request`);
  `Runtime.InterruptExitCode`; `ScopedCache`, `RcMap` (Wardic's `SharedSource` replaced `RcMap`);
  `Rational`, `ByteSize`, `DateTime`.
- Schema (Wardic's `src` imports no `effect/Schema`), and HTTP, RPC, SQL, cluster, workflow, AI,
  MCP, CLI, OTLP, encoding.

## Solid `2.0.0-rc.21`

Pins moved: `solid-js-2`, `@solidjs/web`, `@solidjs/babel-plugin`, `@solidjs/diagnostics` (solid's
dev), the Solid 2 apps and the `solid2-start` pack-check fixture; peers `^2.0.0-rc.21`.
`@solidjs/compiler` rc.21 arrives through `@solidjs/vite-plugin`. Kobalte's `@solid-primitives/*` and
`@kobalte/core` keep their nested rc.18 (`bun.lock:2849-2899`, `:3419-3445`). The
`@solidjs/router-2` alias's nested `solid-js` is now rc.21 (`bun.lock:2905`).
`solid-js`'s `exports` are unchanged. The recopied skills differ only in their version lines,
except `reactivity-diagnostics`, which adds the two new codes.

### `CAUGHT_REACTIVE_READ`: the binding's catches

How rc.21 decides (dev and observe builds only): `read()` records a throw (`NotReadyError`, or the
source's error) against the running pass, which is `context` (`dev-shared.js:1217-1226`; `untrack`
doesn't clear it). When the pass's `_fn` returns a value with a throw still recorded, it reports
(`checkCaughtRead` / `reportCaughtRead`, `:1251-1300`), once per computation. Solid's own catches
call `forgetThrownRead` (e.g. `solid-js/dist/solid.dev.js:478`, `:1527`). An effect's callback is not
a pass. So a catch warns only if (a) a reactive read in it actually throws, (b) it runs inside a
computation's body, and (c) the body still returns a value. Both new codes are **gated**: neither is
in `packages/solid/test/v2/gate-filter.ts`'s `HEURISTICS`, so they fail the Solid 2 browser
projects and the storefront's `smoke:dev` if they fire.

| Site (`packages/…`) | What's in the `try` | In a pass? | Warns? |
|---|---|---|---|
| `solid/src/unstable/v2/config-view.ts:131-140` | `view[key]`, a ward config key (a prop, an accessor, a memo); catches `NotReadyError` by design (#335) and names the key pending | Only through `setupOf` (`:154`): `runWithOwner(null, () => untrack(() => latest(() => setup(view))))`. `runWithOwner` sets `context = null` (`dev-shared.js:6760`), and `latest()` doesn't touch it (`dev.js:1654-1665`), so `runningPass()` is null and nothing is recorded | **No** |
| `solid/src/unstable/v2/batch-reorder-group.tsx:310`, `reorder.tsx:416` | `controller.move(…)` | try/**finally**, no catch: a throw goes on | No |
| `solid/src/unstable/v2/provider.tsx:152` | `disposed.catch(constUndefined)`, a promise | no read | No |
| `solid/src/runtime.ts:352-357` (`prepareIdle`) | `value.prepare()`, `section.services()` | at idle time (`whenIdle`, v2 `provider.tsx:165`) | No |
| `solid/src/presence-controller.ts:1329` | a `usePresence` hook's leave (v2: `setPresent(false)` + the hook's `onLeave`, `presence-hooks.tsx:69-72`) | Leaves come from `present` (an effect's callback, v2 `presence.tsx:142-148`) or `decideAtTaskEnd`'s microtask (`:1238-1249`); the memo's `shown` (`:1534`) calls none | No |
| `solid/src/gesture-callbacks.ts:143`, `:152`; `animation-frame.ts:23`; `batch-reorder.ts:409`; `batch.ts:1965` | the app's callbacks (`config()` read before the `try`) | input events, the Frame loop | No (from Wardic's own reads) |
| `solid/src/appear.ts:496` | `render()` | try/finally | No |
| `solid/src/spine.ts:1408`, `presence-controller.ts:545` | app callbacks | Solid 1 only | — |
| `dom/src/internal/*` (`gate.ts`, `projection.ts`, `measure.ts`, `measured-pairs.ts`, `input.ts`), `core/src` (`InputFeed.ts:170`, `internal/frameLoop.ts`, `internal/outbox.ts`) | DOM calls and app callbacks | Frame loop, events, gate flush; neither imports Solid | No |

The binding's synchronous Effect runs inside component bodies (`runtime.runSync` in `bridge.tsx`,
`sensors.tsx:85`, `live-value.tsx:93`, `ward.tsx:1440`, `reorder.tsx:354` …) build watches and
atoms, and they write Solid signals rather than read them. Effect's run loop catches a throw as a
defect, so a Solid read inside one would be swallowed the same way, but none was found. This is a
static read, backed by the gate above, which passed (see [Checked](#checked)).

### `OPTIMISTIC_WRITE_BEFORE_LOAD` (227a01d)

An optimistic write to a source whose first answer hasn't landed emits the code and **throws** in
dev, making no guess (`dev-shared.js:756-766`). Production is unchanged. The binding makes no
optimistic source; `createOptimisticStore` appears only in a doc example
(`solid/src/unstable/v2/reorder.tsx:206`, an async source with a seed, where a write before load
would now throw). Storefront Solid 2 demos with async optimistic sources:
`examples/cart-drawer/Demo.tsx:40` (`createOptimisticStore(async () => …)`) and
`examples/wishlist/Demo.tsx:24` (`createOptimistic(() => server().items)`). Their writes come from
controls rendered with the loaded list, so a write before load isn't expected, but this wasn't run.
`catalogue`, `add-to-cart` and `notifications` seed plain values (`false`, `undefined`), and `saved`
derives from a sync signal, so none of these can trigger it.

### The APIs the brief named

- **`createOwner`** (61bb177): out of `solid-js`'s public types (`types/index.d.ts:1-2`), now typed in
  `types/internal.d.ts:90-103`; still a runtime export. **Reached:** on `main`,
  `solid/src/unstable/v2/element.tsx:31` imports it and `:391` runs `runWithOwner(createOwner(), () =>
  render(props))`. The bump moves it to `createRoot(() => render(props))`, and CO1
  (`client-only.ssr.test.tsx`) lists that root as taking an id by design, beside the server's memo. In rc.21, `createRoot` is `createOwner(options)` plus
  `markCopyRooted()` (only for the dev multiple-copies check) and `runWithOwner`
  (`dev-shared.js:1771-1777`). So it's the same owner: same parent, same `inheritId` id (#525's
  hydration id), disposed with its parent. The router made the same swap
  ([d034252](https://github.com/solidjs/solid-router/releases/tag/v2.0.0-next.44)).
- **Hydration:** 77be406 (`latest()`/`isPending()` in a hydration claim read the server's snapshot,
  `solid.dev.js:497`, `:1083`), 25fb7be (an `<Errored>` fallback recovers after a rejected
  fragment), 99d9821 (a cut stream no longer hangs a late-booting client, `solid.dev.js:1195-1209`),
  web 551ef0d (concurrent `renderToStream` restores `sharedConfig.context`), babel-plugin d815fd4 (a
  braceless `if … return <el>` claimed a node for the branch not taken). The binding's computations
  are `transparent` and client-only, and its one `latest()` read runs in a component body, not a
  served pass, so these reach the Solid 2 apps' hydration rather than the binding. The only braceless
  `if … return <JSX>` in Solid 2 code is `solid/test/v2/reorder-scene.tsx:256`, which returns a
  component and has no template setup to hoist.
- **`latest`** (9c4e4a8, 42924f4, edd3c44, 061b013, 60d6307, 343f007, 2ba10bd, 74126b1, 663ecb0, bb7f9b5,
  64fedc7, 4a4803c; the body of `latest` itself is identical). **Reached by the #335 setup read**
  (`config-view.ts:154`):
  - 84353de: inside a verdict window, a non-keyed `<Show>`/`<Match>` accessor no longer re-checks its
    condition for a branch mounted in the flush its condition landed in (`solid.dev.js:1633`, `:1681`).
    That is #335's case, a ward set up in such a branch.
  - edd3c44: a memo first pulled inside `latest()` computes as its own pass, as an app's async config
    memo is there.
  - Covered by `solid/test/v2/in-flight-setup.browser.test.tsx`.
- **`isPending`** (1445197, ab3d2ad, 7135a77, b5077ea, 66c6f56, 6af149e, 643a7a7, ef0aadd, 749b0d7,
  fda83a3, 87f3446; its body changed in `dev.js`). The binding doesn't call it: its docs and tests do,
  as `isPending(() => card.settled())` / `tapped()`. The D-8 "writes that net to the committed value"
  changes can't reach `settled()`/`tapped()`. Their count signals only grow (set from a microtask,
  compared with the landed count: `lifecycle.ts:600-609`, `:484-492`), and their first value is sync,
  so 643a7a7/ef0aadd's "first answer in the same tick" doesn't arise.
- **`onFlush`:** no release note; its body is identical (`dev.js`). Used by the storefront's
  `saved/Demo.tsx:57` and the site's `Layout.tsx:143`, not the binding.
- **`createOptimistic`:** above. Also keyed-list and re-base fixes (5f07d04, ecf3011, 885b99b, ab5b5cb,
  efd7f7d, d9aa8f7, 6ec1613, 8a8e950, c8d6fd2, 4f9768f, 64625bc, 718ec9c) for the storefront's
  optimistic demos.
- **`<Loading>`/`<Errored>`** (97e1826, 62bf4c4, 2c9a1e3, 061b013, 6e569c7, f53d927, 663ecb0, b773146,
  4235019, 39f951b, dd5f9d1, 19e0951, 3a73a36, ceb7896, a56b10b): the binding has no boundary; the apps
  do.
- **`mapArray`/`<For>`:** eed4469 skips `setSignal` for a row already holding its item, with a `keyed`
  function or `keyed: false` (`updateKeyedMap`, `dev.js:4230`). Neither the binding nor its tests use
  those forms; the storefront's `notifications/Demo.tsx:55` (`keyed={(notice) => notice.id}`) does.
  2ba429b and 592a43b concern held lanes; d9a97d0 is a diagnostic.
- **`untrack`** (f8080f3, `dev-shared.js:5842-5866`): in a component body, a plain `untrack(fn)` that
  reads a pending async memo the same body made now throws `PENDING_ASYNC_UNTRACKED_READ`. The check
  is `strictPending && owner._parent === context` (`:6143-6147`). `setupOf` runs with `context` null,
  so an owned memo never matches: **not reached**. 2abf27d: dev-only, a labelled `untrack`.
- **`sync` computations** (`CLIENT_ONLY_SYNC`, `solid-reactivity.ts:38-40`; `variant-node.ts:244-288`,
  `ward.tsx:1603`, `:1702`): the prod fast arm is unchanged (`prod/core/core.js:319`, rc.20 `:308`).
  In dev, the general arm, and with it the `CAUGHT_REACTIVE_READ` check, now runs for sync nodes too
  (`dev-shared.js:4811-4816`). `SYNC_NODE_RECEIVED_ASYNC` is unchanged.
- **`defer: true` effects** (`CLIENT_ONLY_DEFERRED` and `CLIENT_ONLY_SYNC_DEFERRED`: every watch,
  `solid-reactivity.ts:61-70`; `ward.tsx:1055`, `:1603`, `:1621`, `:1645`, `:1660`, `:1734`;
  `layout.tsx:79`; `live-value.tsx:74`, `:145`; `reorder.tsx:400`; `create-batch.tsx:242`;
  `batch-reorder-group.tsx:303`). **Reached:**
  - 65da5de: `defer` now skips the first run when a held update (an action, a transition) mounts the
    effect. Before, that first run happened; the binding means to skip it.
  - 689347f: such an effect keeps its first value as the next `prev`.
  - 64625bc: effects an optimistic guess mounts honour `defer`.
- **`createTrackedEffect`** (7ea8706, aeca8da): the binding's one is `onSettledClientOnly`
  (`solid-reactivity.ts:52`), which reads untracked. With no dependencies it doesn't reach;
  "`onSettled` stays one-shot".
- **`moveBefore`:** no release note, and `@solidjs/web`'s client diff doesn't touch it
  (`web.dev.js:104-108`).
- **Stores** (456e6d5): a store proxy now wraps an empty object; `Object.freeze` on a store throws
  (Wardic freezes none). `$PROXY in store` is still `true` (`prod/store/store.js:1644`), so
  `plainOrder` (`solid/src/reorder-values.ts:18`) and `gesturelessOf` (`element.tsx:474`) are
  unaffected, and `plainOrder`'s copy of a store gets faster key listing.
- **Dev attribution** (f509fe3): comparing memo outputs and list items no longer calls property
  getters. Wardic's views carry getters (`config-view.ts:108-116`, a Reorder group's `style` at
  `reorder.tsx:410`); dev and observe only.
- `getContext` with no owner returns the context's default in production (9034647); Wardic reads its
  context under owners. Hot reload (0d4c5e0). Size-only changes (62745f6, e44f824, f0471e8).

### `@solidjs/web` rc.21 beyond the above

- Client (`web.dev.js`): 62745f6 refactors with no behaviour change. 32163a9 settles a released
  stylesheet's pending load (`:1355`). Wardic's `useHead` is an inline Appear `<style>`
  (`provider.tsx:267`, `ward.tsx:2002`), not a stylesheet link, so it doesn't reach.
- Server: 6262453 has `ssrElement` join a spread element's compiled dynamic child in place, with
  "byte-identical" output. Every spread element Wardic renders on a server goes through it, and the
  `*.ssr`/hydration suites would show a difference. 5ae39fc and ccfc7ea (`renderToStream` failures and
  abort), 6b6b4da (`fetchpriority="low"` on non-entry modulepreloads), b656418, b7e4f16, 3c47d06,
  bb51da6 (server functions, `AssetManifest`) reach the apps only.

### `@solidjs/router` `2.0.0-next.44`

Peers `solid-js`/`@solidjs/web` `^2.0.0-rc.19`. d034252 (`createRoot` for the route root) reaches
every routed app and `route-transitions.browser.test.tsx`, with no behaviour change per its note.
**Not reached:** b23cdc7 and e29aeda (nothing sets a router `base`), aa5e4be (the storefront's
`revalidate(key)` calls are client calls, not single-flight `revalidate: "*"` responses), 10452bd (no
route `preload`).

### `@solidjs/vite-plugin` `3.0.0-next.55`–`57`

- **next.55:** 4deb52e keeps build metadata out of the client output (the manifest is turned off
  again, `.vite/solid-server-functions.json` moves to the server output). **Reached:** the site's
  deploy uploads `site/dist/client` (`.github/workflows/site.yml:81`), which no longer carries them.
  97e37f1: built with Rolldown.
- **next.56:** 18c7144 and 6de699a share one plugin instance across environment builds; all four
  start builds. 3cb10dd precompresses `start.nodeServer`'s client build (`.br`/`.gz` for text ≥ 1 KiB):
  **reached** by `examples/solid2-start/vite.config.ts:16` (`nodeServer: true`).
- **next.57:** a3c76c2's dev toolbar turns on only when `@solidjs/start-devtools` is installed (its
  `devtools` option, default `undefined`), and it isn't, so it doesn't reach. 75a5876 makes Babel an
  optional peer. The apps use the default native compiler (no `compiler: 'babel'`), and
  `packages/solid` pins `@babel/core` and `@solidjs/babel-plugin` itself (`vite.solid2.ts:15`).

## Checked

On the branch, against `main` at `441599b` (Effect 4.1.1, Solid rc.20):

- **Typecheck** (TS 7: every package, example and the site) **and lint:** clean, once `element.tsx` used
  `createRoot` and CO1 listed it.
- **Unit and server-render:** 1,877 / 1,877.
- **Browser** (dom, both bindings, both hydration projects, under #320's gate, which fails on both new
  codes): 2,636 / 2,636. A second run: 2,635, as RT7's throw measured 375 px/s, short of the 500 px/s
  its check needs, under the suite's load; the file alone passed 6 of 6. Neither run re-optimized
  dependencies. The guards by name (`refresh-frame-clock`, `next-microtask`, `clock-cold-start`,
  `layout-id-scroll`) are among them.
- **The storefront smoke:** 59, 61 and 59 routes (Solid 1, Solid 2, Next). The Solid 2 app's dev smoke:
  61 / 61, with no coded diagnostic. Its first run met Vite's `504 (Outdated Optimize Dep)` on `/`
  while the dev server re-optimized for the new versions; the second was clean.
- **The start examples:** `solid2-start` and `solid-start-basic` build, and `/`, `/appear` and `/ssr`
  load with nothing logged. `/appear`'s hand check: Solid 1 33 / 33 in every mode, and in its "at once"
  mode on 5 freshly started servers. Solid 2: 33 / 33 in every mode on a warm server. On a freshly
  started one, "at once" missed 3 of 11 times, against `main`'s 0 of 8: tile0 and the Batch Reorder
  group's four items, whose Handoff waits for its lazily loaded code (#706), so the report saw too few
  frames of their CSS to see it move. Over 12 fresh servers each, the frames between hydration and the
  Handoff are the same on both: hydration to mount 35 and 38 ms, the Handoff at 56 and 56.5 ms, the
  longest gap 17 ms (33 at most). None stepped at its Handoff or kept its CSS animation.
- **The site** builds and prerenders on next.57, whose client output has no `.vite/manifest.json`:
  nothing of the site's reads it.
- **`bun run pack:check`:** 37 / 37. Its fixtures install 4.1.4 and rc.21 from the registry.
- **`bun run size --base origin/main`:** every app +0.0% to +0.4% gzipped, all ok; `effect`'s share
  +0.8 KB minified. `s1-slim`'s and `s2-slim`'s budgets fail as they do on `main`.
- **`bun run bench:core --base origin/main`** (`main` on its own install, so it crosses the bump): every
  workload ok in Bun, Node and Chromium. The noise control read −0.2%, −0.2% and −1.5%; Node's bytes
  per frame are level (`ticksOnly` 1.34 → 1.35 MB). The run loop's rewritten yield costs nothing
  measured.
- **`bun run bench:solid --base origin/main`:** every gate passes on both bindings. Warm, Solid 1:
  mount −1.0%, Retarget +0.2%, at-rest Retarget +0.0%, unmount −0.4%; Solid 2: +1.2%, −0.2%, −0.6%,
  −0.2%. Bytes +0.3% and +0.6%; retained level; the layout scenes within noise.

## Not checked

- `@solidjs/compiler@2.0.0-rc.21`: no notes, and the native binary wasn't diffed.
- The `isPending`/`latest`/optimistic entries were read from the notes and judged against the
  binding's call sites; they weren't diffed line by line in `@solidjs/signals`.
- A write before an optimistic demo's list loads (the storefront's `cart-drawer`, `wishlist`): its
  routes load clean in the dev smoke, but no test writes before the load.
- The layout lab's side-by-side check (#503 ran it for 4.1.1). The timing internals it reads are
  unchanged at 4.1.4 but for the run loop's yield, which `bench:core` covers.
- Firefox and Safari.
