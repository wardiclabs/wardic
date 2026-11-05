import { cleanup, render } from "@solidjs/testing-library"
import { CheckFrames, DomLive } from "@wardic/dom"
import * as Report from "@wardic/dom/Report"
import { AnimatePresence, createHover, type Feature, useWardicFiber, useWardicRuntime, w, wardic, type WardicEnv, WardicProvider } from "@wardic/solid"
import { DevTools } from "effect/devtools"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as ErrorReporter from "effect/ErrorReporter"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import * as References from "effect/References"
import { createEffect, createSignal, ErrorBoundary, onCleanup, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { runWatch } from "../src/provider.tsx"
import { BROKEN, envWith, errorsNamed, type Logged } from "./report-env.ts"
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


describe("each boundary logs a failure at Error and reports it once", () => {
  it("the spine's leg: each failed leg is logged and reported, the defect's message in the report", async () => {
    const logs: Array<Logged> = []
    const reports: Array<string> = []
    // A spring, as frame-loop's "alone" tests: its numbers and its strings are two legs (ADR-0024,
    // D5), so the opacity lands while the colour's leg fails. A tween, every key's Default since
    // #357, runs both on one leg, which the colour ends (#460).
    const { container } = render(() => (
      <WardicProvider env={envWith({ logs, reports })}>
        <wardic.div data-broken initial={{ opacity: 0, "background-color": "rgb(0, 0, 0)" }} animate={{ opacity: 1, "background-color": BROKEN }} transition={{ type: "spring" }}>
          a
        </wardic.div>
      </WardicProvider>
    ))
    const el = container.querySelector<HTMLElement>("[data-broken]")!
    await until(() => opacityOf(el) === 1 && reports.length > 0, 4000, "the opacity landed and the colour's leg reported")
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

  it("a gesture callback (#273): one that throws is logged at Error with its cause, reported once, and the gesture goes on", async () => {
    const logs: Array<Logged> = []
    const reports: Array<string> = []
    let calls = 0
    const { container } = render(() => (
      <WardicProvider env={envWith({ logs, reports })}>
        <wardic.div
          data-hover
          initial={{ opacity: 0.2 }}
          animate={{ opacity: 0.2 }}
          whileHover={{ opacity: 1 }}
          transition={{ type: "tween", duration: 0.05 }}
          onHoverStart={() => {
            calls++
            throw new Error("the app's onHoverStart broke")
          }}
          style={{ width: "40px", height: "40px", "margin-top": "60px", "margin-left": "60px" }}
        />
      </WardicProvider>
    ))
    const el = container.querySelector<HTMLElement>("[data-hover]")!
    await retryGesture(
      () => el.dispatchEvent(new PointerEvent("pointerenter", { pointerId: 1, pointerType: "mouse", isPrimary: true })),
      () => el.dispatchEvent(new PointerEvent("pointerleave", { pointerId: 1, pointerType: "mouse", isPrimary: true })),
      () => calls > 0,
    )
    await until(() => opacityOf(el) === 1)
    expect(opacityOf(el), "whileHover still applies").toBe(1)
    const failed = errorsNamed(logs, "wardic.gesture: onHoverStart failed")
    expect(failed).toHaveLength(1)
    expect(failed[0]!.cause).toContain("the app's onHoverStart broke")
    expect(reports).toEqual(["the app's onHoverStart broke"])
  })

  it("onUpdate (#257 item 4): one that throws every frame is reported at its run's first; a frame it returns ends the run", async () => {
    const logs: Array<Logged> = []
    const reports: Array<string> = []
    // Throws every frame but the fourth.
    let calls = 0
    const { container } = render(() => (
      <WardicProvider env={envWith({ logs, reports })}>
        <wardic.div
          data-update
          initial={{ x: 0 }}
          animate={{ x: 100 }}
          transition={{ type: "tween", duration: 0.3 }}
          onUpdate={() => {
            calls++
            if (calls !== 4) throw new Error(`the app's onUpdate broke at ${calls}`)
          }}
          style={{ width: "40px", height: "40px" }}
        />
      </WardicProvider>
    ))
    const el = container.querySelector<HTMLElement>("[data-update]")!
    await until(() => el.style.transform === "translateX(100px)")
    await raf()
    expect(calls, "told every frame").toBeGreaterThan(6)
    expect(el.style.transform, "the animation goes on").toBe("translateX(100px)")
    expect(reports).toEqual(["the app's onUpdate broke at 1", "the app's onUpdate broke at 5"])
    expect(errorsNamed(logs, "wardic.gate: an onCommit failed")).toHaveLength(2)
  })

  it("onDrag (#257 item 4): one that throws at every move is reported at its run's first; a move it returns ends the run", async () => {
    const logs: Array<Logged> = []
    const reports: Array<string> = []
    // Throws at every call but the fourth; onDragEnd, once a drag, reports each throw.
    let calls = 0
    const { container } = render(() => (
      <WardicProvider env={envWith({ logs, reports })}>
        <wardic.div
          data-drag
          drag="x"
          onDrag={() => {
            calls++
            if (calls !== 4) throw new Error(`the app's onDrag broke at ${calls}`)
          }}
          onDragEnd={() => {
            throw new Error("the app's onDragEnd broke")
          }}
          style={{ width: "40px", height: "40px" }}
        />
      </WardicProvider>
    ))
    const el = container.querySelector<HTMLElement>("[data-drag]")!
    await raf()
    const pointer = (type: string, x: number, buttons: number) =>
      new PointerEvent(type, { clientX: x, clientY: 0, buttons, pointerId: 1, pointerType: "mouse", isPrimary: true })
    await retryGesture(
      () => {
        el.dispatchEvent(pointer("pointerdown", 0, 1))
        el.dispatchEvent(pointer("pointermove", 10, 1))
      },
      () => el.dispatchEvent(pointer("pointerup", 10, 0)),
      () => calls > 0,
    )
    for (let x = 20; x <= 80; x += 10) {
      await raf()
      el.dispatchEvent(pointer("pointermove", x, 1))
    }
    await raf()
    el.dispatchEvent(pointer("pointerup", 80, 0))
    await until(() => reports.includes("the app's onDragEnd broke"))
    expect(calls, "told at every move").toBeGreaterThan(5)
    expect(el.style.transform, "the drag goes on").toContain("translateX(80px)")
    expect(reports).toEqual(["the app's onDrag broke at 1", "the app's onDrag broke at 5", "the app's onDragEnd broke"])
  })

  it("a gesture watch (#318): a throw out of its signal's write, a consumer's effect, is logged at Error with its cause, reported once, and the watch goes on", async () => {
    const logs: Array<Logged> = []
    const reports: Array<string> = []
    const seen: Array<boolean> = []
    let el!: HTMLDivElement
    const Sensor = () => {
      el = (<div data-sensor style={{ width: "40px", height: "40px", "margin-top": "60px", "margin-left": "60px" }} />) as HTMLDivElement
      const hovered = createHover(el)
      // Solid 1 runs this inside the watch's write: its throw comes up through the pointer event's dispatch.
      createEffect(() => {
        seen.push(hovered())
        if (hovered()) throw new Error("the app's effect broke")
      })
      return el
    }
    render(() => (
      <WardicProvider env={envWith({ logs, reports })}>
        <Sensor />
      </WardicProvider>
    ))
    const enter = () => el.dispatchEvent(new PointerEvent("pointerenter", { pointerId: 1, pointerType: "mouse", isPrimary: true }))
    const leave = () => el.dispatchEvent(new PointerEvent("pointerleave", { pointerId: 1, pointerType: "mouse", isPrimary: true }))
    await retryGesture(enter, leave, () => reports.length > 0)
    leave()
    await until(() => seen.at(-1) === false && seen.length > 2)
    const failed = errorsNamed(logs, "wardic.runWatch: a gesture handler failed")
    expect(failed).toHaveLength(1)
    expect(failed[0]!.cause).toContain("the app's effect broke")
    expect(reports).toEqual(["the app's effect broke"])
    expect(seen, "the leave still heard").toEqual([false, true, false])
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

describe("what an owner opened closes, a failure reported, never thrown (#618)", () => {
  it("a Feature whose finalizer fails: the Environment still ends after it, and the failure is logged and reported (decision 4)", async () => {
    const logs: Array<Logged> = []
    const reports: Array<string> = []
    const ended: Array<string> = []
    // The Environment telling when it ends: a Layer beside it whose finalizer records it.
    const watched = Layer.effectDiscard(Effect.addFinalizer(() => Effect.sync(() => void ended.push("environment"))))
    class Breaking extends Context.Service<Breaking, { readonly on: true }>()("test/BreakingFeature") {}
    const breaking: Feature = {
      name: "breaking",
      key: Breaking,
      layer: Layer.effect(Breaking)(
        Effect.as(Effect.addFinalizer(() => Effect.sync(() => void ended.push("feature")).pipe(Effect.andThen(Effect.die(new Error("feature finalizer broke"))))), { on: true as const }),
      ),
    }
    const { unmount } = render(() => (
      <WardicProvider env={Layer.mergeAll(envWith({ logs, reports }), watched)} features={[breaking]}>
        <w.div animate={{ opacity: 0.5 }} />
      </WardicProvider>
    ))
    await raf()
    unmount()
    await until(() => reports.length > 0)
    expect(ended, "the Feature ends first, then the Environment it stands on").toEqual(["feature", "environment"])
    expect(errorsNamed(logs, "wardic.provider: a finalizer failed as it was disposed")).toHaveLength(1)
    expect(reports).toEqual(["feature finalizer broke"])
  })

  it("a watch whose finalizer fails: the rest of its owner's cleanup runs, and the failure is reported (decision 5)", async () => {
    const logs: Array<Logged> = []
    const reports: Array<string> = []
    let after = false
    const Watching = () => {
      // Registered first, so run last: Solid runs an owner's cleanups in reverse.
      onCleanup(() => {
        after = true
      })
      runWatch(useWardicRuntime(), () => Effect.addFinalizer(() => Effect.die(new Error("watch finalizer broke"))))
      return <div />
    }
    const { unmount } = render(() => (
      <WardicProvider env={envWith({ logs, reports })}>
        <Watching />
      </WardicProvider>
    ))
    expect(() => unmount()).not.toThrow()
    expect(after, "the cleanup after it ran").toBe(true)
    await until(() => reports.length > 0)
    expect(errorsNamed(logs, "wardic.runWatch: a finalizer failed")).toHaveLength(1)
    expect(reports).toEqual(["watch finalizer broke"])
  })

  it("a watch that throws as it subscribes leaves nothing subscribed (decision 5)", async () => {
    const logs: Array<Logged> = []
    const reports: Array<string> = []
    let listening = false
    const Throwing = () => {
      runWatch(useWardicRuntime(), () =>
        Effect.acquireRelease(
          Effect.sync(() => {
            listening = true
          }),
          () =>
            Effect.sync(() => {
              listening = false
            }),
        ).pipe(Effect.andThen(Effect.die(new Error("subscribe broke")))))
      return <div />
    }
    render(() => (
      <WardicProvider env={envWith({ logs, reports })}>
        <ErrorBoundary fallback={<p>broke</p>}>
          <Throwing />
        </ErrorBoundary>
      </WardicProvider>
    ))
    await raf()
    expect(listening, "its listener went with the owner the throw ended").toBe(false)
  })
})

describe("the Observability guide's env recipe (#558)", () => {
  it("is a WardicEnv: a logger and a level, a reporter, the devtools and CheckFrames, merged beside DomLive, all from an app's packages (#586)", () => {
    const reporter = ErrorReporter.make(() => {})
    const env: WardicEnv = Layer.mergeAll(
      DomLive,
      Logger.layer([Logger.consolePrettyBrowser(), Logger.tracerLogger]),
      Layer.succeed(References.MinimumLogLevel, "Debug"),
      ErrorReporter.layer([reporter]),
      DevTools.layer(),
      Layer.succeed(CheckFrames, true),
    )
    expect(Layer.isLayer(env)).toBe(true)
  })
})
