// The binding on the Frame loop (#74, ADR-0027). The spine's legs, presence's exit and drag's
// release run on the Environment's one Frame loop, which holds one `Clock.ticks` subscription
// while anything runs, where each used to be a fiber with a subscription of its own. And
// ADR-0027's declared changes, as the binding sees them: a loop failure fails every leg on it
// instead of hanging it, a failed leg is logged, and a tween with a fractional `repeat` settles.
//
// Each test runs on `DomLive`'s own parts, composed as `DomLive` composes them, with the Clock
// or the interpolator registry wrapped.
import { cleanup, render } from "@solidjs/testing-library"
import { Clock, FrameLoopLive, InterpolatorRegistry, InterpolatorRegistryLive, type Values } from "@wardic/core"
import { ClockDomLive, InputDomLive, ProbeDomLive, RendererDomLive } from "@wardic/dom"
import { AnimatePresence, useWardic, wardic, type WardicEnv, WardicProvider } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import type * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import { identity } from "effect/Function"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import { AtomRegistry } from "effect/reactivity"
import * as Stream from "effect/Stream"
import { createSignal, For, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { opacityOf, raf, retryGesture, until } from "./browser-helpers.ts"

afterEach(cleanup)

type ClockShape = Context.Service.Shape<typeof Clock>
type RegistryShape = Context.Service.Shape<typeof InterpolatorRegistry>

/** One log the Environment's logger saw. */
interface Logged {
  readonly level: string
  readonly message: string
  readonly cause: string | undefined
  readonly annotations: Readonly<Record<string, unknown>>
}

/**
 * `DomLive`, composed as it is, with its Clock passed through `clock` and its interpolator
 * registry through `registry`, and a logger that appends every log to `logs`.
 */
const envWith = (options: {
  readonly clock?: (clock: ClockShape) => ClockShape
  readonly registry?: (registry: RegistryShape) => RegistryShape
  readonly logs?: Array<Logged>
}): WardicEnv => {
  const { clock = identity, registry = identity, logs = [] } = options
  const services = Layer.mergeAll(
    Layer.effect(Clock)(Clock.useSync(clock)).pipe(Layer.provide(ClockDomLive)),
    Layer.effect(InterpolatorRegistry)(InterpolatorRegistry.useSync(registry)).pipe(Layer.provide(InterpolatorRegistryLive)),
    RendererDomLive,
    InputDomLive,
    ProbeDomLive,
  )
  return Layer.merge(
    FrameLoopLive.pipe(Layer.provideMerge(services), Layer.provideMerge(AtomRegistry.layer)),
    Logger.layer([
      Logger.map(Logger.formatStructured, (s) => {
        logs.push({ level: s.level, message: String(s.message), cause: s.cause, annotations: s.annotations })
      }),
    ]),
  )
}

/** A Clock that counts the subscriptions to its `ticks`: all of them, the open ones, and the most open at once. */
const countingClock = () => {
  let total = 0
  let open = 0
  let most = 0
  const wrap = (clock: ClockShape): ClockShape => ({
    ...clock,
    ticks: Stream.suspend(() => {
      total++
      open++
      most = Math.max(most, open)
      return clock.ticks.pipe(
        Stream.ensuring(
          Effect.sync(() => {
            open--
          }),
        ),
      )
    }),
  })
  return { wrap, total: () => total, open: () => open, most: () => most }
}

/** The logs of a failed leg. */
const failedLegs = (logs: ReadonlyArray<Logged>): ReadonlyArray<Logged> =>
  logs.filter((log) => log.level === "ERROR" && log.message === "wardic.spine: a leg failed")

const backgroundOf = (el: HTMLElement): string => getComputedStyle(el).backgroundColor

const translateXOf = (el: HTMLElement): number => Number(/translateX\(([-\d.]+)px\)/.exec(el.style.transform)?.[1] ?? 0)

/** A primary mouse pointer's event at `(x, 0)`. */
const pointer = (type: string, x: number, buttons: number): PointerEvent =>
  new PointerEvent(type, { clientX: x, clientY: 0, buttons, pointerId: 1, pointerType: "mouse", isPrimary: true })

/** Grab `el` and drag the pointer to `x`, retrying until the direct-set lands (as `while-drag`'s tests do). */
const dragTo = (el: HTMLElement, x: number): Promise<void> =>
  retryGesture(
    () => {
      el.dispatchEvent(pointer("pointerdown", 0, 1))
      el.dispatchEvent(pointer("pointermove", x, 1))
    },
    () => el.dispatchEvent(pointer("pointerup", x, 0)),
    () => translateXOf(el) !== 0,
  )

const BLACK = "rgb(0, 0, 0)"
const WHITE = "rgb(255, 255, 255)"

describe("the binding's runs share the Frame loop's one Clock.ticks subscription", () => {
  it("100 mounted elements, each with a numeric and a string leg, make one subscriber", async () => {
    const counted = countingClock()
    const { container } = render(() => (
      <WardicProvider env={envWith({ clock: counted.wrap })}>
        <For each={Array.from({ length: 100 }, (_, i) => i)}>
          {() => (
            <wardic.div data-n initial={{ opacity: 0, "background-color": BLACK }} animate={{ opacity: 1, "background-color": WHITE }}>
              n
            </wardic.div>
          )}
        </For>
      </WardicProvider>
    ))
    const els = [...container.querySelectorAll<HTMLElement>("[data-n]")]
    expect(els).toHaveLength(100)
    await raf()
    await raf()
    // Mid-flight: 200 runs, one subscription.
    expect(els.some((el) => opacityOf(el) > 0 && opacityOf(el) < 1)).toBe(true)
    expect(counted.open()).toBe(1)
    await until(() => counted.open() === 0)
    expect(els.every((el) => opacityOf(el) === 1 && backgroundOf(el) === WHITE)).toBe(true)
    expect(counted.total()).toBe(1)
    expect(counted.most()).toBe(1)
  })

  it("an exit's two runs join a Retarget's leg on one subscriber", async () => {
    const counted = countingClock()
    const [visible, setVisible] = createSignal(true)
    const [target, setTarget] = createSignal(1)
    const { container } = render(() => (
      <WardicProvider env={envWith({ clock: counted.wrap })}>
        <wardic.div data-beside initial={{ opacity: 0 }} animate={{ opacity: target() }}>
          b
        </wardic.div>
        <AnimatePresence>
          <Show when={visible()}>
            <wardic.div data-presence initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, "background-color": BLACK }}>
              x
            </wardic.div>
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    const beside = container.querySelector<HTMLElement>("[data-beside]")!
    const leaving = container.querySelector<HTMLElement>("[data-presence]")!
    await until(() => opacityOf(leaving) === 1 && opacityOf(beside) === 1 && counted.open() === 0)
    expect(counted.total()).toBe(1)
    // In one task: a Retarget beside the exit, and the exit's numeric and string runs.
    setTarget(0.2)
    setVisible(false)
    await raf()
    await raf()
    expect(leaving.isConnected).toBe(true)
    expect(counted.open()).toBe(1)
    await until(() => !leaving.isConnected && counted.open() === 0)
    expect(leaving.isConnected).toBe(false)
    expect(Math.abs(opacityOf(beside) - 0.2)).toBeLessThan(0.001)
    expect(counted.total()).toBe(2)
    expect(counted.most()).toBe(1)
  })

  it("a drag's release joins a leg beside it on one subscriber", async () => {
    const counted = countingClock()
    let el!: HTMLElement
    const { container } = render(() => (
      <WardicProvider env={envWith({ clock: counted.wrap })}>
        <wardic.div ref={(node: HTMLElement) => (el = node)} drag dragSnapToOrigin />
        <wardic.div data-beside initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ type: "tween", duration: 3 }}>
          b
        </wardic.div>
      </WardicProvider>
    ))
    const beside = container.querySelector<HTMLElement>("[data-beside]")!
    await dragTo(el, 60)
    // The release springs x back to 0 while the tween beside it runs: the drag recognizer
    // takes no ticks, so a second subscriber could only be the release's.
    el.dispatchEvent(pointer("pointerup", 60, 0))
    await raf()
    await raf()
    // Mid-release (seeded with the release's velocity, it may first overshoot), the tween mid-flight.
    expect(translateXOf(el)).not.toBe(60)
    expect(translateXOf(el)).not.toBe(0)
    expect(opacityOf(beside)).toBeLessThan(1)
    expect(counted.open()).toBe(1)
    await until(() => translateXOf(el) === 0)
    expect(translateXOf(el)).toBe(0)
    expect(counted.total()).toBe(1)
    expect(counted.most()).toBe(1)
  })
})

