import { DragActivity, FrameLoopLive, InterpolatorRegistryLive, makeDragActivity } from "@wardic/core"
import type { Clock, FrameLoop, InputSource, InterpolatorRegistry, Probe, Renderer } from "@wardic/core"
import * as Layer from "effect/Layer"
import { AtomRegistry } from "effect/reactivity"
import * as TestClock from "./clock.ts"
import * as TestInput from "./input.ts"
import * as TestProbe from "./probe.ts"
import * as TestRenderer from "./renderer.ts"

/**
 * The full headless environment: deterministic Clock (driven by `frames`),
 * recording Renderer, static Probe, silent InputSource, core's real
 * interpolator registry, a fresh AtomRegistry for reading Probe atoms
 * (`viewport`, `prefersReducedMotion`), and a fresh Drag activity, so one test's
 * drag never blocks another's hover or press (ADR-0019), and core's Frame loop over that
 * Clock (ADR-0027). Provide this in place of `DomLive` to test animation code without a
 * browser.
 */
export const testLayer = (
  frames: ReadonlyArray<number> = [],
): Layer.Layer<Clock | FrameLoop | Renderer | Probe | InputSource | InterpolatorRegistry | AtomRegistry.AtomRegistry> =>
  FrameLoopLive.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        TestClock.layer(frames),
        TestRenderer.layer,
        TestProbe.layer(),
        TestInput.layer(),
        InterpolatorRegistryLive,
        AtomRegistry.layer,
        Layer.sync(DragActivity, makeDragActivity),
      ),
    ),
  )

/** `testLayer()` with an empty clock — for tests that drive their own frames. */
export const TestLive = testLayer()
