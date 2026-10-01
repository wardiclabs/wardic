// A server render on DomLive (ADR-0021): rendered with Solid's server build in the `node`
// environment (no `window`, no `document`, no `requestAnimationFrame`), as SolidStart
// renders an app's route.
//
// - A server render builds no runtime (decision 1): every element renders its Starting
//   style, `project(resolveInitial(config))`, and its static attributes; nothing builds
//   the Environment.
// - The binding knows it's on a server (decision 3), and its lean path keeps every
//   hydration key where the client's render puts it (decision 4).
// - A component wrap gets the Starting style through `style` (decision 6).
// - Running anything on the runtime during a server render fails with DomLive's
//   client-only error (decision 7).
// - Client-only hooks return a fixed value and start nothing (decisions 8 and 9).
//
// Expected styles come from @wardic/dom's own Renderer (RendererDomLive), not hard-coded.
import { Renderer } from "@wardic/core"
import { RendererDomLive } from "@wardic/dom"
import {
  AnimatePresence,
  createDrag,
  createFocus,
  createHover,
  createInView,
  createPress,
  createReducedMotion,
  fromAtom,
  LayoutGroup,
  Reorder,
  runScoped,
  streamToSignal,
  useWardic,
  useWardicFiber,
  useWardicGate,
  useWardicRuntime,
  wardic,
  type WardicEnv,
} from "@wardic/solid"
import { TestLive } from "@wardic/test"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import { Atom } from "effect/unstable/reactivity"
import { For, type JSX, Show } from "solid-js"
import { describe, expect, it } from "vitest"
import { serve, type Tag, tagsOf } from "./ssr-helpers.ts"

/** The DOM's projection, from the Renderer DomLive provides. */
const domProject = Effect.runSync(Effect.provide(Effect.gen(function* () { return yield* Renderer }), RendererDomLive)).project

/** `tag`'s inline style carries every key of the DOM's projection of `values`, as the server writes it. */
const expectStartingStyle = (tag: Tag | undefined, values: Record<string, unknown>): void => {
  const patch = domProject(values)
  expect(Object.keys(patch).length, "the projection has keys").toBeGreaterThan(0)
  for (const key in patch) expect(tag?.style[key], `${tag?.name} style ${key}`).toBe(String(patch[key]))
}

/** The text inside `<i data-s="name">`, with Solid's hydration markers stripped. */
const readout = (html: string, name: string): string | undefined =>
  new RegExp(`<i data-s="${name}"[^>]*>(.*?)</i>`).exec(html)?.[1]?.replace(/<!--[^>]*-->/g, "")

/** What `f` threw, or `undefined`. */
const thrownBy = (f: () => unknown): unknown => {
  try {
    f()
  } catch (e) {
    return e
  }
  return undefined
}

/** How a fiber ended, or `"still running"` after 100 ms (so a hang fails an assertion, not the test's timeout). */
const endWithin100ms = <A, E>(fiber: Fiber.Fiber<A, E>): Promise<Exit.Exit<A, E> | "still running"> =>
  Promise.race([
    Effect.runPromise(Fiber.await(fiber)),
    new Promise<"still running">((resolve) => setTimeout(() => resolve("still running"), 100)),
  ])

const VARIANTS = { hidden: { opacity: 0, scale: 0.5 }, shown: { opacity: 1, scale: 1 } }
const VALUES = ["a", "b", "c"]

/** A component that forwards its ref and applies `style` and `draggable` on its root. */
const Card = (p: {
  readonly ref?: (el: HTMLElement) => void
  readonly style?: JSX.CSSProperties
  readonly draggable?: "false" | "true"
  readonly children?: JSX.Element
}): JSX.Element => (
  <article ref={p.ref} style={p.style} draggable={p.draggable}>
    {p.children}
  </article>
)
const WCard = wardic.create(Card)

/** A component that forwards its ref only. */
const RefOnly = (p: { readonly ref?: (el: HTMLElement) => void; readonly children?: JSX.Element }): JSX.Element => (
  <aside ref={p.ref}>{p.children}</aside>
)
const WRefOnly = wardic.create(RefOnly)

/** A `useWardic` spread whose ward.Provider passes its variant down. */
function Spread(): JSX.Element {
  const ward = useWardic({ initial: "hidden", animate: "shown", variants: VARIANTS })
  return (
    <section {...ward()}>
      <ward.Provider>
        <wardic.span variants={VARIANTS}>child</wardic.span>
      </ward.Provider>
    </section>
  )
}

/** Every element kind in one tree, for the hydration keys (decision 4). */
const KeysFixture = (): JSX.Element => (
  <main>
    <wardic.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}>
      a
    </wardic.div>
    <Spread />
    <WCard initial={{ opacity: 0 }} style={{ margin: "4px" }} drag="x">
      card
    </WCard>
    <Reorder.Group values={VALUES} onReorder={() => {}}>
      <For each={VALUES}>{(value) => <Reorder.Item value={value}>{value}</Reorder.Item>}</For>
    </Reorder.Group>
    <AnimatePresence>
      <Show when={true}>
        <wardic.div initial={{ opacity: 0 }} exit={{ opacity: 0 }}>
          presence
        </wardic.div>
      </Show>
    </AnimatePresence>
    <LayoutGroup>
      <wardic.div layout initial={{ opacity: 0 }}>
        layout
      </wardic.div>
    </LayoutGroup>
  </main>
)

