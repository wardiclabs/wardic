import { cleanup, render } from "@solidjs/testing-library"
import * as FrameLoop from "@wardic/core/FrameLoop"
import * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import { DomLive } from "@wardic/dom"
import * as DomAnnouncer from "@wardic/dom/DomAnnouncer"
import * as DomClock from "@wardic/dom/DomClock"
import * as DomInput from "@wardic/dom/DomInput"
import * as DomPositionalKeys from "@wardic/dom/DomPositionalKeys"
import * as DomProbe from "@wardic/dom/DomProbe"
import * as DomRenderer from "@wardic/dom/DomRenderer"
import * as Report from "@wardic/dom/Report"
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
    DomClock.layer,
    Layer.effect(InterpolatorRegistry.InterpolatorRegistry)(InterpolatorRegistry.InterpolatorRegistry.useSync(breaking)).pipe(
      Layer.provide(InterpolatorRegistry.layer),
    ),
    DomRenderer.layer,
    DomInput.layer,
    DomProbe.layer,
    DomPositionalKeys.layer,
    DomAnnouncer.layer,
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

  it("the spine's leg, on a transition core rejects (#66): each leg fails alone, reported naming the field; the element beside it animates", async () => {
    const logs: Array<Logged> = []
    const reports: Array<string> = []
    const [stiffness, setStiffness] = createSignal(-1)
    const [opacity, setOpacity] = createSignal(1)
    const { container } = render(() => (
      <WardicProvider env={envWith({ logs, reports })}>
        <wardic.div data-bad initial={{ opacity: 0 }} animate={{ opacity: opacity() }} transition={{ stiffness: stiffness() }}>
          b
        </wardic.div>
        <wardic.div data-good initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          g
        </wardic.div>
      </WardicProvider>
    ))
    const bad = container.querySelector<HTMLElement>("[data-bad]")!
    const good = container.querySelector<HTMLElement>("[data-good]")!
    await until(() => opacityOf(good) === 1 && reports.length > 0)
    expect(opacityOf(good)).toBe(1)
    expect(opacityOf(bad), "its leg never stepped").toBe(0)
    const failed = errorsNamed(logs, "wardic.spine: a leg failed")
    expect(failed.length).toBeGreaterThanOrEqual(1)
    expect(failed[0]!.cause).toContain("stiffness")
    expect(reports).toHaveLength(failed.length)
    expect(reports.every((message) => message.includes("stiffness"))).toBe(true)
    // Its next Retarget, on a transition core takes, animates.
    setStiffness(170)
    setOpacity(0.5)
    await until(() => opacityOf(bad) === 0.5)
    expect(opacityOf(bad)).toBe(0.5)
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

  it("presence's onExitComplete (#257): one that throws is logged at Error with its cause, reported once, and the presence goes on", async () => {
    const logs: Array<Logged> = []
    const reports: Array<string> = []
    const [shown, setShown] = createSignal(true)
    const { container } = render(() => (
      <WardicProvider env={envWith({ logs, reports })}>
        <AnimatePresence
          onExitComplete={() => {
            throw new Error("the app's onExitComplete broke")
          }}
        >
          <Show when={shown()}>
            <wardic.div data-leaving initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ type: "tween", duration: 0.1 }}>
              x
            </wardic.div>
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    await until(() => opacityOf(container.querySelector<HTMLElement>("[data-leaving]")!) === 1)
    setShown(false)
    await until(() => reports.length > 0)
    const failed = errorsNamed(logs, "wardic.presence: onExitComplete failed")
    expect(failed).toHaveLength(1)
    expect(failed[0]!.cause).toContain("the app's onExitComplete broke")
    expect(reports).toEqual(["the app's onExitComplete broke"])
    expect(container.querySelector("[data-leaving]"), "removed").toBeNull()
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

  /** A drag of `el` from x `from` to `to`, released there. */
  const dragOf = async (el: HTMLElement, from: number, to: number): Promise<void> => {
    const pointer = (type: string, x: number, buttons: number) =>
      new PointerEvent(type, { clientX: x, clientY: 0, buttons, pointerId: 1, pointerType: "mouse", isPrimary: true })
    await retryGesture(
      () => {
        el.dispatchEvent(pointer("pointerdown", from, 1))
        el.dispatchEvent(pointer("pointermove", to, 1))
      },
      () => el.dispatchEvent(pointer("pointerup", to, 0)),
      () => el.style.transform.includes(`translateX(${to}px)`),
    )
    el.dispatchEvent(pointer("pointerup", to, 0))
  }

  it("drag's release: one that steps a NaN fails with CheckFrames on, alone, and is reported", async () => {
    const logs: Array<Logged> = []
    const reports: Array<string> = []
    const { container } = render(() => (
      <WardicProvider env={envWith({ logs, reports, checkFrames: true })}>
        <wardic.div data-drag drag="x" dragSnapToOrigin dragTransition={{ modifyTarget: () => Number.NaN }} style={{ width: "40px", height: "40px" }}>
          d
        </wardic.div>
      </WardicProvider>
    ))
    const el = container.querySelector<HTMLElement>("[data-drag]")!
    await raf()
    // The release, which springs back to the origin: its target, so its steps, are NaN.
    await dragOf(el, 0, 40)
    await until(() => reports.length > 0)
    const failed = errorsNamed(logs, "wardic.drag: a release failed")
    expect(failed).toHaveLength(1)
    expect(failed[0]!.cause).toContain("NonFiniteFrame")
    expect(reports).toHaveLength(1)
    expect(reports[0]).toContain("a non-finite Frame")
    expect(errorsNamed(logs, "wardic.runScoped: a fiber failed"), "the track goes on").toEqual([])
  })

  it("drag's release, on a drag transition core rejects (#66): reported, the element rests where dropped, and the next drag drags", async () => {
    const logs: Array<Logged> = []
    const reports: Array<string> = []
    const { container } = render(() => (
      <WardicProvider env={envWith({ logs, reports })}>
        <wardic.div data-drag drag="x" dragSnapToOrigin dragTransition={{ bounceStiffness: Number.NaN }} style={{ width: "40px", height: "40px" }}>
          d
        </wardic.div>
      </WardicProvider>
    ))
    const el = container.querySelector<HTMLElement>("[data-drag]")!
    await raf()
    await dragOf(el, 0, 40)
    await until(() => reports.length > 0)
    const failed = errorsNamed(logs, "wardic.drag: a release failed")
    expect(failed).toHaveLength(1)
    expect(failed[0]!.cause).toContain("bounceStiffness")
    expect(reports).toHaveLength(1)
    await raf()
    await raf()
    expect(el.style.transform, "where it was dropped, not back at the origin").toContain("translateX(40px)")
    // The track goes on: the next drag drags from there, and its release fails alone too.
    await dragOf(el, 40, 80)
    await until(() => reports.length > 1)
    expect(reports).toHaveLength(2)
    expect(el.style.transform).toContain("translateX(80px)")
    expect(errorsNamed(logs, "wardic.runScoped: a fiber failed")).toEqual([])
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
        Effect.die(new Error("reported twice")).pipe(Effect.tapCause((cause) => Report.failure("test.inner: failed", cause))),
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
