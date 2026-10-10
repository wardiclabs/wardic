import type * as Clock from "@wardic/core/Clock"
import * as DragActivity from "@wardic/core/DragActivity"
import * as FrameLoop from "@wardic/core/FrameLoop"
import type * as InputSource from "@wardic/core/InputSource"
import * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import type * as Probe from "@wardic/core/Probe"
import type * as Renderer from "@wardic/core/Renderer"
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
): Layer.Layer<Clock.Clock | FrameLoop.FrameLoop | Renderer.Renderer | Probe.Probe | InputSource.InputSource | InterpolatorRegistry.InterpolatorRegistry | AtomRegistry.AtomRegistry> =>
  FrameLoop.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        TestClock.layer(frames),
        TestRenderer.layer,
        TestProbe.layer(),
        TestInput.layer(),
        InterpolatorRegistry.layer,
        AtomRegistry.layer,
        Layer.sync(DragActivity.DragActivity, DragActivity.make),
      ),
    ),
  )

/** `testLayer()` with an empty clock — for tests that drive their own frames. */
export const TestLive = testLayer()
