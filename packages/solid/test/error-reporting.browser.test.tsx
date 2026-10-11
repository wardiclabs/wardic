import { cleanup, render } from "@solidjs/testing-library"
import * as FrameLoop from "@wardic/core/FrameLoop"
import * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import { ClockDomLive, DomLive, InputDomLive, ProbeDomLive, RendererDomLive, reportFailure } from "@wardic/dom"
import { AnimatePresence, useWardicFiber, wardic, type WardicEnv, WardicProvider } from "@wardic/solid"
import type * as Context from "effect/Context"
import { DevTools } from "effect/devtools"
import * as Effect from "effect/Effect"
import * as ErrorReporter from "effect/ErrorReporter"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import * as References from "effect/References"
import { AtomRegistry } from "effect/reactivity"
import { createSignal, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { opacityOf, raf, retryGesture, until } from "./browser-helpers.ts"

/**
 * Failures are reported where they stop (ADR-0030, decision 4; #113): at the bindings' unobserved
 * fibers, each logged at Error with its cause and handed to the app's `ErrorReporter`s, which the
 * app installs on `env`. An interruption is neither. Here every boundary fails for real: a blend
 * that throws, a NaN `CheckFrames` catches, a fiber that dies.
 */

afterEach(() => {
  cleanup()
})

type RegistryShape = Context.Service.Shape<typeof InterpolatorRegistry.InterpolatorRegistry>

interface Logged {
  readonly level: string
  readonly message: string
  readonly cause: string | undefined
}

/** A colour whose blend throws past progress 0: a step that throws, in a leg or an exit. */
const BROKEN = "rgb(1, 2, 3)"
const breaking = (registry: RegistryShape): RegistryShape => ({
  ...registry,
  resolve: (from, to) => {
    if (to !== BROKEN) return registry.resolve(from, to)
    return Effect.succeed((t: number) => {
      if (t > 0) throw new Error("blend broke")
      return from
    })
  },
})

/**
 * `DomLive`, composed as it is with the breaking registry, plus what an app would merge into
 * `env`: a logger appending to `logs`, an `ErrorReporter` appending each reported error's message
 * to `reports`, and, with `checkFrames`, `FrameLoop.CheckFrames`.
 */
const envWith = (options: { readonly logs: Array<Logged>; readonly reports: Array<string>; readonly checkFrames?: boolean }): WardicEnv => {
  const services = Layer.mergeAll(
    ClockDomLive,
    Layer.effect(InterpolatorRegistry.InterpolatorRegistry)(InterpolatorRegistry.InterpolatorRegistry.useSync(breaking)).pipe(
      Layer.provide(InterpolatorRegistry.layer),
    ),
    RendererDomLive,
    InputDomLive,
    ProbeDomLive,
  )
  const environment = FrameLoop.layer.pipe(Layer.provideMerge(services), Layer.provideMerge(AtomRegistry.layer))
  return Layer.mergeAll(
    environment,
    Logger.layer([
      Logger.map(Logger.formatStructured, (s) => {
        options.logs.push({ level: s.level, message: String(s.message), cause: s.cause })
      }),
    ]),
    ErrorReporter.layer([ErrorReporter.make(({ error }) => void options.reports.push(error.message))]),
    Layer.succeed(FrameLoop.CheckFrames, options.checkFrames === true),
  )
}

/** The Error logs named `message`. */
const errorsNamed = (logs: ReadonlyArray<Logged>, message: string): ReadonlyArray<Logged> =>
  logs.filter((log) => log.level === "ERROR" && log.message === message)

describe("each boundary logs a failure at Error and reports it once", () => {
  it("the spine's leg: each failed leg is logged and reported, the defect's message in the report", async () => {
    const logs: Array<Logged> = []
    const reports: Array<string> = []
    const { container } = render(() => (
      <WardicProvider env={envWith({ logs, reports })}>
        <wardic.div data-broken initial={{ opacity: 0, "background-color": "rgb(0, 0, 0)" }} animate={{ opacity: 1, "background-color": BROKEN }}>
          a
        </wardic.div>
      </WardicProvider>
    ))
    const el = container.querySelector<HTMLElement>("[data-broken]")!
    await until(() => opacityOf(el) === 1 && reports.length > 0)
    const failed = errorsNamed(logs, "wardic.spine: a leg failed")
    // One per Retarget that starts the broken leg (a resting real pointer can Retarget it by hover).
    expect(failed.length).toBeGreaterThanOrEqual(1)
    expect(reports).toHaveLength(failed.length)
    expect(reports.every((message) => message === "blend broke")).toBe(true)
  })

  it("presence's exit: logged at Error with its cause, reported, and the node still removed", async () => {
    const logs: Array<Logged> = []
    const reports: Array<string> = []
    const [shown, setShown] = createSignal(true)
    const { container } = render(() => (
      <WardicProvider env={envWith({ logs, reports })}>
        <AnimatePresence>
          <Show when={shown()}>
            <wardic.div data-leaving initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ "background-color": BROKEN }}>
              x
            </wardic.div>
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    const el = container.querySelector<HTMLElement>("[data-leaving]")!
    await until(() => opacityOf(el) === 1)
    setShown(false)
    await until(() => container.querySelector("[data-leaving]") === null && reports.length > 0)
    const failed = errorsNamed(logs, "wardic.presence: an exit failed")
    expect(failed).toHaveLength(1)
    expect(failed[0]!.cause).toContain("blend broke")
    expect(reports).toEqual(["blend broke"])
  })

  it("runScoped, through useWardicFiber: logged at Error with its cause, and reported", async () => {
    const logs: Array<Logged> = []
    const reports: Array<string> = []
    const Dying = () => {
      useWardicFiber(() => Effect.die(new Error("fiber broke")))
      return <div />
    }
    render(() => (
      <WardicProvider env={envWith({ logs, reports })}>
        <Dying />
      </WardicProvider>
    ))
    await until(() => reports.length > 0)
    const failed = errorsNamed(logs, "wardic.runScoped: a fiber failed")
    expect(failed).toHaveLength(1)
    expect(failed[0]!.cause).toContain("fiber broke")
    expect(reports).toEqual(["fiber broke"])
  })

  it("drag's track, through runScoped: a release that steps a NaN fails with CheckFrames on, and is reported", async () => {
    const logs: Array<Logged> = []
    const reports: Array<string> = []
    const { container } = render(() => (
      <WardicProvider env={envWith({ logs, reports, checkFrames: true })}>
        <wardic.div data-drag drag="x" dragSnapToOrigin transition={{ stiffness: Number.NaN }} style={{ width: "40px", height: "40px" }}>
          d
        </wardic.div>
      </WardicProvider>
    ))
    const el = container.querySelector<HTMLElement>("[data-drag]")!
    await raf()
    const pointer = (type: string, x: number, buttons: number) =>
      new PointerEvent(type, { clientX: x, clientY: 0, buttons, pointerId: 1, pointerType: "mouse", isPrimary: true })
    await retryGesture(
      () => {
        el.dispatchEvent(pointer("pointerdown", 0, 1))
        el.dispatchEvent(pointer("pointermove", 40, 1))
      },
      () => el.dispatchEvent(pointer("pointerup", 40, 0)),
      () => el.style.transform.includes("translateX"),
    )
    // The release, which springs back to the origin: its steps are NaN.
    el.dispatchEvent(pointer("pointerup", 40, 0))
    await until(() => reports.length > 0)
    const failed = errorsNamed(logs, "wardic.runScoped: a fiber failed")
    expect(failed).toHaveLength(1)
    expect(failed[0]!.cause).toContain("NonFiniteFrame")
    expect(reports).toHaveLength(1)
    expect(reports[0]).toContain("a non-finite Frame")
  })
})

describe("what isn't a failure, and what reports once", () => {
  it("an interruption reports nothing: Retargets mid-flight, and an unmount", async () => {
    const logs: Array<Logged> = []
    const reports: Array<string> = []
    const [opacity, setOpacity] = createSignal(1)
    const [mounted, setMounted] = createSignal(true)
    const Waiting = () => {
      useWardicFiber(() => Effect.never)
      return <div />
    }
    const { container } = render(() => (
      <WardicProvider env={envWith({ logs, reports })}>
        <Show when={mounted()}>
          <wardic.div data-r initial={{ opacity: 0 }} animate={{ opacity: opacity() }}>
            r
          </wardic.div>
          <Waiting />
        </Show>
      </WardicProvider>
    ))
    const el = container.querySelector<HTMLElement>("[data-r]")!
    for (const next of [0.2, 0.8, 0.4]) {
      await raf()
      setOpacity(next)
    }
    await raf()
    setMounted(false)
    await raf()
    await raf()
    expect(el.isConnected).toBe(false)
    expect(logs.filter((log) => log.level === "ERROR")).toEqual([])
    expect(reports).toEqual([])
  })

  it("a cause that crosses two boundaries reports once: the reporter dedupes it, as it came", async () => {
    const logs: Array<Logged> = []
    const reports: Array<string> = []
    const Twice = () => {
      useWardicFiber(() =>
        Effect.die(new Error("reported twice")).pipe(Effect.tapCause((cause) => reportFailure("test.inner: failed", cause))),
      )
      return <div />
    }
    render(() => (
      <WardicProvider env={envWith({ logs, reports })}>
        <Twice />
      </WardicProvider>
    ))
    await until(() => errorsNamed(logs, "wardic.runScoped: a fiber failed").length === 1)
    expect(errorsNamed(logs, "test.inner: failed")).toHaveLength(1)
    expect(reports).toEqual(["reported twice"])
  })
})

describe("the README's env recipe", () => {
  it("is a WardicEnv: a logger and a level, a reporter, the devtools and CheckFrames, merged beside DomLive", () => {
    const reporter = ErrorReporter.make(() => {})
    const env: WardicEnv = Layer.mergeAll(
      DomLive,
      Logger.layer([Logger.consolePrettyBrowser()]),
      Layer.succeed(References.MinimumLogLevel, "Debug"),
      ErrorReporter.layer([reporter]),
      DevTools.layer(),
      Layer.succeed(FrameLoop.CheckFrames, true),
    )
    expect(Layer.isLayer(env)).toBe(true)
  })
})