/** Every client-only hook, each read out as text. */
function Sensors(): JSX.Element {
  const target = {}
  const hover = createHover(target)
  const press = createPress(target)
  const focus = createFocus(target)
  const inView = createInView(target)
  const drag = createDrag(target)
  const reducedMotion = createReducedMotion()
  const stream = streamToSignal<string>(Stream.never, "init")
  return (
    <p>
      <i data-s="hover">{String(hover())}</i>
      <i data-s="press">{String(press())}</i>
      <i data-s="focus">{String(focus())}</i>
      <i data-s="inView">{String(inView())}</i>
      <i data-s="drag">{String(drag())}</i>
      <i data-s="reducedMotion">{String(reducedMotion())}</i>
      <i data-s="stream">{stream()}</i>
    </p>
  )
}

/**
 * The fixture's `data-hk` values in document order, recorded under TestLive at 9531ff4
 * (before #41's fix), saved in .tmp/tasks/issue-41-ssr/hk-9531ff4.json. A Solid upgrade
 * re-records it.
 */
const HK_9531FF4: ReadonlyArray<string> = [
  "0000",
  "000110",
  "00021",
  "000220010",
  "000310",
  "00040010",
  "00040011010",
  "00040011110",
  "00040011210",
  "0005000010",
  "0006010",
]

const keysOf = (html: string): ReadonlyArray<string> => [...html.matchAll(/data-hk="([^"]*)"/g)].map((m) => m[1]!)

