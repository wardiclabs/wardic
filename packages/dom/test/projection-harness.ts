// A fake-sink harness for projection engine tests (the pattern of
// projection-drag.browser.test.ts): requestAnimationFrame is stubbed before the runtime
// builds, so the test fires Refresh frames by hand; ResizeObserver is a no-op, so every
// Measure pass comes from `notify` (or the engine's own resize handling). Call
// `stubFrames()` in a `beforeEach` and `unstubFrames()` in an `afterEach`.
import * as Projection from "@wardic/core/Projection"
import * as Bool from "effect/Boolean"
import type * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as References from "effect/References"
import * as Scheduler from "effect/Scheduler"
import * as Tracer from "effect/Tracer"
import * as UndefinedOr from "effect/UndefinedOr"
import { vi } from "vitest"
import { DomLive, WardicSpans } from "@wardic/dom"
import * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import * as internalProjection from "../src/internal/projection.ts"

type FrameCallback = (t: number) => void

let pendingFrames = new Map<number, FrameCallback>()
let nextHandle = 1
let frameTime = 1000

export const stubFrames = (): void => {
  pendingFrames = new Map()
  nextHandle = 1
  frameTime = 1000
  vi.stubGlobal("requestAnimationFrame", (cb: FrameCallback) => {
    const handle = nextHandle++
    pendingFrames.set(handle, cb)
    return handle
  })
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
    pendingFrames.delete(handle)
  })
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  )
}

export const unstubFrames = (): void => {
  vi.unstubAllGlobals()
}

/** Fire every pending Refresh frame `ms` after the last one: a stall, when it's longer than a frame (#23). */
export const fireFrameAfter = (ms: number): void => {
  frameTime += ms
  const callbacks = [...pendingFrames.values()]
  pendingFrames.clear()
  for (const cb of callbacks) cb(frameTime)
}

/**
 * Fire every pending Refresh frame at the next timestamp (one nominal interval later). Synchronous: a
 * browser runs the frame's microtasks before any later task, which closes the Frame loop's Late window
 * (ADR-0027 *Amendment (#680)*), so a test acting as a task after a frame awaits `endOfTask()` first.
 */
export const fireFrame = (): void => fireFrameAfter(1000 / 60)

/** Fire `n` Refresh frames. */
export const fireFrames = (n: number): void => {
  for (let i = 0; i < n; i++) fireFrame()
}

/** Every microtask queued so far (and the ones they queue) has run; no timer has. */
export const endOfTask = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

/** Wait `ms` of real time (timers and browser events run). */
export const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** One projection write the fake sink saw: the translate, and the whole `@projection` value. */
export interface Write {
  readonly id: string
  readonly tx: number
  readonly ty: number
  readonly sx: number
  readonly sy: number
  readonly value: Record<string, unknown>
  readonly partial: Record<string, unknown>
}

/** The fake sink: records every projection write; `flushPass` just runs the pass. */
export const makeSink = () => {
  const writes: Array<Write> = []
  const sink = {
    write: (id: string, partial: Record<string, unknown>): void => {
      const value = partial[Projection.KEY] as
        | { delta: { x: { translate: number; scale: number }; y: { translate: number; scale: number } } }
        | undefined
      if (value === undefined) return
      writes.push({
        id,
        tx: value.delta.x.translate,
        ty: value.delta.y.translate,
        sx: value.delta.x.scale,
        sy: value.delta.y.scale,
        value: value as unknown as Record<string, unknown>,
        partial,
      })
    },
    flushPass: (pass: () => void): void => pass(),
  }
  return { sink, writes, of: (id: string) => writes.filter((w) => w.id === id) }
}

/** Build the engine over `sink` with a DomLive runtime that records measure spans and debug logs. */
/**
 * An engine over `sink`, on DomLive, with its spans and logs recorded. With `scheduler`, every fiber
 * its runtime runs, DomLive's own included, runs on it (a browser's `setTimeout(0)` one, so a
 * scheduler hop isn't a microtask as the test tier's `setImmediate` polyfill makes it).
 */
export const makeEngine = (sink: ReturnType<typeof makeSink>["sink"], options?: ProjectionSystem.Options, scheduler?: Scheduler.Scheduler) => {
  const spans: Array<Record<string, unknown>> = []
  const logs: Array<{ readonly message: string; readonly annotations: Record<string, unknown> }> = []
  class MeasureSpan extends Tracer.NativeSpan {
    override end(endTime: bigint, exit: Exit.Exit<unknown, unknown>): void {
      super.end(endTime, exit)
      spans.push(Object.fromEntries(this.attributes))
    }
  }
  const tracer = Tracer.make({
    span: (options) =>
      Bool.match(options.name === "wardic.projection.measure", { onTrue: () => new MeasureSpan(options), onFalse: () => new Tracer.NativeSpan(options) }),
  })
  const logger = Logger.map(Logger.formatStructured, (structured) => {
    logs.push({ message: String(structured.message), annotations: structured.annotations })
  })
  const env = UndefinedOr.match(scheduler, {
    onUndefined: () => DomLive,
    onDefined: (on) => DomLive.pipe(Layer.provideMerge(Layer.succeed(Scheduler.Scheduler, on))),
  })
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      env,
      Layer.succeed(Tracer.Tracer, tracer),
      // Wardic's spans, the app's to give (#746).
      WardicSpans,
      Logger.layer([logger]),
      Layer.succeed(References.MinimumLogLevel, "Debug"),
    ),
  )
  const system = internalProjection.makeProjectionSystem(runtime, sink, options)
  return {
    system,
    runtime,
    spans,
    logs,
    dispose: (): void => {
      system.dispose()
      void runtime.dispose()
    },
  }
}

export type Engine = ReturnType<typeof makeEngine>

/** A stage for boxes, removed with `clearStages()`. */
export const stage = (css = "position:relative;width:100%;height:600px"): HTMLElement => {
  const el = document.createElement("div")
  el.dataset.harnessStage = ""
  el.style.cssText = css
  document.body.append(el)
  return el
}

export const clearStages = (): void => {
  document.body.querySelectorAll("[data-harness-stage]").forEach((el) => el.remove())
}

/** An element with `css`, appended to `parent`. */
export const el = (parent: HTMLElement, css: string): HTMLElement => {
  const e = document.createElement("div")
  e.style.cssText = css
  parent.append(e)
  return e
}
