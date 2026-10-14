// String keys through the spine (#56, ADR-0024): a colour, a length string or a keyword animates
// from where it is. Painted values are sampled after every frame, as #47's tests do.
//
// - "Follows the spring": a spring's normalized trajectory doesn't depend on the distance, so a
//   colour going #000 → #fff beside an `x` going 0 → 100 paints r/255 ≈ x/100 on every frame
//   (and, under a tween, both share the tween's progress).
// - "Continuous": a Retarget's first frame is no further from the last painted frame than the
//   largest step the leg before it took.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, createReorderGroup, reorderItem, ward, wardic, WardicProvider, type WardicTransition } from "@wardic/solid"
import { createSignal, For, type JSX, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { until } from "./browser-helpers.ts"
import { opacityOf, translateXOf } from "./base-values-harness.ts"
import { centreOf, mouse, resetScene, sampleFrames, settle } from "./reorder-harness.tsx"

// The directives compile to bare calls: the imports must stay.
void ward
void reorderItem

const sheet = document.createElement("style")
sheet.textContent = `.sk-blue { background-color: rgb(0, 0, 255); }`
document.head.append(sheet)

afterEach(async () => {
  await resetScene()
  cleanup()
})

const BOX: JSX.CSSProperties = { position: "absolute", left: "120px", top: "120px", width: "100px", height: "100px" }
const PARK = { x: 5, y: 5 }
const BLUE = [0, 0, 255] as const
const RED = [255, 0, 0] as const

type Rgb = readonly [number, number, number]
/** A painted colour's channels. */
const rgb = (colour: string): Rgb => {
  const v = /\(([^)]+)\)/.exec(colour)![1]!.split(",").map(Number)
  return [v[0]!, v[1]!, v[2]!]
}
const bgOf = (el: Element): Rgb => rgb(getComputedStyle(el).backgroundColor)
const same = (a: Rgb, b: Rgb): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
/** How far apart two colours are: the largest channel difference. */
const step = (a: Rgb, b: Rgb): number => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]))
/** A colour strictly between `a` and `b` on every channel that differs. */
const between = (c: Rgb, a: Rgb, b: Rgb): boolean =>
  [0, 1, 2].every((i) => a[i] === b[i] || (c[i]! > Math.min(a[i]!, b[i]!) && c[i]! < Math.max(a[i]!, b[i]!)))
const largestStep = (cs: ReadonlyArray<Rgb>): number => cs.slice(1).reduce((m, c, i) => Math.max(m, step(cs[i]!, c)), 0)

/**
 * Sample `reference(el)` (a numeric key's progress, 0 → 1) and the painted red channel / 255
 * after every frame until both have landed, and check they moved together.
 */
const expectSharedProgress = async (el: Element, reference: (el: Element) => number): Promise<void> => {
  const s = sampleFrames(() => ({ p: reference(el), c: bgOf(el)[0] / 255 }))
  await until(() => reference(el) > 0.999 && bgOf(el)[0] === 255, 4000)
  await settle()
  const frames = s.stop().map((f) => f.v)
  frames.forEach((f, i) => expect(Math.abs(f.p - f.c), `frame ${i}: progress ${f.p.toFixed(3)}, colour ${f.c.toFixed(3)}`).toBeLessThanOrEqual(0.02))
  expect(frames.filter((f) => f.c > 0.02 && f.c < 0.98).length, "the colour is painted mid-flight").toBeGreaterThanOrEqual(5)
  expect(frames.at(-1)!.c).toBe(1)
  expect(frames.at(-1)!.p).toBeCloseTo(1, 3)
}
const xProgress = (el: Element): number => translateXOf(el) / 100

