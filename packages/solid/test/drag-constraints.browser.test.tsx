// Element `dragConstraints` on Solid 1 (#273, ADR-0047, Motion's `dragConstraints={ref}`): an accessor of
// the container, read at each measure. Real Playwright mouse input.
//
// - DC1: the element's box stays inside the container's, on both sides.
// - DC2: an element bigger than its container: dragged to show what overflows, and no further.
// - DC3: `onMeasureDragConstraints` gets the measured box, and the one it returns is used.
// - DC4: the container shrinks with the element at its far edge: the element keeps its place, at rest.
// - DC5: a container rendered after the draggable (a signal ref): the accessor finds it at the drag's start.
// - DC6: an accessor with nothing at the drag's start: the drag runs unconstrained.
// - DC7: a layout node's drag stays inside too.
// - DC8: Motion's box of numbers: `{ left, right }` bounds x, y left free.
// - DC9: a fling past the container's edge springs back inside it (the release's edges are the measured bounds).
// - DC10: the element moved inside its container with neither resizing (a sibling above it grew): the
//   next drag's start measures it where it is now.
import { render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { wardic, type WardicBoundingBox, WardicProvider } from "@wardic/solid"
import { createSignal, type JSX } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf, until } from "./browser-helpers.ts"
import { add, centreOf, glide, mouse, type Pt, resetScene, settle } from "./reorder-harness.tsx"

afterEach(resetScene)

const BOX = { width: "60px", height: "60px", background: "teal", "user-select": "none" } as const

/** A 300x200 frame at (100, 100) holding `content`; the frame element and the draggable's. */
const mountIn = async (content: (frame: () => HTMLElement | undefined, ref: (n: HTMLElement) => void) => JSX.Element, frameStyle: () => JSX.CSSProperties = () => ({})) => {
  const [frame, setFrame] = createSignal<HTMLElement>()
  const [el, setEl] = createSignal<HTMLElement>()
  render(() => (
    <WardicProvider env={DomLive}>
      <div
        ref={(n: HTMLElement) => setFrame(n)}
        style={{ position: "absolute", top: "100px", left: "100px", width: "300px", height: "200px", outline: "1px solid grey", ...frameStyle() }}
      >
        {content(frame, (n) => setEl(n))}
      </div>
    </WardicProvider>
  ))
  await settle()
  return { frame: frame()!, el: el()! }
}

const r = (n: number): number => Math.round(n)

/** A drag of `el` by (dx, dy) from its centre, in 10 moves, released there. */
const dragBy = async (el: HTMLElement, dx: number, dy: number): Promise<Pt> => {
  const c = centreOf(el)
  await mouse.down(c)
  await glide(c, add(c, dx, dy), 10)
  await mouse.up(add(c, dx, dy))
  return c
}

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