describe("a server render on DomLive (ADR-0021)", () => {
  it("SV1: a bare provider renders its children, and nothing throws", () => {
    const [main] = tagsOf(serve(() => <main>hi</main>))
    expect(main?.name).toBe("main")
  })

  it("SV2: wardic.div renders the DOM's projection of its initial values", () => {
    const [div] = tagsOf(serve(() => <wardic.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} />))
    expect(div?.name).toBe("div")
    expectStartingStyle(div, { opacity: 0, x: 10 })
    expect(div?.style.transform ?? "").toContain("translateX(10px)")
  })

  it("SV3: a variant-name initial renders that variant's projection", () => {
    const [div] = tagsOf(serve(() => <wardic.div initial="hidden" animate="shown" variants={VARIANTS} />))
    expectStartingStyle(div, VARIANTS.hidden)
  })

  it("SV4: the user's style merges under the animated keys, and over a drag's defaults", () => {
    const [div] = tagsOf(serve(() => <wardic.div initial={{ opacity: 0 }} style={{ color: "red", opacity: 0.5 }} />))
    expect(div?.style.color).toBe("red")
    expect(div?.style.opacity).toBe("0")
    const [drag] = tagsOf(serve(() => <wardic.div drag="x" style={{ "touch-action": "auto" }} />))
    expect(drag?.style["touch-action"]).toBe("auto")
    expect(drag?.style["user-select"]).toBe("none")
    expect(drag?.style["-webkit-user-select"]).toBe("none")
    expect(drag?.style["-webkit-touch-callout"]).toBe("none")
    expect(drag?.attrs.draggable).toBe("false")
  })

  it("SV5: a useWardic spread renders the Starting style", () => {
    function Section(): JSX.Element {
      const ward = useWardic({ initial: { opacity: 0, y: 4 } })
      return <section {...ward()}>s</section>
    }
    const [section] = tagsOf(serve(() => <Section />))
    expect(section?.name).toBe("section")
    expectStartingStyle(section, { opacity: 0, y: 4 })
  })

  it("SV6: an svg-inner element's Starting style renders as attributes; the svg root's as style", () => {
    const [, circle] = tagsOf(
      serve(() => (
        <svg>
          <wardic.circle initial={{ cx: 10, opacity: 0.5 }} />
        </svg>
      )),
    )
    expect(circle?.name).toBe("circle")
    expect(circle?.attrs.cx).toBe("10")
    expect(circle?.attrs.opacity).toBe("0.5")
    expect(circle?.style.cx).toBeUndefined()
    expect(circle?.style.opacity).toBeUndefined()
    const [svg] = tagsOf(serve(() => <wardic.svg initial={{ opacity: 0 }} />))
    expect(svg?.name).toBe("svg")
    expect(svg?.style.opacity).toBe("0")
  })

  it("SV7: wardic.create(Component) passes the Starting style, the user's style and the drag defaults through style", () => {
    const [article] = tagsOf(
      serve(() => (
        <WCard initial={{ opacity: 0 }} style={{ margin: "4px" }} drag="x">
          card
        </WCard>
      )),
    )
    expect(article?.name).toBe("article")
    expect(article?.style.opacity).toBe("0")
    expect(article?.style.margin).toBe("4px")
    expect(article?.style["touch-action"]).toBe("pan-y")
    expect(article?.style["user-select"]).toBe("none")
    expect(article?.style["-webkit-user-select"]).toBe("none")
    expect(article?.style["-webkit-touch-callout"]).toBe("none")
    expect(article?.attrs.draggable).toBe("false")
    const [aside] = tagsOf(serve(() => <WRefOnly initial={{ opacity: 0 }}>ref only</WRefOnly>))
    expect(aside?.name).toBe("aside")
  })

  it("SV8: an AnimatePresence child renders its Starting style", () => {
    const [div] = tagsOf(
      serve(() => (
        <AnimatePresence>
          <Show when={true}>
            <wardic.div initial={{ opacity: 0 }} exit={{ opacity: 0 }} />
          </Show>
        </AnimatePresence>
      )),
    )
    expect(div?.name).toBe("div")
    expect(div?.style.opacity).toBe("0")
  })

  it("SV9: a LayoutGroup renders its layout and layoutId elements", () => {
    const tags = tagsOf(
      serve(() => (
        <LayoutGroup>
          <wardic.div layout initial={{ opacity: 0 }} />
          <wardic.div layoutId="a" />
        </LayoutGroup>
      )),
    )
    expect(tags.map((t) => t.name)).toEqual(["div", "div"])
    expect(tags[0]?.style.opacity).toBe("0")
  })

  it("SV10: client-only hooks render their fixed server values", () => {
    const html = serve(() => <Sensors />)
    expect(readout(html, "hover")).toBe("false")
    expect(readout(html, "press")).toBe("false")
    expect(readout(html, "focus")).toBe("false")
    expect(readout(html, "inView")).toBe("false")
    expect(readout(html, "drag")).toBe("null")
    expect(readout(html, "reducedMotion")).toBe("false")
    expect(readout(html, "stream")).toBe("init")
  })

  it("SV11: fromAtom renders its serverValue; without one, it fails with DomLive's client-only error", () => {
    function WithServerValue(): JSX.Element {
      const value = fromAtom(Atom.make(1), { serverValue: 7 })
      return <i data-s="atom">{String(value())}</i>
    }
    expect(readout(serve(() => <WithServerValue />), "atom")).toBe("7")
    function WithoutServerValue(): JSX.Element {
      const value = fromAtom(Atom.make(1))
      return <i data-s="atom">{String(value())}</i>
    }
    const thrown = thrownBy(() => serve(() => <WithoutServerValue />))
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toContain("can't be built here")
  })

  it("SV12: useWardicFiber and runScoped start nothing and return a fiber already ended by interruption", async () => {
    let calls = 0
    let hooked: Fiber.Fiber<unknown, unknown> | undefined
    let scoped: Fiber.Fiber<unknown, unknown> | undefined
    function Fibers(): JSX.Element {
      hooked = useWardicFiber(() => {
        calls += 1
        return Effect.never
      })
      scoped = runScoped(useWardicRuntime(), Effect.never)
      return <i />
    }
    serve(() => <Fibers />)
    expect(calls, "the thunk isn't evaluated on a server").toBe(0)
    for (const fiber of [hooked, scoped]) {
      expect(fiber).toBeDefined()
      const exit = await endWithin100ms(fiber!)
      expect(exit).not.toBe("still running")
      expect(Exit.isFailure(exit as Exit.Exit<unknown, unknown>)).toBe(true)
      expect(Cause.hasInterruptsOnly((exit as Exit.Failure<unknown, unknown>).cause)).toBe(true)
    }
  })

  it("SV13: useWardicGate returns a gate that does nothing", () => {
    let ran = false
    let caught: unknown
    function Gate(): JSX.Element {
      try {
        const gate = useWardicGate()
        gate.register("sv13", { kind: "signal", set: () => {} })()
        gate.write("sv13", { opacity: 1 })
        gate.flushPass(() => {})
        gate.dispose()
        ran = true
      } catch (e) {
        caught = e
      }
      return <i />
    }
    serve(() => <Gate />)
    expect(caught).toBeUndefined()
    expect(ran).toBe(true)
  })

  it("SV14: running on the runtime during a server render fails with DomLive's client-only error", () => {
    let caught: unknown
    function Runs(): JSX.Element {
      try {
        useWardicRuntime().runSync(Effect.void)
      } catch (e) {
        caught = e
      }
      return <i />
    }
    serve(() => <Runs />)
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toContain("can't be built here")
    expect((caught as Error).message).toContain("ADR-0003")
  })

  it("SV15a (guard): under TestLive, the fixture's hydration keys are 9531ff4's", () => {
    expect(keysOf(serve(() => <KeysFixture />, TestLive))).toEqual(HK_9531FF4)
  })

  it("SV15b: under DomLive, the fixture's hydration keys are 9531ff4's", () => {
    expect(keysOf(serve(() => <KeysFixture />))).toEqual(HK_9531FF4)
  })

  it("SV16: a server render builds no runtime", () => {
    let builds = 0
    const env: WardicEnv = Layer.merge(
      TestLive,
      Layer.effectDiscard(
        Effect.sync(() => {
          builds += 1
        }),
      ),
    )
    serve(
      () => (
        <>
          <KeysFixture />
          <Sensors />
        </>
      ),
      env,
    )
    expect(builds).toBe(0)
  })
})
