/**
 * @wardic/test — headless testing Layers.
 *
 * Provide `TestLive` (or `testLayer(frames)`) in place of `@wardic/dom`'s
 * `DomLive` to run animation code without a browser. The Clock is deterministic
 * (replays a `dt` sequence), so primitive output is collectable frame-by-frame.
 */
export const VERSION = "0.1.0-alpha.0"

export * as TestClock from "./clock.ts"
export * as TestRenderer from "./renderer.ts"
export * as TestProbe from "./probe.ts"
export * as TestInput from "./input.ts"
export * from "./layer.ts"
