// `WardicConfig`'s `transformPagePoint` on Solid 2 (#443): Solid 1's PP1, on `wardic.div` and on a ward,
// and `createDrag`'s samples, with real mouse input.
//
// - PPV1: inside a parent zoomed to 2×, a free drag with `correctParentTransform` stays under the
//   pointer, on `wardic.div` and on a ward's spread.
// - PPV2: `createDrag`'s offset is mapped: half the pointer's inside the 2× parent.
// - PPV3: a ward's pan is mapped: `panEnd`'s offset is half the pointer's inside the 2× parent.
import { DomLive } from "@wardic/dom"
import { correctParentTransform, createDrag, ward, wardic, WardicConfig, WardicProvider } from "@wardic/solid/unstable/v2"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { commands, page } from "vitest/browser"
import "../browser-commands.ts"
import { raf } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

let viewport = { width: 0, height: 0 }
beforeAll(async () => {
  viewport = { width: window.innerWidth, height: window.innerHeight }
  await page.viewport(1200, 900)
  await wait(50)
})
afterAll(async () => {
  await page.viewport(viewport.width, viewport.height)
})

const BOX = { position: "absolute", top: "20px", left: "20px", width: "40px", height: "40px", background: "#8af" } as const
const PARENT = { position: "absolute", top: "450px", left: "400px", width: "300px", height: "200px", transform: "scale(2)", background: "#eee" } as const

/** Grab `el` at its centre, move the real mouse `dx` right in 10 steps, and read how far it moved on the screen before letting go. */
const dragBy = async (el: Element, dx: number): Promise<number> => {
  const before = el.getBoundingClientRect()
  const x = before.left + before.width / 2
  const y = before.top + before.height / 2
  await commands.realMouse("down", x, y)
  try {
    for (let k = 1; k <= 10; k++) {
      await commands.realMouse("move", x + (dx * k) / 10, y)
      await wait(20)
    }
    await wait(60)
    return el.getBoundingClientRect().left - before.left
  } finally {
    await commands.realMouse("up", x + dx, y)
  }
}

/** A few frames. */
const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

describe("transformPagePoint on Solid 2 (#443)", () => {
  it("PPV1: inside a 2× parent, a drag with correctParentTransform stays under the pointer, on wardic.div and on a ward", async () => {
    let parent!: HTMLDivElement
    const Card = () => {
      const card = ward({ drag: true, dragMomentum: false, style: { ...BOX, left: "120px" } })
      return <div data-w {...card()} />
    }
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <div ref={parent} style={PARENT}>
          <WardicConfig transformPagePoint={correctParentTransform(() => parent)}>
            <wardic.div data-t drag dragMomentum={false} style={BOX} />
            <Card />
          </WardicConfig>
        </div>
      </WardicProvider>
    ))
    await frames(4)
    expect(await dragBy(host.querySelector("[data-t]")!, 60)).toBeCloseTo(60, 0)
    expect(await dragBy(host.querySelector("[data-w]")!, 60)).toBeCloseTo(60, 0)
  })

  it("PPV2: createDrag's offset is mapped: half the pointer's inside the 2× parent", async () => {
    let parent!: HTMLDivElement
    let drag!: ReturnType<typeof createDrag>
    const Watched = () => {
      drag = createDrag()
      return <div data-t ref={drag} style={BOX} />
    }
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <div ref={parent} style={PARENT}>
          <WardicConfig transformPagePoint={correctParentTransform(() => parent)}>
            <Watched />
          </WardicConfig>
        </div>
      </WardicProvider>
    ))
    await frames(4)
    await dragBy(host.querySelector("[data-t]")!, 60)
    await frames(2)
    expect(drag()?.offset.x).toBeCloseTo(30, 0)
  })

  it("PPV3: a ward's pan is mapped: panEnd's offset is half the pointer's inside the 2× parent", async () => {
    let parent!: HTMLDivElement
    let card!: ReturnType<typeof ward>
    const Card = () => {
      card = ward({ style: BOX })
      return <div data-t {...card()} />
    }
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <div ref={parent} style={PARENT}>
          <WardicConfig transformPagePoint={correctParentTransform(() => parent)}>
            <Card />
          </WardicConfig>
        </div>
      </WardicProvider>
    ))
    await frames(4)
    const ended = card.next("panEnd")
    await frames(2)
    await dragBy(host.querySelector("[data-t]")!, 60)
    expect((await ended).offset.x).toBeCloseTo(30, 0)
  })
})
