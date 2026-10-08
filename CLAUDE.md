# Wardic

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `wardiclabs/wardic`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, using the default label strings. See `docs/agents/triage-labels.md`.

### Effect-first code

Code follows the Effect-first rules: Effect's modules over vanilla TypeScript (loops, checks, missing values), no ternary operators, and allocation-free forms on the per-frame path. See `docs/agents/effect-first.md` and ADR-0025.

### Domain docs

Multi-context: a root `CONTEXT-MAP.md` pointing at per-package `CONTEXT.md` files. See `docs/agents/domain.md`.
