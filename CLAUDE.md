# Wardic

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `wardiclabs/wardic`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, using the default label strings. See `docs/agents/triage-labels.md`.

### Effect-first code

Code follows the Effect-first rules: Effect's modules over vanilla TypeScript (loops, checks, missing values), no ternary operators, and allocation-free forms on the per-frame path. See `docs/agents/effect-first.md` and ADR-0025.

### Pipeable core API

Core's API is organised the way Effect's is: a module per data type (`@wardic/core/<Module>`), `Pipeable` data types, `dual` operations, and positional functions on the per-frame path. See `docs/agents/pipeable.md` and ADR-0028. `@wardic/dom` follows it too, for binding authors: `@wardic/dom/<Module>`, the DOM's service implementations `Dom`-prefixed with their `layer` (ADR-0041).

### Library skills

`.claude/skills/` holds the agent skills Wardic's libraries ship, copied from the installed versions by `bun run skills` (`scripts/sync-agent-skills.ts`). Rerun it after bumping Solid 2 or Effect; don't edit the copies.

- **Solid 2:** `solid-2.0` (the primer), `solid-2.0-cheatsheet`, `reactivity-diagnostics`, `server-components` (`@solidjs/web`'s) and `agent-loops` (`@solidjs/diagnostics`', a devDependency of packages/solid, for evidence from its `captureArtifact` in tests). Here, Solid 2 is installed as `solid-js-2` in packages/solid, and the root's `solid-js` is Solid 1: where a skill says `node_modules/solid-js/`, read `packages/solid/node_modules/solid-js-2/`.
- **Effect 4:** `effect-4`, the package's own `AGENTS.md`. Effect ships no other skill.

### Domain docs

Multi-context: a root `CONTEXT-MAP.md` pointing at per-package `CONTEXT.md` files. See `docs/agents/domain.md`.
