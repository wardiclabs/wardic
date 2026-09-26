# Upgrade targets: Effect 4 RC and Solid 2

> **Status (2026-09-26): intent only, not scheduled.** This records two upgrades Wardic
> is committed to making. Neither has started, so treat everything below as a
> starting point, not a plan. Re-check every upstream fact here before acting on it:
> both lines are moving weekly.

Wardic will:

1. **Move off the Effect v4 beta onto the Effect 4 release-candidate line**, and follow it to
   4.0.0 stable.
2. **Ship a Solid 2 build of the Solid binding**, targeting the Solid 2.0 release candidates
   and then 2.0 stable.

## 1. Effect: `4.0.0-beta.71` → the 4.0 RC line

### Where we are

Every package pins `effect` **exactly** at `4.0.0-beta.71`: `@wardic/core`, `@wardic/dom`,
`@wardic/test` and `@wardic/solid` (peer and dev), plus the root. `@effect/vitest` is pinned
to the same exact version.

### Upstream, as of 2026-09-26

From the npm registry (`npm view effect dist-tags` / `time`):

| | Version | Published |
|---|---|---|
| Our pin | `4.0.0-beta.71` | 2026-05-27 |
| Last beta | `4.0.0-beta.107` | 2026-08-10 |
| First RC | `4.0.0-rc.108` | 2026-08-12 |
| `rc` tag | `4.0.0-rc.117` | 2026-09-21 |
| `latest` tag | `3.22.2` | (v4 is not stable yet) |

So we are 36 betas and 10 RCs behind. RC numbering continues from the beta sequence.
`@effect/vitest` publishes in lockstep: its `rc` tag is also `4.0.0-rc.117`.

### Where the upgrade will bite

- **`effect/unstable/reactivity`.** 11 source files import it. `unstable` is a
  no-stability-guarantee namespace, so check it first on any bump:
  `core/src/services/{Clock,Probe}.ts`, `core/src/util/reduced-motion.ts`,
  `dom/src/{clock,index,probe}.ts`, `solid/src/{bridge.ts,provider.tsx}`,
  `test/src/{clock,layer,probe}.ts`.
- **Service definitions** (`Context.Service`), Layers, `ManagedRuntime` and `Stream`, i.e. the
  whole ADR-0001 stream contract and the service graph.
- **The test runner.** `@effect/vitest` must move in lockstep with `effect`, including the
  `it.effect` / `it.layer` patterns.
- **`.reference/effect-smol`** (the local, uncommitted Effect source copy) is at
  `4.0.0-beta.71`. Refresh it to the target version before reading source to settle a question.

### Constraints to keep

- Exact pins (no `^`) while Effect is pre-1.0-of-v4. `effect` and `@effect/vitest` move together.
- The observability convention (`wardic.*` spans, annotated debug logs) must survive unchanged.

### Not yet researched

- The changelog between `beta.71` and the current RC: what breaks, what's renamed, and whether
  `unstable/reactivity` moved or stabilised.
- Whether a stable `4.0.0` date has been announced.

## 2. Solid 2 build of `@wardic/solid`

### Where we are

`@wardic/solid` peers and devs `solid-js ^1.9.13`. The SolidStart example uses
`solid-js ^1.9.13`, `@solidjs/start ^1.3.2` and `@solidjs/router ^0.16.1`. Tests use
`@solidjs/testing-library ^0.8.10` and `vite-plugin-solid ^2.11.12`. The binding also depends
on `@solid-primitives/refs ^1.1.3`.

### Upstream, as of 2026-09-26

From the npm registry:

| Package | `latest` | Pre-release tag |
|---|---|---|
| `solid-js` | `1.9.15` (2026-08-17) | `next` = `2.0.0-rc.9` (2026-09-18); first RC `2.0.0-rc.0` (2026-08-12) |
| `@solidjs/testing-library` | `0.8.10` | `next` = `1.0.0-beta.3`, which peers **`solid-js >=2.0.0-0`** and **`@solidjs/web >=2.0.0-0`** |
| `vite-plugin-solid` | `2.11.14` (peers `solid-js ^1.7.2`) | `next` = `3.0.0-next.27` |
| `@solidjs/start` | `2.0.5` | |

The `@solidjs/testing-library@next` peer list suggests Solid 2 splits the web renderer
(today's `solid-js/web`) into a separate **`@solidjs/web`** package. That is an inference from
peer dependencies, not verified against Solid's docs.

### Where the upgrade will bite

The core/binding boundary (ADR-0004) keeps Solid confined to `@wardic/solid`. `@wardic/core`
and `@wardic/dom` (including the projection engine) import nothing from Solid. The binding
imports these Solid APIs across 10 files (`bridge.ts`, `directive.ts`, `gate.ts`,
`layout.tsx`, `presence.tsx`, `provider.tsx`, `sensors.ts`, `use-wardic.tsx`,
`variants.ts`, `wardic.tsx`):

- **Reactivity:** `createSignal`, `createMemo`, `createEffect`, `on`, `untrack`, `batch`, `from`
- **Lifecycle:** `onMount`, `onCleanup`
- **Context:** `createContext`, `useContext`
- **Components and props:** `splitProps`, `children`, `createUniqueId`, `Component`, `JSX`,
  `Accessor`, `Dynamic` (from `solid-js/web`)

Two places carry timing guarantees that must be re-proven under Solid 2, not just re-typed:

- **`gate.ts`** applies every frame's writes inside one `batch()`. The gate's same-frame
  guarantee (measure → write in one rAF callback, PR #11; issue #2's rAF-vs-microtask
  question) depends on `batch` flushing synchronously.
- **The reactive bridge (ADR-0006)**, the per-element Stream→signal bridge that `gate.ts`
  flushes. Its signal sinks assume a signal write set inside that `batch()` reaches the DOM
  before the frame paints. If Solid 2 defers updates, that assumption breaks.

### Decisions still open

- **Packaging.** A separate package, a new major of `@wardic/solid`, or one package
  supporting both. This is not decided yet.
- **Which Solid version v0.1 ships against.**
- **Sequencing against the Effect upgrade.** The two are independent in code (Effect runs under
  every package; Solid only under the binding). Lean: do Effect first, so the Solid 2 binding
  isn't built on a beta that is about to change underneath it.

### Not yet researched

- Solid 2's actual API changes: effect timing, `batch`, stores, context, the `@solidjs/web`
  split, SSR/hydration.
- Solid 2 support in `vite-plugin-solid@next`, `@solid-primitives/refs` and `@solidjs/router`.

## Sources

All registry facts were read on 2026-09-26 with `npm view <pkg> dist-tags`, `npm view <pkg> time`
and `npm view <pkg>@<tag> peerDependencies`. Codebase facts (pins, import sites) come from this
repo's `package.json` files and `packages/*/src` at the commit that adds this document.
