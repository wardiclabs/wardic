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
// - Client-only hooks return a fixed value and start nothing (decisions 8 and 9), and
//   `useAnimateLayout` just runs its callback (#4).
//
// Expected styles come from @wardic/dom's own Renderer (RendererDomLive), not hard-coded.
import * as Renderer from "@wardic/core/Renderer"
import * as DomRenderer from "@wardic/dom/DomRenderer"
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
  useAnimateLayout,
  createWard,
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
import { Atom } from "effect/reactivity"
import { createSignal, For, type JSX, Show } from "solid-js"
import { describe, expect, it } from "vitest"
import { serve, type Tag, tagsOf } from "./ssr-helpers.ts"

/** The DOM's projection, from the Renderer DomLive provides. */
const domProject = Effect.runSync(Effect.provide(Effect.gen(function* () { return yield* Renderer.Renderer }), DomRenderer.layer)).project

/** `tag`'s inline style carries every key of the DOM's projection of `values`, as the server writes it. */
const expectStartingStyle = (tag: Tag | undefined, values: Record<string, unknown>): void => {
  const patch = domProject(values)
  expect(Object.keys(patch).length, "the projection has keys").toBeGreaterThan(0)
  for (const key in patch) expect(tag?.style[key], `${tag?.name} style ${key}`).toBe(String(patch[key]))
}

/** The text inside `<i … data-s="name">` (a root `<i>` carries `data-hk` first), with Solid's hydration markers stripped. */
const readout = (html: string, name: string): string | undefined =>
  new RegExp(`<i[^>]*\\sdata-s="${name}"[^>]*>(.*?)</i>`).exec(html)?.[1]?.replace(/<!--[^>]*-->/g, "")

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

