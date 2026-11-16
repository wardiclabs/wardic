/**
 * Development: on. The package's `development` export condition resolves this module, as Solid's
 * `DEV` is Solid's own condition (#791, Q10); a production build resolves `dev.production.ts`, so a
 * check under `DEV` and what it calls are dropped from it. Tested in a plain `if` or `&&`, never through
 * `Bool`, as a build-time flag is (`docs/agents/effect-first.md`, *Pitfalls*).
 *
 * @module
 */
export const DEV = true
