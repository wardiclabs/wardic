# Contributing to Wardic

Thanks for wanting to help. This page says where things go, how work moves from an idea to `main`, and what a change has to pass.

- **A question, or an idea taking shape:** [Discussions](https://github.com/wardiclabs/wardic/discussions).
- **A bug, or a feature that's been agreed:** an [issue](https://github.com/wardiclabs/wardic/issues/new/choose), through its form.
- **A security problem:** privately, as [SECURITY.md](SECURITY.md) says.

Everyone here follows the [code of conduct](CODE_OF_CONDUCT.md).

## How work moves

1. **An issue is triaged.** A new one is labelled `needs-triage`, and a maintainer gives it one of the roles in [`docs/agents/triage-labels.md`](docs/agents/triage-labels.md): `needs-info` (waiting on the reporter), `ready-for-human` or `ready-for-agent` (specified and ready), or `wontfix`. A small, self-contained one may also get `good first issue`.
2. **A bigger change is settled in its issue first.** Its open questions are asked and answered there, one at a time, and the decisions are posted as a comment before any code. A decision that's hard to reverse, surprising without its context and the result of a real trade-off gets an ADR in [`docs/adr/`](docs/adr), or an *Amendment* to the ADR it changes.
3. **A pull request settles the issue.** PRs from outside are welcome on issues labelled `ready-for-human` or `good first issue`. For anything else, say in the issue what you'd do, and wait for a yes: it saves work that doesn't fit.

## Setting up

The repo's dev shell has everything at the right versions: Node 24, Bun, the GitHub CLI, and the Chromium the browser tests run on.

```sh
nix develop
bun install
```

Without Nix: Bun (latest), Node 24, then `bun install` and `bunx playwright install chromium`.

The repo runs every package from its source, with no build step: each package's `exports` give `src/` under the `@wardic/source` condition, which the repo's Vite and TypeScript configs turn on (`scripts/wardic-source.ts`). `bun run build` makes what npm gets.

## Where things are

- **`packages/core`:** the engine, on [Effect](https://effect.website): springs, tweens, keyframes, variants, the projection geometry, and the services an environment provides.
- **`packages/dom`:** the browser environment, as Effect Layers.
- **`packages/solid`:** the Solid binding: Solid 1 at the root, Solid 2 under `src/unstable/v2`.
- **`packages/test`:** headless testing Layers.
- **`examples/`:** the storefront showcase (each feature on Solid 1, Solid 2, and Motion for comparison) and the layout lab.
- **`docs/adr/`:** the decisions, with their reasons. **`CONTEXT.md`:** the project's vocabulary.

## The rules the code follows

- **Effect-first** ([`docs/agents/effect-first.md`](docs/agents/effect-first.md), ADR-0025): Effect's modules over plain TypeScript for loops, checks and missing values, no ternaries, and the per-frame and mount paths written for speed, as that page says. `bun run lint` holds most of it.
- **The pipeable API** ([`docs/agents/pipeable.md`](docs/agents/pipeable.md), ADR-0028): a module per data type, `Pipeable` data types, `dual` operations.
- **One Feature's code per module** (ADR-0067): code every page needs never shares a module with a Feature's, so an app ships only the Features it uses.
- **Motion's API, Motion's behaviour.** Wardic follows Motion for React: a prop does what Motion's does, unless an ADR says why not.

## What a change has to pass

Every PR, in CI:

```sh
bun run lint
bun run typecheck
bun run test           # the unit and server-render tests, in Node
bun run test:browser   # the DOM and the bindings, in Chromium
```

As the change needs:

- **`bun run size --base main`,** for any change to a package's `src`: it fails an app whose gzipped size grows more than 1% over `main`'s. It runs in seconds.
- **`bun run bench:core --base main` / `bun run bench:solid --base main`,** for a change on the per-frame path or to an element's mount. Run them on a quiet machine.
- **`bun run pack:check`,** for a change to how the packages build or what they ship: it installs the packed packages into fresh apps and opens them.
- **The storefront smokes,** for a change to the examples: `bun run test:storefront`, and `bun run smoke:dev` in `examples/storefront/solid2` for a change to the Solid 2 binding.

## Commits and pull requests

- **One idea per commit.** A refactor that moves code and a change that alters it are separate commits, so each can be read on its own.
- **A commit's subject names the packages it touches and the issue:** `solid: a drag starts when a lazily loaded drag arrives (#551)`, `core, dom: …`, `docs: …`. Its body says why, and what was measured.
- **A PR's body says** which issue it closes, what changed, what it measured (size, timing) against `main`, and what ran.

## Licence

By contributing, you agree that your contributions are licensed under the [MIT licence](LICENSE), as Wardic is.