describe("element dragConstraints on Solid 1 (#273)", () => {
  it("DC1: the element's box stays inside the container's, on both sides", async () => {
    const { frame, el } = await mountIn((frame, ref) => <wardic.div ref={ref} drag dragConstraints={frame} dragElastic={0} dragMomentum={false} style={BOX} />)
    await dragBy(el, 400, 300)
    await frames(3)
    const f = frame.getBoundingClientRect()
    let b = el.getBoundingClientRect()
    expect({ right: r(b.right), bottom: r(b.bottom) }).toEqual({ right: r(f.right), bottom: r(f.bottom) })
    await dragBy(el, -600, -400)
    await frames(3)
    b = el.getBoundingClientRect()
    expect({ left: r(b.left), top: r(b.top) }).toEqual({ left: r(f.left), top: r(f.top) })
  })

  it("DC2: an element bigger than its container: dragged to show what overflows, and no further", async () => {
    const { frame, el } = await mountIn((frame, ref) => (
      <wardic.div ref={ref} drag="x" dragConstraints={frame} dragElastic={0} dragMomentum={false} style={{ ...BOX, width: "500px" }} />
    ))
    const f = frame.getBoundingClientRect()
    await dragBy(el, 80, 0)
    await frames(3)
    expect(r(el.getBoundingClientRect().left), "no further right than its start").toBe(r(f.left))
    await dragBy(el, -400, 0)
    await frames(3)
    expect(r(el.getBoundingClientRect().right), "its right edge at the frame's").toBe(r(f.right))
  })

  it("DC3: onMeasureDragConstraints gets the measured box, and the one it returns is used", async () => {
    const measured: Array<WardicBoundingBox> = []
    const { frame, el } = await mountIn((frame, ref) => (
      <wardic.div
        ref={ref}
        drag="x"
        dragConstraints={frame}
        onMeasureDragConstraints={(box) => {
          measured.push(box)
          return { ...box, right: box.right - 40 }
        }}
        dragElastic={0}
        dragMomentum={false}
        style={BOX}
      />
    ))
    await dragBy(el, 400, 0)
    await frames(3)
    expect(measured[0]).toEqual({ left: 0, right: 240, top: 0, bottom: 140 })
    expect(r(el.getBoundingClientRect().right), "40 px short of the frame's right").toBe(r(frame.getBoundingClientRect().right) - 40)
  })

  it("DC4: the container shrinks with the element at its far edge: the element keeps its place, at rest", async () => {
    const [width, setWidth] = createSignal(300)
    const { frame, el } = await mountIn(
      (frame, ref) => <wardic.div ref={ref} drag="x" dragConstraints={frame} dragElastic={0} dragMomentum={false} style={BOX} />,
      () => ({ width: `${width()}px` }),
    )
    await dragBy(el, 400, 0)
    await frames(3)
    expect(r(el.getBoundingClientRect().right)).toBe(r(frame.getBoundingClientRect().right))
    setWidth(200)
    await until(() => r(el.getBoundingClientRect().right) === r(frame.getBoundingClientRect().right), 2000)
    expect(r(el.getBoundingClientRect().right), "still at the far edge").toBe(r(frame.getBoundingClientRect().right))
  })

  it("DC5: a container rendered after the draggable: the accessor finds it at the drag's start", async () => {
    const [frame, setFrame] = createSignal<HTMLElement>()
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div
          ref={(n: HTMLElement) => (el = n)}
          drag="x"
          dragConstraints={frame}
          dragElastic={0}
          dragMomentum={false}
          style={{ ...BOX, position: "absolute", top: "100px", left: "100px" }}
        />
        <div ref={(n: HTMLElement) => setFrame(n)} style={{ position: "absolute", top: "100px", left: "100px", width: "200px", height: "60px", "pointer-events": "none" }} />
      </WardicProvider>
    ))
    await settle()
    await dragBy(el, 400, 0)
    await frames(3)
    expect(r(el.getBoundingClientRect().right)).toBe(r(frame()!.getBoundingClientRect().right))
  })

  it("DC6: an accessor with nothing at the drag's start: the drag runs unconstrained", async () => {
    const { el } = await mountIn((_frame, ref) => (
      <wardic.div ref={ref} drag="x" dragConstraints={() => undefined} dragElastic={0} dragMomentum={false} style={BOX} />
    ))
    const left = el.getBoundingClientRect().left
    await dragBy(el, 400, 0)
    await frames(3)
    expect(r(el.getBoundingClientRect().left - left)).toBe(400)
  })

  it("DC7: a layout node's drag stays inside too", async () => {
    const { frame, el } = await mountIn((frame, ref) => (
      <wardic.div ref={ref} layout drag="x" dragConstraints={frame} dragElastic={0} dragMomentum={false} style={BOX} />
    ))
    const c = centreOf(el)
    await mouse.down(c)
    await glide(c, add(c, 400, 0), 10)
    await frames(2)
    expect(r(el.getBoundingClientRect().right), "mid-drag, at the frame's right").toBe(r(frame.getBoundingClientRect().right))
    await mouse.up(add(c, 400, 0))
  })

  it("DC8: Motion's box of numbers: { left, right } bounds x, y left free", async () => {
    const { el } = await mountIn((_frame, ref) => (
      <wardic.div ref={ref} drag dragConstraints={{ left: -20, right: 50 }} dragElastic={0} dragMomentum={false} style={BOX} />
    ))
    const b0 = el.getBoundingClientRect()
    await dragBy(el, 200, 80)
    await frames(3)
    const b = el.getBoundingClientRect()
    expect({ x: r(b.left - b0.left), y: r(b.top - b0.top) }).toEqual({ x: 50, y: 80 })
  })

  it("DC9: a fling past the container's edge springs back inside it", async () => {
    const { frame, el } = await mountIn((frame, ref) => <wardic.div ref={ref} drag="x" dragConstraints={frame} style={BOX} />)
    const c = centreOf(el)
    await mouse.down(c)
    await glide(c, add(c, 200, 0), 5, 10)
    await mouse.up(add(c, 200, 0))
    const f = frame.getBoundingClientRect()
    await until(() => Math.abs(el.getBoundingClientRect().right - f.right) < 0.5, 3000)
    expect(r(el.getBoundingClientRect().right), "at rest on the frame's right").toBe(r(f.right))
  })

  it("DC10: the element moved inside its container with neither resizing: the next drag's start measures it anew", async () => {
    const [above, setAbove] = createSignal(0)
    const { frame, el } = await mountIn((frame, ref) => (
      <>
        <div style={{ height: `${above()}px` }} />
        <wardic.div ref={ref} drag="y" dragConstraints={frame} dragElastic={0} dragMomentum={false} style={BOX} />
      </>
    ))
    setAbove(50)
    await settle()
    await dragBy(el, 0, 300)
    await frames(3)
    expect(r(el.getBoundingClientRect().bottom), "at the frame's bottom, not 50 px past it").toBe(r(frame.getBoundingClientRect().bottom))
  })
})