/** A `createWard` spread whose ward.Provider passes its variant down. */
function Spread(): JSX.Element {
  const ward = createWard({ initial: "hidden", animate: "shown", variants: VARIANTS })
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
 * The fixture's `data-hk` values in document order. First recorded under TestLive at 9531ff4
 * (before #41's fix, when the server ran the client's full code path). Re-recorded for #50: an
 * element that changes what its children read (variants of its own, or `inherit={false}`)
 * renders its variant context's Provider, one more component boundary, on the server and the
 * client alike. In this fixture that's only the `wardic.span` with `variants` (the 4th key);
 * every other key is 9531ff4's. The hydrate project (the same fixtures rendered on a server and
 * hydrated in Chromium) checks that the client's keys still match. A Solid upgrade re-records it.
 */
const HK: ReadonlyArray<string> = [
  "0000",
  "000110",
  "00021",
  "00022001000",
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

  it("SV5: a createWard spread renders the Starting style", () => {
    function Section(): JSX.Element {
      const ward = createWard({ initial: { opacity: 0, y: 4 } })
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
        gate.register("sv13", { target: undefined })()
        gate.write("sv13", { opacity: 1 })
        gate.flushPass(() => {})
        gate.release("sv13", ["opacity"])
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

  it("SV17: a reactive prop named like a key Wardic sets renders, and Wardic's value wins (as on the client)", () => {
    const [cx] = createSignal(5)
    const [draggable] = createSignal<"true" | "false">("true")
    const [, circle] = tagsOf(serve(() => <svg><wardic.circle cx={cx()} initial={{ cx: 10 }} /></svg>))
    expect(circle?.attrs.cx).toBe("10")
    const [div] = tagsOf(serve(() => <wardic.div drag="x" draggable={draggable()} />))
    expect(div?.attrs.draggable).toBe("false")
    const [article] = tagsOf(serve(() => <WCard drag="x" draggable={draggable()}>c</WCard>))
    expect(article?.attrs.draggable).toBe("false")
  })

  it("SV18: a string style keeps its declarations under the Starting style", () => {
    const [div] = tagsOf(serve(() => <wardic.div style="color: red; margin: 2px" initial={{ opacity: 0 }} />))
    expect(div?.style).toEqual({ color: "red", margin: "2px", opacity: "0" })
    const [article] = tagsOf(serve(() => <WCard style={"color: red" as unknown as JSX.CSSProperties} initial={{ opacity: 0 }}>c</WCard>))
    expect(article?.style).toEqual({ color: "red", opacity: "0" })
  })

  it("SV19 (guard, #47): a key only a gesture or animate sets renders nothing on the server", () => {
    // ADR-0021: nothing reads the DOM on a server, so a key with no `initial` value has no
    // Starting style; its Base value is read on the client after mount (ADR-0022).
    const [hovered, animated, wrapped] = tagsOf(
      serve(() => (
        <>
          <wardic.div style="width: 10px" whileHover={{ scale: 1.5, opacity: 1 }} whileTap={{ scale: 0.9 }} />
          <wardic.div style="width: 10px" animate={{ opacity: 0.5, scale: 1.2 }} />
          <WCard style={{ width: "10px" }} whileHover={{ opacity: 1 }}>c</WCard>
        </>
      )),
    )
    for (const tag of [hovered, animated, wrapped]) expect(tag?.style, `${tag?.name}`).toEqual({ width: "10px" })
  })

  it("SV20 (#57): an initial whose transform keys are all at their identity renders transform: none", () => {
    // ADR-0023 and ADR-0021's amendment: the Starting style is `project`'s, Motion's server
    // markup (`motion` 13.5.0: S1-S3, S7, S10 in docs/research/identity-transform.md).
    // Literal, not the DOM's projection: the markup is the point.
    const [identity, strings, mixed, , circle, wrapped] = tagsOf(
      serve(() => (
        <>
          <wardic.div initial={{ scale: 1, x: 0 }} animate={{ scale: 1.2 }} />
          <wardic.div initial={{ rotate: "0deg", y: "0%" }} />
          <wardic.div initial={{ opacity: 0, x: 10, scale: 1 }} />
          <svg>
            <wardic.circle initial={{ scale: 1 }} />
          </svg>
          <WCard initial={{ scale: 1 }}>c</WCard>
        </>
      )),
    )
    expect(identity?.style.transform).toBe("none")
    expect(strings?.style.transform).toBe("none")
    expect(mixed?.style.transform, "only the non-identity key's function").toBe("translateX(10px)")
    expect(mixed?.style.opacity).toBe("0")
    expect(circle?.name).toBe("circle")
    expect(circle?.style.transform).toBe("none")
    expect(circle?.style["transform-box"]).toBe("fill-box")
    expect(circle?.style["transform-origin"]).toBe("50% 50%")
    expect(wrapped?.style.transform, "a component wrap's Starting style through style").toBe("none")
  })

  it("SV21 (guard, #56): a string initial renders as it is; a string key only animate sets renders nothing", () => {
    // ADR-0024 decision 6: a string `initial` was already in the Starting style, and nothing reads
    // on a server (ADR-0021). The client starts the animate-only key from its Own value.
    const [colour, keywords, wrapped] = tagsOf(
      serve(() => (
        <>
          <wardic.div initial={{ "background-color": "#000" }} animate={{ "background-color": "#fff", color: "rgb(255, 0, 0)" }} />
          <wardic.div initial={{ display: "none", height: "10px" }} animate={{ display: "block", height: "40px" }} />
          <WCard initial={{ "background-color": "#000" }} animate={{ "background-color": "#fff" }}>c</WCard>
        </>
      )),
    )
    expect(colour?.style).toEqual({ "background-color": "#000" })
    // Its whole mount animation starts from `initial`, so it also plays it before hydration (#48, ADR-0044).
    expect(keywords?.style).toEqual({ display: "none", height: "10px", animation: expect.stringMatching(/^var\(--wardic-a\d+\)$/) })
    expect(wrapped?.style, "a component wrap's Starting style through style").toEqual({ "background-color": "#000" })
  })

  it("SV15a (guard): under TestLive, the fixture's hydration keys are the recorded ones", () => {
    expect(keysOf(serve(() => <KeysFixture />, TestLive))).toEqual(HK)
  })

  it("SV15b: under DomLive, the fixture's hydration keys are the recorded ones", () => {
    expect(keysOf(serve(() => <KeysFixture />))).toEqual(HK)
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

  it("SV17: useAnimateLayout's animateLayout just runs its callback and returns its result (#4)", () => {
    let result: string | undefined
    let runs = 0
    const html = serve(() => {
      const animateLayout = useAnimateLayout()
      result = animateLayout(() => {
        runs += 1
        return "ran"
      })
      return <div>{result}</div>
    })
    expect(runs).toBe(1)
    expect(result).toBe("ran")
    expect(html).toContain("ran")
  })

  it("SV18: on the server, onSettled is called once the callback has run, and the layout callbacks render nothing (#191)", () => {
    const calls: Array<string> = []
    const html = serve(() => {
      const animateLayout = useAnimateLayout()
      animateLayout(() => calls.push("ran"), { onSettled: () => calls.push("settled") })
      return <wardic.div layout onLayoutAnimationStart={() => calls.push("start")} onLayoutAnimationComplete={() => calls.push("complete")} />
    })
    expect(calls).toEqual(["ran", "settled"])
    expect(html.toLowerCase()).not.toContain("onlayoutanimation")
  })
})