describe("a string key follows its transition (#56, ADR-0024)", () => {
  const colourBesideX = (transition?: WardicTransition) => {
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div
          ref={(n: HTMLElement) => (el = n)}
          style={BOX}
          initial={{ x: 0, "background-color": "#000" }}
          animate={{ x: 100, "background-color": "#fff" }}
          {...(transition !== undefined ? { transition } : {})}
        />
      </WardicProvider>
    ))
    return el
  }

  it("SK1: under the default spring, a colour shares an x's progress on every painted frame", async () => {
    await expectSharedProgress(colourBesideX(), xProgress)
  })

  it("SK2: under a tween, a colour shares an x's progress on every painted frame", async () => {
    await expectSharedProgress(colourBesideX({ type: "tween", duration: 0.5 }), xProgress)
  })

  it("SK3: a spring's delay holds the colour as it holds the x", async () => {
    await expectSharedProgress(colourBesideX({ delay: 0.2 }), xProgress)
  })

  it("SK4: a length string animates from its own value, with an overflow switched on the first frame", async () => {
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} style={BOX} animate={{ height: "0px", overflow: "hidden" }} transition={{ type: "tween", duration: 0.5 }} />
      </WardicProvider>
    ))
    const s = sampleFrames(() => ({ h: Number.parseFloat(getComputedStyle(el).height), o: getComputedStyle(el).overflow }))
    await until(() => Number.parseFloat(getComputedStyle(el).height) === 0, 3000)
    await settle()
    const frames = s.stop().map((f) => f.v)
    expect(frames.filter((f) => f.h > 2 && f.h < 98).length, "the height is painted mid-flight").toBeGreaterThanOrEqual(5)
    frames.filter((f) => f.h < 100).forEach((f, i) => expect(f.o, `frame ${i} at ${f.h}px`).toBe("hidden"))
  })
})

describe("a colour from a class, under a gesture (#56; Motion's C8)", () => {
  const blueBox = (): HTMLElement => {
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} class="sk-blue" style={BOX} whileHover={{ "background-color": "rgb(255, 0, 0)" }} />
      </WardicProvider>
    ))
    return el
  }

  it("SK5: whileHover paints blue → red, and the leave red → blue, through colours in between", async () => {
    const el = blueBox()
    await settle()
    let phase = "rest"
    const s = sampleFrames(() => ({ phase, c: bgOf(el) }))
    phase = "hover"
    await mouse.move(centreOf(el))
    await until(() => same(bgOf(el), RED), 3000)
    phase = "leave"
    await mouse.move(PARK)
    await until(() => same(bgOf(el), BLUE), 3000)
    await settle()
    const frames = s.stop().map((f) => f.v)
    const hover = frames.filter((f) => f.phase === "hover").map((f) => f.c)
    const leave = frames.filter((f) => f.phase === "leave").map((f) => f.c)
    expect(hover.filter((c) => between(c, BLUE, RED)).length, "blue → red paints in between").toBeGreaterThanOrEqual(3)
    expect(leave.filter((c) => between(c, RED, BLUE)).length, "red → blue paints in between").toBeGreaterThanOrEqual(3)
    expect(leave.at(-1), "back on the class's colour").toEqual(BLUE)
  })

  it("SK6: a Retarget mid-flight leaves from the painted colour", async () => {
    const el = blueBox()
    await settle()
    let phase = "rest"
    const s = sampleFrames(() => ({ phase, c: bgOf(el) }))
    phase = "hover"
    await mouse.move(centreOf(el))
    await until(() => bgOf(el)[0] > 60, 3000)
    phase = "leave"
    await mouse.move(PARK)
    await until(() => same(bgOf(el), BLUE), 3000)
    await settle()
    const frames = s.stop().map((f) => f.v)
    const hover = frames.filter((f) => f.phase === "hover").map((f) => f.c)
    const leave = frames.filter((f) => f.phase === "leave").map((f) => f.c)
    expect(hover.filter((c) => between(c, BLUE, RED)).length, "the hover paints in between").toBeGreaterThanOrEqual(2)
    expect(between(leave[0]!, BLUE, RED), `the leave's first frame ${leave[0]} is mid-way`).toBe(true)
    expect(step(hover.at(-1)!, leave[0]!), "no jump at the Retarget").toBeLessThanOrEqual(largestStep(hover) + 2)
    expect(leave.at(-1)).toEqual(BLUE)
  })
})

