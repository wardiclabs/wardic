/**
 * @wardic/core — the framework-agnostic animation engine.
 *
 * Implemented (docs/plans/v0.1.md implementation order, steps 2–7):
 *   - The five service contracts (`Clock`, `Renderer`, `InputSource`, `Probe`,
 *     `InterpolatorRegistry`); environments provide the Layers. Core also ships
 *     the shared Refresh-frame Clock constructor, `makeRefreshFrameClock`, that
 *     every Environment's Clock is built from.
 *   - The interpolation registry's built-in interpolators (number, array, color
 *     via culori, unit-string) and pure easings + math utilities.
 *   - The animation primitives — `tween`, `spring`, `decay`, `animate`,
 *     `keyframes`, plus the multi forms `animateValues` / `springValues`.
 *   - The utility surface: `velocityOf`, `stagger`, `group`, `onFrame`,
 *     `onSettle`, `delay`, `wait`, `noise`, `pulse`, `wave`.
 *
 * Each primitive returns a `Stream` driven by `Clock.ticks` rather than the
 * `Atom`-returning shape the original plan described — see ADR-0001 in
 * `docs/adr/` for the rationale. Design decisions and project glossary live in
 * `CONTEXT.md` and `docs/adr/`; built on `effect` v4 and its in-core reactivity
 * at `effect/unstable/reactivity`.
 */
export const VERSION = "0.1.0-alpha.0"

export * from "./services/index.ts"
export * from "./options.ts"
export * from "./math/index.ts"
export * from "./easing/index.ts"
export * from "./interpolate/index.ts"
export * from "./springs.ts"
export * from "./primitives/index.ts"
export * from "./recognizers/index.ts"
export * from "./util/index.ts"
export * from "./layout/index.ts"
export * from "./override.ts"
export * from "./reorder/index.ts"
