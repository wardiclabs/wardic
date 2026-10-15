import * as Announcer from "@wardic/core/Announcer"
import type * as Clock from "@wardic/core/Clock"
import * as DragActivity from "@wardic/core/DragActivity"
import * as FrameLoop from "@wardic/core/FrameLoop"
import type * as InputSource from "@wardic/core/InputSource"
import * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import type * as Probe from "@wardic/core/Probe"
import * as ReducedMotion from "@wardic/core/ReducedMotion"
import * as RefreshFrameSource from "@wardic/core/RefreshFrameSource"
import type * as Renderer from "@wardic/core/Renderer"
import { constUndefined, constVoid } from "effect/Function"
import * as Layer from "effect/Layer"
import { AtomRegistry } from "effect/reactivity"
import * as TestClock from "./clock.ts"
import * as TestInput from "./input.ts"
import * as TestProbe from "./probe.ts"
import * as TestRenderer from "./renderer.ts"

/**
 * The headless Environment's Refresh frame source: it never calls back, as its Clock never ticks
 * on its own, so a flush gate built on it never flushes by itself. A test that fires frames
 * provides `TestClock.pushable()`'s layer over it (ADR-0031, decision 6).
 */
const stillFrames: RefreshFrameSource.Shape = { requestFrame: constUndefined, cancelFrame: constVoid }

/**
 * The full headless environment: deterministic Clock (driven by `frames`), a Refresh frame
 * source that never calls back, recording Renderer, static Probe, silent InputSource, core's real
 * interpolator registry, a fresh AtomRegistry for reading Probe atoms
 * (`viewport`, `prefersReducedMotion`), and a fresh Drag activity, so one test's
 * drag never blocks another's hover or press (ADR-0019), and core's Frame loop over that
 * Clock (ADR-0027). Provide this in place of `DomLive` to test animation code without a
 * browser.
 */
export const testLayer = (
  frames: ReadonlyArray<number> = [],
): Layer.Layer<
  | Clock.Clock
  | RefreshFrameSource.RefreshFrameSource
  | FrameLoop.FrameLoop
  | Renderer.Renderer
  | Probe.Probe
  | InputSource.InputSource
  | InterpolatorRegistry.InterpolatorRegistry
  | ReducedMotion.PositionalKeys
  | Announcer.Announcer
  | AtomRegistry.AtomRegistry
> =>
  FrameLoop.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        TestClock.layer(frames),
        RefreshFrameSource.layer(stillFrames),
        TestRenderer.layer,
        TestProbe.layer(),
        TestInput.layer(),
        InterpolatorRegistry.layer,
        // The transforms only: the Test Environment names no box keys (ADR-0036).
        ReducedMotion.transformsOnly,
        // No assistive technology to reach headless (ADR-0037).
        Announcer.silent,
        AtomRegistry.layer,
        Layer.sync(DragActivity.DragActivity, DragActivity.make),
      ),
    ),
  )

/** `testLayer()` with an empty clock — for tests that drive their own frames. */
export const TestLive = testLayer()