describe("the commit sinks (#56)", () => {
  /** A component that forwards its ref and applies `props.style` to its root. */
  const Card = (props: { ref?: (el: HTMLElement) => void; style?: JSX.CSSProperties | string }): JSX.Element => (
    <div ref={props.ref} style={props.style}>
      card
    </div>
  )
  const WCard = wardic.create(Card)

  it("SK7: wardic.create(Component): a colour shares an x's progress", async () => {
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <WCard ref={(n: HTMLElement) => (el = n)} style={BOX} initial={{ x: 0, "background-color": "#000" }} animate={{ x: 100, "background-color": "#fff" }} />
      </WardicProvider>
    ))
    await expectSharedProgress(el, xProgress)
  })

  it("SK8: use:ward: a colour shares an x's progress", async () => {
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <div ref={(n) => (el = n)} style={BOX} use:ward={{ initial: { x: 0, "background-color": "#000" }, animate: { x: 100, "background-color": "#fff" } }} />
      </WardicProvider>
    ))
    await expectSharedProgress(el, xProgress)
  })

  it("SK9: use:reorderItem: a colour shares an opacity's progress", async () => {
    const ITEM: JSX.CSSProperties = { width: "200px", height: "40px", margin: "4px 0", "list-style": "none" }
    function List(): JSX.Element {
      const [order, setOrder] = createSignal(["a", "b"])
      const group = createReorderGroup(() => ({ values: order(), onReorder: (values: Array<string>) => setOrder(values) }))
      return (
        <ul {...group({ style: { position: "absolute", left: "60px", top: "60px", padding: "0", margin: "0" } })}>
          <For each={order()}>
            {(value) => (
              <li
                use:reorderItem={{ group, value, initial: { opacity: 0, "background-color": "#000" }, animate: { opacity: 1, "background-color": "#fff" } }}
                data-value={value}
                style={ITEM}
              >
                {value}
              </li>
            )}
          </For>
        </ul>
      )
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <List />
      </WardicProvider>
    ))
    await expectSharedProgress(document.querySelector<HTMLElement>('[data-value="a"]')!, opacityOf)
  })
})

