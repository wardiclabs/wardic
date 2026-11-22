/**
 * Development: on. The package's `development` export condition resolves this module, as Foldkit's
 * `DEV` is (#791, Q10); a production build resolves `dev.production.ts`, so a check under `DEV` and
 * what it calls are dropped from it. Tested in a plain `if` or `&&`, never through `Bool`, as a
 * build-time flag is (`docs/agents/effect-first.md`, *Pitfalls*).
 *
 * @module
 */
// #883 (ADR-0073, *Amendment (#883)*, Q6): the shared-material warning's gate.
export const DEV = true