describe("a loop failure fails every leg on it instead of hanging it (ADR-0027, decision 7)", () => {
  it("each leg on the burst ends, logged with the defect, and the next Retarget animates on a fresh burst", async () => {
    // The first subscription ticks three times, then dies; later ones tick as the Clock does.
    let subscriptions = 0
    const dying = (clock: ClockShape): ClockShape => ({
      ...clock,
      ticks: Stream.suspend(() => {
        subscriptions++
        if (subscriptions > 1) return clock.ticks
        return clock.ticks.pipe(Stream.take(3), Stream.concat(Stream.die(new Error("ticks broke"))))
      }),
    })
    const logs: Array<Logged> = []
    const [target, setTarget] = createSignal<Values>({ opacity: 1, "background-color": WHITE })
    const { container } = render(() => (
      <WardicProvider env={envWith({ clock: dying, logs })}>
        <For each={[0, 1, 2]}>
          {() => (
            <wardic.div data-n initial={{ opacity: 0, "background-color": BLACK }} animate={target()}>
              n
            </wardic.div>
          )}
        </For>
      </WardicProvider>
    ))
    const els = [...container.querySelectorAll<HTMLElement>("[data-n]")]
    await until(() => failedLegs(logs).length === 6, 2000)
    // Three elements, a numeric and a string leg each: six failures, two per element.
    const failed = failedLegs(logs)
    expect(failed).toHaveLength(6)
    expect(failed.every((log) => log.cause?.includes("ticks broke"))).toBe(true)
    expect(new Set(failed.map((log) => log.annotations["id"])).size).toBe(3)
    expect(els.every((el) => opacityOf(el) < 0.9)).toBe(true)

    setTarget({ opacity: 0.5, "background-color": "rgb(0, 0, 255)" })
    await until(() => els.every((el) => opacityOf(el) === 0.5 && backgroundOf(el) === "rgb(0, 0, 255)"))
    expect(els.every((el) => opacityOf(el) === 0.5 && backgroundOf(el) === "rgb(0, 0, 255)")).toBe(true)
    expect(subscriptions).toBe(2)
    expect(failedLegs(logs)).toHaveLength(6)
  })
})