describe("the presence exit (#56)", () => {
  it("SK10: an exit colour leaves from the colour a hover left mid-flight, and paints in between", async () => {
    const GREEN = [0, 255, 0] as const
    const [visible, setVisible] = createSignal(true)
    render(() => (
      <WardicProvider env={DomLive}>
        <AnimatePresence>
          <Show when={visible()}>
            <wardic.div data-exit class="sk-blue" style={BOX} whileHover={{ "background-color": "rgb(255, 0, 0)" }} exit={{ "background-color": "rgb(0, 255, 0)" }} />
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    const el = document.querySelector<HTMLElement>("[data-exit]")!
    await settle()
    let phase = "rest"
    const s = sampleFrames(() => ({ phase, c: el.isConnected ? bgOf(el) : undefined }))
    phase = "hover"
    await mouse.move(centreOf(el))
    await until(() => bgOf(el)[0] > 60, 3000)
    phase = "exit"
    setVisible(false)
    await until(() => !el.isConnected, 3000)
    await mouse.move(PARK)
    const frames = s.stop().map((f) => f.v).filter((f) => f.c !== undefined) as Array<{ phase: string; c: Rgb }>
    const hover = frames.filter((f) => f.phase === "hover").map((f) => f.c)
    const exit = frames.filter((f) => f.phase === "exit").map((f) => f.c)
    expect(hover.filter((c) => between(c, BLUE, RED)).length, "the hover paints in between").toBeGreaterThanOrEqual(2)
    expect(step(hover.at(-1)!, exit[0]!), "the exit leaves from the painted colour").toBeLessThanOrEqual(largestStep(hover) + 2)
    expect(exit.filter((c) => c[1] > 5 && c[1] < 250).length, "the exit paints in between").toBeGreaterThanOrEqual(3)
    expect(exit.some((c) => same(c, GREEN) || step(c, GREEN) <= 2), "it reaches its exit colour").toBe(true)
  })
})

describe("display and visibility (#56, ADR-0024 decision 4)", () => {
  const fading = (from: Record<string, string | number>, to: Record<string, string | number>, transition: WardicTransition): HTMLElement => {
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} style={BOX} initial={from} animate={to} transition={transition} />
      </WardicProvider>
    ))
    return el
  }
  const sample = (el: HTMLElement, key: "display" | "visibility") =>
    sampleFrames(() => ({ o: opacityOf(el), v: getComputedStyle(el)[key] }))

  it("SK11: under a tween, display turns none only once the opacity has faded out", async () => {
    const el = fading({ opacity: 1, display: "block" }, { opacity: 0, display: "none" }, { type: "tween", duration: 0.5 })
    const s = sample(el, "display")
    await until(() => getComputedStyle(el).display === "none", 3000)
    await settle()
    const frames = s.stop().map((f) => f.v)
    expect(frames.filter((f) => f.v === "block" && f.o > 0.05 && f.o < 0.95).length, "it fades while shown").toBeGreaterThanOrEqual(10)
    frames.filter((f) => f.v === "none").forEach((f, i) => expect(f.o, `frame ${i} hidden at opacity ${f.o}`).toBe(0))
    expect(frames.at(-1)?.v).toBe("none")
  })

  it("SK12: under a bouncy spring, display turns none once, at the settle, with no flicker", async () => {
    const el = fading({ opacity: 1, display: "block" }, { opacity: 0, display: "none" }, { stiffness: 100, damping: 5 })
    const s = sample(el, "display")
    await until(() => getComputedStyle(el).display === "none", 6000)
    await settle()
    const frames = s.stop().map((f) => f.v)
    const first = frames.findIndex((f) => f.v === "none")
    expect(first, "it turns none").toBeGreaterThan(0)
    expect(frames.slice(first).every((f) => f.v === "none"), "and stays none").toBe(true)
    expect(frames.slice(0, first).filter((f) => f.o > 0.05).length, "after a fade it shows through").toBeGreaterThanOrEqual(10)
  }, 10000)

  it("SK13 (guard): display none → block shows on the first frame, before the opacity fades in", async () => {
    const el = fading({ opacity: 0, display: "none" }, { opacity: 1, display: "block" }, { type: "tween", duration: 0.5 })
    const s = sample(el, "display")
    await until(() => opacityOf(el) > 0.999, 3000)
    await settle()
    const frames = s.stop().map((f) => f.v)
    frames.filter((f) => f.o > 0).forEach((f, i) => expect(f.v, `frame ${i} at opacity ${f.o}`).toBe("block"))
  })

  it("SK14: under a tween, visibility turns hidden only once the opacity has faded out", async () => {
    const el = fading({ opacity: 1, visibility: "visible" }, { opacity: 0, visibility: "hidden" }, { type: "tween", duration: 0.5 })
    const s = sample(el, "visibility")
    await until(() => getComputedStyle(el).visibility === "hidden", 3000)
    await settle()
    const frames = s.stop().map((f) => f.v)
    expect(frames.filter((f) => f.v === "visible" && f.o > 0.05 && f.o < 0.95).length, "it fades while visible").toBeGreaterThanOrEqual(10)
    frames.filter((f) => f.v === "hidden").forEach((f, i) => expect(f.o, `frame ${i} hidden at opacity ${f.o}`).toBe(0))
  })
})

