// `WardicConfig`'s `transformPagePoint` on Solid 1 (#443, Motion's), with real mouse input: the points
// a drag or a pan uses, mapped, and the two helpers that make the usual mappings.
//
// - PP1: inside a parent zoomed to 2×, a free drag with `correctParentTransform` stays under the
//   pointer; with none, it covers twice the pointer's distance (ADR-0012's old limit).
// - PP2: inside a parent turned 90°, it moves the way the pointer does.
// - PP3: drag constraints from a container inside the zoomed parent are measured through it: the
//   element stops at the container's painted edge.
// - PP4: a layout element's drag inside the zoomed parent stays under the pointer too.
// - PP5: `transformViewBoxPoint`: a rect dragged inside an SVG drawn at 4× its viewBox stays under
//   the pointer.
// - PP6: a pan's offset is mapped: half the pointer's inside the 2× parent.
// - PP7: an inner `WardicConfig` with none passes its parent's on, and a new mapping is read at the
//   next drag's start.
// - PP8: Drag controls' snap to the cursor inside the 2× parent puts the centre under the pointer.
// - PP9: `createDrag`'s offset is mapped: half the pointer's inside the 2× parent.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import type * as Drag from "@wardic/core/Drag"
import { correctParentTransform, createDrag, createDragControls, transformViewBoxPoint, wardic, WardicConfig, type WardicTransformPoint, WardicProvider } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import { createEffect, createSignal, type JSX, Show } from "solid-js"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { page } from "vitest/browser"
import { add, glide, mouse, resetScene, settle, wait } from "./reorder-harness.tsx"

afterEach(async () => {
  await resetScene()
  cleanup()
})

let viewport = { width: 0, height: 0 }
beforeAll(async () => {
  viewport = { width: window.innerWidth, height: window.innerHeight }
  await page.viewport(1200, 900)
  await wait(50)
})
afterAll(async () => {
  await page.viewport(viewport.width, viewport.height)
})

/** A parent `transform`ed about its centre, low on the page (the browser files share one mouse), holding `children`. */
const Parent = (props: { readonly ref: (el: HTMLDivElement) => void; readonly transform: string; readonly children: JSX.Element }) => (
  <div ref={props.ref} style={{ position: "absolute", top: "450px", left: "400px", width: "300px", height: "200px", transform: props.transform, background: "#eee" }}>
    {props.children}
  </div>
)

const BOX = { position: "absolute", top: "20px", left: "20px", width: "40px", height: "40px", background: "#8af" } as const

/** Grab `el` at its centre, glide the pointer `dx`, `dy` on the screen, and read how far it moved on the screen before letting go. */
const dragBy = async (el: Element, dx: number, dy = 0): Promise<{ readonly dx: number; readonly dy: number }> => {
  const before = el.getBoundingClientRect()
  const grab = { x: before.left + before.width / 2, y: before.top + before.height / 2 }
  await mouse.down(grab)
  await glide(grab, add(grab, dx, dy), 10, 20)
  await wait(60)
  const after = el.getBoundingClientRect()
  await mouse.up(add(grab, dx, dy))
  return { dx: after.left - before.left, dy: after.top - before.top }
}