describe("a failed leg is logged (ADR-0027, decision 7)", () => {
  /** A registry whose blend for this target throws past progress 0: a step that throws. */
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

  it("alone: its element's other leg and the other elements settle", async () => {
    const logs: Array<Logged> = []
    const { container } = render(() => (
      <WardicProvider env={envWith({ registry: breaking, logs })}>
        <wardic.div data-broken initial={{ opacity: 0, "background-color": BLACK }} animate={{ opacity: 1, "background-color": BROKEN }}>
          a
        </wardic.div>
        <wardic.div data-whole initial={{ opacity: 0, "background-color": BLACK }} animate={{ opacity: 1, "background-color": WHITE }}>
          b
        </wardic.div>
      </WardicProvider>
    ))
    const broken = container.querySelector<HTMLElement>("[data-broken]")!
    const whole = container.querySelector<HTMLElement>("[data-whole]")!
    await until(() => opacityOf(broken) === 1 && opacityOf(whole) === 1 && backgroundOf(whole) === WHITE)
    expect(opacityOf(broken)).toBe(1)
    expect(backgroundOf(whole)).toBe(WHITE)
    const failed = failedLegs(logs)
    expect(failed).toHaveLength(1)
    expect(failed[0]!.cause).toContain("blend broke")
    expect(failed[0]!.annotations["id"]).toBeDefined()
  })

  it("a Retarget's interruption is not a failure: nothing is logged", async () => {
    const logs: Array<Logged> = []
    const [opacity, setOpacity] = createSignal(1)
    const { container } = render(() => (
      <WardicProvider env={envWith({ logs })}>
        <wardic.div data-r initial={{ opacity: 0, "background-color": BLACK }} animate={{ opacity: opacity(), "background-color": WHITE }}>
          r
        </wardic.div>
      </WardicProvider>
    ))
    const el = container.querySelector<HTMLElement>("[data-r]")!
    // Each Retarget interrupts both legs mid-flight.
    for (const next of [0.2, 0.8, 0.4, 0.6]) {
      await raf()
      setOpacity(next)
    }
    await until(() => opacityOf(el) === 0.6 && backgroundOf(el) === WHITE)
    expect(opacityOf(el)).toBe(0.6)
    expect(failedLegs(logs)).toEqual([])
  })
})

describe("a tween with a fractional repeat settles on its last segment (ADR-0027, Implementation)", () => {
  // `repeat: 1.5` plays ceil(2.5) = 3 segments. Its Stream re-stamps the last one's settled Frame
  // `done: false` and ends, so the leg never reported done; on the loop, the machine settles.
  it("so a parent with when: afterChildren starts once the child's last segment settles", async () => {
    let setOpen: (open: boolean) => void = () => {}
    let parentEl!: HTMLElement
    let childEl!: HTMLElement
    render(() => {
      function App() {
        const [open, set] = createSignal(false)
        setOpen = set
        const parent = useWardic(() => ({
          initial: { opacity: 0 },
          variants: { open: { opacity: 1 }, closed: { opacity: 0 } },
          animate: Bool.match(open(), { onTrue: () => "open", onFalse: () => "closed" }),
          transition: { when: "afterChildren" as const },
        }))
        const Child = () => {
          const child = useWardic({
            initial: { opacity: 0 },
            variants: { open: { opacity: 1 }, closed: { opacity: 0 } },
            transition: { type: "tween", duration: 0.1, repeat: 1.5 },
          })
          return <div {...child({ ref: (n: HTMLElement) => (childEl = n) })}>c</div>
        }
        return (
          <div {...parent({ ref: (n: HTMLElement) => (parentEl = n) })}>
            <parent.Provider>
              <Child />
            </parent.Provider>
          </div>
        )
      }
      return (
        <WardicProvider env={envWith({})}>
          <App />
        </WardicProvider>
      )
    })
    await raf()
    await raf()
    setOpen(true)
    await until(() => opacityOf(childEl) >= 0.5)
    expect(opacityOf(parentEl)).toBeLessThan(0.1)
    await until(() => opacityOf(parentEl) === 1)
    expect(opacityOf(childEl)).toBe(1)
    expect(opacityOf(parentEl)).toBe(1)
  })
})