describe("a filter holding a length (#154)", () => {
  // culori's parse threw on `blur(4px)`, at resolve: the leg failed, so a tween moved no key at all
  // and a spring dropped the filter. A string culori throws on now isn't a colour.
  const filtered = (from: Record<string, string | number>, to: Record<string, string | number>, transition: WardicTransition): HTMLElement => {
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} style={BOX} initial={from} animate={to} transition={transition} />
      </WardicProvider>
    ))
    return el
  }
  const filterOf = (el: Element): string => getComputedStyle(el).filter

  it("SK15: under a tween, blur(4px) → blur(8px) beside an opacity: the opacity fades and the filter lands", async () => {
    const el = filtered({ filter: "blur(4px)", opacity: 1 }, { filter: "blur(8px)", opacity: 0.5 }, { type: "tween", duration: 0.5 })
    const s = sampleFrames(() => opacityOf(el))
    await until(() => opacityOf(el) < 0.501, 3000)
    await settle()
    expect(s.stop().filter((f) => f.v > 0.55 && f.v < 0.95).length, "frames on the way").toBeGreaterThanOrEqual(10)
    expect(filterOf(el)).toBe("blur(8px)")
  })

  it("SK16: under a spring, the filter is painted on every frame, blurs through radii in between (#61) and lands", async () => {
    const el = filtered({ filter: "blur(4px)", opacity: 1 }, { filter: "blur(8px)", opacity: 0.5 }, { stiffness: 170, damping: 26 })
    const s = sampleFrames(() => filterOf(el))
    await until(() => filterOf(el) === "blur(8px)", 3000)
    await settle()
    const frames = s.stop().map((f) => f.v)
    frames.forEach((f, i) => expect(f, `frame ${i}`).toMatch(/^blur\([\d.]+px\)$/))
    expect(frames.filter((f) => /^blur\((4\.[1-9]|[5-7]\.)/.test(f)).length, "radii on the way").toBeGreaterThanOrEqual(5)
    expect(filterOf(el)).toBe("blur(8px)")
  })

  it("SK17: a drop-shadow blends through radii in between", async () => {
    const el = filtered(
      { filter: "drop-shadow(0px 0px 4px red)" },
      { filter: "drop-shadow(0px 0px 8px red)" },
      { type: "tween", duration: 0.5 },
    )
    const radius = (): number => Number(/([\d.]+)px\)$/.exec(filterOf(el))?.[1] ?? Number.NaN)
    const s = sampleFrames(radius)
    await until(() => radius() > 7.999, 3000)
    await settle()
    expect(s.stop().filter((f) => f.v > 4.1 && f.v < 7.9).length, "radii on the way").toBeGreaterThanOrEqual(10)
  })
})

describe("a var() value's name (#158) and what it resolves to (#55)", () => {
  it("SK18: var(--gray-500) → var(--gray-600) blends through greys (#55), never an undefined var(--gray-550) (#158)", async () => {
    let el!: HTMLElement
    const greys = { ...BOX, "--gray-500": "#6b7280", "--gray-600": "#4b5563" } as JSX.CSSProperties
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div
          ref={(n: HTMLElement) => (el = n)}
          style={greys}
          initial={{ "background-color": "var(--gray-500)" }}
          animate={{ "background-color": "var(--gray-600)" }}
          transition={{ type: "tween", duration: 0.4 }}
        />
      </WardicProvider>
    ))
    const s = sampleFrames(() => getComputedStyle(el).backgroundColor)
    await until(() => getComputedStyle(el).backgroundColor === "rgb(75, 85, 99)", 3000)
    await settle()
    const painted = s.stop().map((f) => f.v)
    // Every frame an opaque grey between the two: #158 painted transparent, before #55 it switched.
    for (const c of painted) expect(c, `painted ${c}`).toMatch(/^rgb\((\d+), (\d+), (\d+)\)$/)
    const reds = painted.map((c) => Number(/^rgb\((\d+)/.exec(c)![1]))
    reds.forEach((r, i) => expect(r >= 75 && r <= 107, `frame ${i}: red ${r}`).toBe(true))
    expect(reds.filter((r) => r > 76 && r < 106).length, "greys in between (#55)").toBeGreaterThan(5)
    expect(el.style.backgroundColor, "rests as the var() itself").toBe("var(--gray-600)")
  })
})