describe("transformPagePoint on Solid 1 (#443)", () => {
  it("PP1: inside a 2× parent, a drag with correctParentTransform stays under the pointer; with none, it covers twice", async () => {
    let parent!: HTMLDivElement
    const [mapped, setMapped] = createSignal(true)
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <Parent ref={(el) => (parent = el)} transform="scale(2)">
          <WardicConfig transformPagePoint={Bool.match(mapped(), { onTrue: () => correctParentTransform(() => parent), onFalse: () => undefined })}>
            <wardic.div data-t drag dragMomentum={false} style={BOX} />
          </WardicConfig>
        </Parent>
      </WardicProvider>
    ))
    const el = container.querySelector("[data-t]")!
    await settle()
    const moved = await dragBy(el, 60)
    expect(moved.dx, "under the pointer").toBeCloseTo(60, 0)
    setMapped(false)
    await settle()
    const unmapped = await dragBy(el, 60)
    expect(unmapped.dx, "with none, twice the pointer's distance").toBeCloseTo(120, 0)
  })

  it("PP2: inside a parent turned 90°, it moves the way the pointer does", async () => {
    let parent!: HTMLDivElement
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <Parent ref={(el) => (parent = el)} transform="rotate(90deg)">
          <WardicConfig transformPagePoint={correctParentTransform(() => parent)}>
            <wardic.div data-t drag dragMomentum={false} style={BOX} />
          </WardicConfig>
        </Parent>
      </WardicProvider>
    ))
    const el = container.querySelector("[data-t]")!
    await settle()
    const moved = await dragBy(el, 50, 0)
    expect(moved.dx).toBeCloseTo(50, 0)
    expect(moved.dy).toBeCloseTo(0, 0)
  })

  it("PP3: constraints from a container in the 2× parent are measured through it: the element stops at its painted edge", async () => {
    let parent!: HTMLDivElement
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <Parent ref={(el) => (parent = el)} transform="scale(2)">
          <WardicConfig transformPagePoint={correctParentTransform(() => parent)}>
            <wardic.div data-t drag dragMomentum={false} dragElastic={0} dragConstraints={() => parent} style={BOX} />
          </WardicConfig>
        </Parent>
      </WardicProvider>
    ))
    const el = container.querySelector("[data-t]")!
    await settle()
    await dragBy(el, 700)
    await wait(100)
    expect(el.getBoundingClientRect().right, "at the container's painted right edge").toBeCloseTo(parent.getBoundingClientRect().right, 0)
  })

  it("PP4: a layout element's drag in the 2× parent stays under the pointer", async () => {
    let parent!: HTMLDivElement
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <Parent ref={(el) => (parent = el)} transform="scale(2)">
          <WardicConfig transformPagePoint={correctParentTransform(() => parent)}>
            <wardic.div data-t layout drag dragMomentum={false} style={BOX} />
          </WardicConfig>
        </Parent>
      </WardicProvider>
    ))
    const el = container.querySelector("[data-t]")!
    await settle()
    const moved = await dragBy(el, 60)
    expect(moved.dx).toBeCloseTo(60, 0)
  })

  it("PP5: transformViewBoxPoint: a rect dragged in an SVG drawn at 4× its viewBox stays under the pointer", async () => {
    let svg!: SVGSVGElement
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <WardicConfig transformPagePoint={transformViewBoxPoint(() => svg)}>
          <svg ref={(el) => (svg = el)} viewBox="0 0 100 100" width="400" height="400" style={{ position: "absolute", top: "450px", left: "400px" }}>
            <wardic.rect data-t drag dragMomentum={false} x="10" y="10" width="10" height="10" fill="#8af" />
          </svg>
        </WardicConfig>
      </WardicProvider>
    ))
    const el = container.querySelector("[data-t]")!
    await settle()
    const moved = await dragBy(el, 80, 40)
    expect(moved.dx).toBeCloseTo(80, 0)
    expect(moved.dy).toBeCloseTo(40, 0)
  })

  it("PP6: a pan's offset is mapped: half the pointer's inside the 2× parent", async () => {
    let parent!: HTMLDivElement
    const offsets: Array<number> = []
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <Parent ref={(el) => (parent = el)} transform="scale(2)">
          <WardicConfig transformPagePoint={correctParentTransform(() => parent)}>
            <wardic.div data-t onPan={(_, info) => offsets.push(info.offset.x)} style={BOX} />
          </WardicConfig>
        </Parent>
      </WardicProvider>
    ))
    const el = container.querySelector("[data-t]")!
    await settle()
    await dragBy(el, 60)
    expect(offsets.at(-1)).toBeCloseTo(30, 0)
  })

  it("PP7: an inner config with none passes its parent's on; a new mapping is read at the next drag's start", async () => {
    const half: WardicTransformPoint = (point) => ({ x: point.x / 2, y: point.y / 2 })
    const [mapping, setMapping] = createSignal<WardicTransformPoint | undefined>(undefined)
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <Parent ref={() => {}} transform="none">
          <WardicConfig transformPagePoint={mapping()}>
            <WardicConfig transition={{ duration: 0.2 }}>
              <wardic.div data-t drag dragMomentum={false} style={BOX} />
            </WardicConfig>
          </WardicConfig>
        </Parent>
      </WardicProvider>
    ))
    const el = container.querySelector("[data-t]")!
    await settle()
    expect((await dragBy(el, 60)).dx, "none yet").toBeCloseTo(60, 0)
    setMapping(() => half)
    await settle()
    expect((await dragBy(el, 60)).dx, "the outer's, read at this start").toBeCloseTo(30, 0)
  })

  it("PP8: Drag controls' snap to the cursor inside the 2× parent puts the centre under the pointer", async () => {
    let parent!: HTMLDivElement
    const controls = createDragControls()
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <div data-h onPointerDown={(event) => controls.start(event, { snapToCursor: true })} style={{ position: "absolute", top: "820px", left: "560px", width: "40px", height: "40px", background: "#fa8" }} />
        <Parent ref={(el) => (parent = el)} transform="scale(2)">
          <WardicConfig transformPagePoint={correctParentTransform(() => parent)}>
            <wardic.div data-t drag dragControls={controls} dragMomentum={false} style={BOX} />
          </WardicConfig>
        </Parent>
      </WardicProvider>
    ))
    const el = container.querySelector("[data-t]")!
    const handle = container.querySelector("[data-h]")!.getBoundingClientRect()
    await settle()
    const h = { x: handle.left + 20, y: handle.top + 20 }
    await mouse.down(h)
    await settle()
    const box = el.getBoundingClientRect()
    expect(box.left + box.width / 2, "its centre under the pointer").toBeCloseTo(h.x, 0)
    expect(box.top + box.height / 2).toBeCloseTo(h.y, 0)
    await mouse.up(h)
  })

  it("PP9: createDrag's offset is mapped: half the pointer's inside the 2× parent", async () => {
    let parent!: HTMLDivElement
    const offsets: Array<number> = []
    const [target, setTarget] = createSignal<HTMLElement>()
    const Recorder = (props: { readonly target: HTMLElement }) => {
      // eslint-disable-next-line solid/reactivity
      const sample = createDrag(props.target)
      createEffect(() => {
        const s: Drag.Sample | null = sample()
        if (s !== null) offsets.push(s.offset.x)
      })
      return null
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Parent ref={(el) => (parent = el)} transform="scale(2)">
          <WardicConfig transformPagePoint={correctParentTransform(() => parent)}>
            <div ref={setTarget} style={BOX} />
            <Show when={target()}>{(el) => <Recorder target={el()} />}</Show>
          </WardicConfig>
        </Parent>
      </WardicProvider>
    ))
    await settle()
    await dragBy(target()!, 60)
    expect(offsets.at(-1)).toBeCloseTo(30, 0)
  })
})
