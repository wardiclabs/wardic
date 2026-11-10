// Regression: a layout node being dragged, and the Measure passes that run while it is
// held (issue #26, ADR-0016 *Amendment (#26)*).
//
// A dragged `layout` node follows the pointer through its projection target (ADR-0016).
// Before #26 a Measure pass restarted it like a node at rest: harmless for the node,
// but its stray animation state switched its `layout` children between counter-
// correcting to their slot and gluing to it, left a stale origin for the next pass,
// and faded a dragged `layoutId` Lead to opacity 0. Its `layout` children weren't
// carried with it at all: they stayed at their slot while it moved. Since #26 the
// dragged node and its subtree are drag-blocked: a pass updates their slots only,
// the dragged node is its subtree's relative parent, a resting descendant rides the
// drag through CSS, a pointer move re-derives the dragged group, and the release
// takes its first step at the next Refresh frame (ADR-0033) and always ends on its slot.
//
// How a frame is read: post-paint (rAF, then a MessageChannel message, as the layout
// lab does). A read posted from a frame that started before a trigger can land after
// the trigger's task (a timer and a message task are unordered), where it forces a
// layout no frame paints, so the frames after a trigger are those whose rAF ran after
// it (`frameAt`).
//
// The scene (most tests): an absolutely positioned column, a `layout` sibling S above
// the draggable `layout` node D (160x80). D holds a `layout` child C1 at (10,10) and a
// plain child C2 at (60,10). D is grabbed at (0,0) and held at +100,+30, so "under the
// pointer" is D's grab-time box plus that offset.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { LayoutGroup, wardic, WardicProvider } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import * as Match from "effect/Match"
import { createSignal, For, Show } from "solid-js"
import { afterEach, expect, it } from "vitest"
import { commands } from "vitest/browser"
import "./browser-commands.ts"
import { afterPaint, raf, retryGesture, until } from "./browser-helpers.ts"

afterEach(cleanup)

const down = (x: number, y: number): PointerEvent =>
  new PointerEvent("pointerdown", { clientX: x, clientY: y, buttons: 1, pointerId: 1, pointerType: "mouse", isPrimary: true })
const move = (x: number, y: number): PointerEvent =>
  new PointerEvent("pointermove", { clientX: x, clientY: y, buttons: 1, pointerId: 1, pointerType: "mouse", isPrimary: true })
const up = (x: number, y: number): PointerEvent =>
  new PointerEvent("pointerup", { clientX: x, clientY: y, buttons: 0, pointerId: 1, pointerType: "mouse", isPrimary: true })

/** The pointer offset D is held at. */
const DRAG = { x: 100, y: 30 } as const

/** A painted frame: when its rAF ran, when it was read, and what `read` returned. */
interface Painted<T> {
  readonly frameAt: number
  readonly t: number
  readonly v: T
}

/** The next `n` painted frames, each read with `read` just after its paint. */
const paintedReads = <T,>(n: number, read: () => T): Promise<ReadonlyArray<Painted<T>>> =>
  new Promise((resolve) => {
    const frames: Array<Painted<T>> = []
    const channel = new MessageChannel()
    let frameAt = 0
    const post = (): void => {
      frameAt = performance.now()
      channel.port2.postMessage(undefined)
    }
    channel.port1.onmessage = () => {
      frames.push({ frameAt, t: performance.now(), v: read() })
      if (frames.length < n) {
        requestAnimationFrame(post)
        return
      }
      channel.port1.close()
      resolve(frames)
    }
    requestAnimationFrame(post)
  })

interface Els {
  readonly d: HTMLElement
  readonly c1: HTMLElement
  readonly c2: HTMLElement
}

/** D, C1 and C2 in one painted frame. */
interface Boxes {
  readonly d: DOMRect
  readonly c1: DOMRect
  readonly c2: DOMRect
}
const boxesOf = (els: Els) => (): Boxes => ({
  d: els.d.getBoundingClientRect(),
  c1: els.c1.getBoundingClientRect(),
  c2: els.c2.getBoundingClientRect(),
})

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await raf()
  await afterPaint()
}

/** The largest distance (px, either axis) of a child's offset from D away from `rest`. */
const maxDrift = (frames: ReadonlyArray<Painted<Boxes>>, key: "c1" | "c2", rest: { x: number; y: number }): number =>
  Math.max(
    0,
    ...frames.map((f) => Math.max(Math.abs(f.v[key].left - f.v.d.left - rest.x), Math.abs(f.v[key].top - f.v.d.top - rest.y))),
  )

/** The largest distance (px, either axis) of D from `at`. */
const maxOff = (frames: ReadonlyArray<Painted<Boxes>>, at: { left: number; top: number }): number =>
  Math.max(0, ...frames.map((f) => Math.max(Math.abs(f.v.d.left - at.left), Math.abs(f.v.d.top - at.top))))

/** Grab D at (0,0) and hold it at `offset`. The recognizer attaches late, so a grab D doesn't follow is retried. */
const grab = async (d: HTMLElement, start: { left: number; top: number }, offset: { x: number; y: number } = DRAG): Promise<void> => {
  await retryGesture(
    () => {
      d.dispatchEvent(down(0, 0))
      d.dispatchEvent(move(offset.x, offset.y))
    },
    () => d.dispatchEvent(up(offset.x, offset.y)),
    () =>
      Math.abs(d.getBoundingClientRect().left - (start.left + offset.x)) < 1 &&
      Math.abs(d.getBoundingClientRect().top - (start.top + offset.y)) < 1,
  )
  for (let i = 0; i < 3; i++) await raf()
}

/** Release D at the held offset and read frames until it has settled (~1.5 s). */
const release = async (els: Els): Promise<ReadonlyArray<Painted<Boxes>>> => {
  const sampling = paintedReads(90, boxesOf(els))
  els.d.dispatchEvent(up(DRAG.x, DRAG.y))
  return sampling
}

const C1_AT = { x: 10, y: 10 } as const
const C2_AT = { x: 60, y: 10 } as const

interface SceneOptions {
  /** C1's variant: a plain `layout` child (default), `layoutAnchor: false`, or a `layoutRoot` holding a `layout` child. */
  readonly child?: "layout" | "anchor-false" | "layout-root"
  /** A `layoutId` indicator inside D, switched between two elements by `setTab`. */
  readonly indicator?: boolean
}

/**
 * Mount the column scene: a `layout` sibling S (height from `setSibling`; the engine's
 * observer sees it grow, so its pass runs after a Refresh frame's gate flush) above the
 * draggable `layout` node D (height from `setDHeight`, also its `layoutDependency`),
 * holding C1 (left from `setC1x`, also its `layoutDependency`), C1's own `layout`
 * child G, and the plain child C2.
 */
const mountScene = async (opts: SceneOptions = {}) => {
  const [sibling, setSibling] = createSignal(40)
  const [dHeight, setDHeight] = createSignal(80)
  const [c1x, setC1x] = createSignal<number>(C1_AT.x)
  const [tab, setTab] = createSignal(0)
  let d: HTMLElement | undefined
  let c1: HTMLElement | undefined
  let c2: HTMLElement | undefined
  let g: HTMLElement | undefined
  const childProps = Match.value(opts.child).pipe(
    Match.when("anchor-false", () => ({ layoutAnchor: false as const })),
    Match.when("layout-root", () => ({ layoutRoot: true })),
    Match.orElse(() => ({})),
  )
  render(() => (
    <WardicProvider env={DomLive}>
      <div style={{ position: "absolute", top: "40px", left: "40px", width: "400px" }}>
        <wardic.div layout style={{ width: "200px", height: `${sibling()}px` }} />
        <wardic.div
          layout
          drag
          layoutDependency={dHeight()}
          // eslint-disable-next-line solid/reactivity
          ref={(n: HTMLElement) => (d = n)}
          style={{ position: "relative", width: "160px", height: `${dHeight()}px` }}
        >
          <wardic.div
            layout
            layoutDependency={c1x()}
            {...childProps}
            // eslint-disable-next-line solid/reactivity
            ref={(n: HTMLElement) => (c1 = n)}
            style={{ position: "absolute", left: `${c1x()}px`, top: `${C1_AT.y}px`, width: "30px", height: "30px" }}
          >
            {/* eslint-disable-next-line solid/reactivity */}
            <wardic.div layout ref={(n: HTMLElement) => (g = n)} style={{ position: "absolute", left: "5px", top: "5px", width: "10px", height: "10px" }} />
          </wardic.div>
          {/* eslint-disable-next-line solid/reactivity */}
          <div ref={(n: HTMLDivElement) => (c2 = n)} style={{ position: "absolute", left: `${C2_AT.x}px`, top: `${C2_AT.y}px`, width: "30px", height: "30px" }} />
          {opts.indicator === true && (
            <Show
              when={tab() === 0}
              fallback={<wardic.div layoutId="ind" data-ind style={{ position: "absolute", left: "130px", top: "60px", width: "30px", height: "6px" }} />}
            >
              <wardic.div layoutId="ind" data-ind style={{ position: "absolute", left: "100px", top: "60px", width: "30px", height: "6px" }} />
            </Show>
          )}
        </wardic.div>
      </div>
    </WardicProvider>
  ))
  await settle()
  const els: Els = { d: d!, c1: c1!, c2: c2! }
  const r = els.d.getBoundingClientRect()
  const start = { left: r.left, top: r.top }
  const held = { left: start.left + DRAG.x, top: start.top + DRAG.y }
  return { els, g: g!, start, held, setSibling, setDHeight, setC1x, setTab }
}

/** The frames painted before and after `trigger`, which runs in a task after a paint. */
const acrossTrigger = async (els: Els, n: number, trigger: () => void) => {
  const sampling = paintedReads(n, boxesOf(els))
  for (let i = 0; i < 4; i++) await raf()
  await afterPaint()
  const triggerAt = performance.now()
  trigger()
  const frames = await sampling
  return {
    before: frames.filter((f) => f.t < triggerAt),
    after: frames.filter((f) => f.frameAt > triggerAt),
  }
}

it("T1: a resting layout child stays on the dragged node while it is held and through the release", async () => {
  const { els, start, held } = await mountScene()
  await grab(els.d, start)
  const holding = await paintedReads(10, boxesOf(els))
  const rel = await release(els)
  const last = rel[rel.length - 1]!.v

  expect.soft(maxOff(holding, held), "D under the pointer").toBeLessThanOrEqual(1)
  expect.soft(maxDrift(holding, "c2", C2_AT), "plain child C2 glued (CSS)").toBeLessThan(1)
  expect.soft(maxDrift(holding, "c1", C1_AT), "layout child C1 glued while held").toBeLessThan(1)
  expect.soft(maxDrift(rel, "c1", C1_AT), "layout child C1 glued through the release").toBeLessThan(1)
  expect.soft(Math.abs(last.d.top - start.top), "released D ends on its slot").toBeLessThan(1)
})

it("T2: a sibling resize mid-drag (the engine observer's pass) keeps D under the pointer and its children glued; the release ends on the new slot", async () => {
  const { els, start, held, setSibling } = await mountScene()
  await grab(els.d, start)
  const { before, after } = await acrossTrigger(els, 30, () => setSibling(100)) // D's slot moves down by 60
  const rel = await release(els)
  const slot = { left: start.left, top: start.top + 60 }
  const last = rel[rel.length - 1]!.v

  expect.soft(maxOff([...before, ...after], held), "D under the pointer across the pass").toBeLessThanOrEqual(1)
  expect.soft(maxDrift([...before, ...after], "c2", C2_AT), "plain child C2 glued").toBeLessThan(1)
  expect.soft(maxDrift([...before, ...after], "c1", C1_AT), "layout child C1 glued across the pass").toBeLessThan(1)
  expect.soft(Math.abs(rel[0]!.v.d.top - held.top), "the release starts at the held box").toBeLessThan(15)
  expect.soft(Math.abs(last.d.left - slot.left), "the release ends on the new slot (x)").toBeLessThan(1)
  expect.soft(Math.abs(last.d.top - slot.top), "the release ends on the new slot (y)").toBeLessThan(1)
  expect.soft(maxDrift(rel, "c1", C1_AT), "layout child C1 glued through the release").toBeLessThan(1)
})

it("T3: two slot moves in one drag keep the layout child glued; the release ends on the latest slot", async () => {
  const { els, start, held, setSibling } = await mountScene()
  await grab(els.d, start)
  const first = await acrossTrigger(els, 20, () => setSibling(100)) // slot +60
  const second = await acrossTrigger(els, 20, () => setSibling(160)) // slot +120
  const rel = await release(els)
  const last = rel[rel.length - 1]!.v
  const frames = [...first.before, ...first.after, ...second.after]

  expect.soft(maxOff(frames, held), "D under the pointer across both passes").toBeLessThanOrEqual(1)
  expect.soft(maxDrift(first.after, "c1", C1_AT), "C1 glued across the first pass").toBeLessThan(1)
  expect.soft(maxDrift(second.after, "c1", C1_AT), "C1 glued across the second pass").toBeLessThan(1)
  expect.soft(maxDrift(frames, "c2", C2_AT), "C2 glued").toBeLessThan(1)
  expect.soft(Math.abs(rel[0]!.v.d.top - held.top), "the release starts at the held box").toBeLessThan(15)
  expect.soft(Math.abs(last.d.top - (start.top + 120)), "the release ends on the latest slot").toBeLessThan(1)
  expect.soft(maxDrift(rel, "c1", C1_AT), "C1 glued through the release").toBeLessThan(1)
})

it("T4: a reorder mid-drag (a <LayoutGroup layoutDependency> pass, from a task) keeps D under the pointer and its children glued", async () => {
  const [order, setOrder] = createSignal<ReadonlyArray<"s" | "d">>(["s", "d"])
  let d: HTMLElement | undefined
  let c1: HTMLElement | undefined
  let c2: HTMLElement | undefined
  render(() => (
    <WardicProvider env={DomLive}>
      <div style={{ position: "absolute", top: "40px", left: "40px", width: "400px" }}>
        <LayoutGroup layoutDependency={order()}>
          <For each={order()}>
            {(key) =>
              Bool.match(key === "s", {
                onTrue: () => <wardic.div layout style={{ width: "200px", height: "40px" }} />,
                onFalse: () => (
                  // eslint-disable-next-line solid/reactivity
                  <wardic.div layout drag ref={(n: HTMLElement) => (d = n)} style={{ position: "relative", width: "160px", height: "80px" }}>
                    {/* eslint-disable-next-line solid/reactivity */}
                    <wardic.div layout ref={(n: HTMLElement) => (c1 = n)} style={{ position: "absolute", left: "10px", top: "10px", width: "30px", height: "30px" }} />
                    {/* eslint-disable-next-line solid/reactivity */}
                    <div ref={(n: HTMLDivElement) => (c2 = n)} style={{ position: "absolute", left: "60px", top: "10px", width: "30px", height: "30px" }} />
                  </wardic.div>
                ),
              })
            }
          </For>
        </LayoutGroup>
      </div>
    </WardicProvider>
  ))
  await settle()
  const els: Els = { d: d!, c1: c1!, c2: c2! }
  const r = els.d.getBoundingClientRect()
  const start = { left: r.left, top: r.top }
  const held = { left: start.left + DRAG.x, top: start.top + DRAG.y }

  await grab(els.d, start)
  const { before, after } = await acrossTrigger(els, 30, () => setOrder(["d", "s"])) // D moves above S: slot -40
  const rel = await release(els)
  const last = rel[rel.length - 1]!.v

  expect.soft(maxOff([...before, ...after], held), "D under the pointer across the pass").toBeLessThanOrEqual(1)
  expect.soft(maxDrift([...before, ...after], "c1", C1_AT), "C1 glued").toBeLessThan(1)
  expect.soft(maxDrift([...before, ...after], "c2", C2_AT), "C2 glued").toBeLessThan(1)
  expect.soft(Math.abs(rel[0]!.v.d.top - held.top), "the release starts at the held box").toBeLessThan(15)
  expect.soft(Math.abs(last.d.top - (start.top - 40)), "the release ends on the new slot").toBeLessThan(1)
  expect.soft(maxDrift(rel, "c1", C1_AT), "C1 glued through the release").toBeLessThan(1)
})

it("T5: a layout child already animating when its parent is grabbed keeps animating on the dragged node", async () => {
  const { els, start, setC1x } = await mountScene()
  const sampling = paintedReads(50, boxesOf(els))
  await raf()
  setC1x(110) // C1 starts a FLIP from 10 to 110 inside D
  for (let i = 0; i < 3; i++) await raf()
  const grabAt = performance.now()
  await grab(els.d, start)
  const frames = await sampling
  const fromGrab = frames.filter((f) => f.frameAt > grabAt)
  let maxJump = 0
  for (let i = 1; i < fromGrab.length; i++) {
    const a = fromGrab[i - 1]!.v
    const b = fromGrab[i]!.v
    maxJump = Math.max(maxJump, Math.abs(b.c1.left - b.d.left - (a.c1.left - a.d.left)))
  }
  const lastFrame = fromGrab[fromGrab.length - 1]!.v

  expect.soft(maxJump, "C1's offset from D moves in animation steps, never a jump").toBeLessThan(15)
  expect
    .soft(Math.max(...fromGrab.map((f) => Math.abs(f.v.c1.top - f.v.d.top - C1_AT.y))), "C1 keeps its row on D")
    .toBeLessThan(1)
  expect.soft(Math.abs(lastFrame.c1.left - lastFrame.d.left - 110), "C1 arrives at its new offset on D").toBeLessThan(2)
  els.d.dispatchEvent(up(DRAG.x, DRAG.y))
})

it("T6: a resting layout child whose offset inside the dragged node changes snaps to it", async () => {
  const { els, start, setC1x } = await mountScene()
  await grab(els.d, start)
  const { after } = await acrossTrigger(els, 12, () => setC1x(110))
  expect(maxDrift(after, "c1", { x: 110, y: C1_AT.y }), "C1 at its new offset from the first painted frame").toBeLessThan(1)
  els.d.dispatchEvent(up(DRAG.x, DRAG.y))
})

it("T7: a layoutId switch inside the dragged node snaps", async () => {
  const { els, start, setTab } = await mountScene({ indicator: true })
  const indicator = (): HTMLElement => document.querySelector<HTMLElement>("[data-ind]")!
  await grab(els.d, start)
  const sampling = paintedReads(12, () => ({ d: els.d.getBoundingClientRect(), ind: indicator().getBoundingClientRect() }))
  for (let i = 0; i < 4; i++) await raf()
  await afterPaint()
  const triggerAt = performance.now()
  setTab(1) // the indicator moves from x 100 to x 130 inside D, as a layoutId switch
  const frames = (await sampling).filter((f) => f.frameAt > triggerAt)
  const drift = Math.max(
    ...frames.map((f) => Math.max(Math.abs(f.v.ind.left - f.v.d.left - 130), Math.abs(f.v.ind.top - f.v.d.top - 60))),
  )
  expect(drift, "the switched indicator sits at its new offset on D from the first painted frame").toBeLessThan(1)
  els.d.dispatchEvent(up(DRAG.x, DRAG.y))
})

it("T8: a `layoutAnchor: false` child and a `layoutRoot` child stay on the dragged node", async () => {
  const anchorFalse = await mountScene({ child: "anchor-false" })
  await grab(anchorFalse.els.d, anchorFalse.start)
  const a = await paintedReads(8, boxesOf(anchorFalse.els))
  anchorFalse.els.d.dispatchEvent(up(DRAG.x, DRAG.y))
  cleanup()

  const root = await mountScene({ child: "layout-root" })
  await grab(root.els.d, root.start)
  const r = await paintedReads(8, () => ({ ...boxesOf(root.els)(), g: root.g.getBoundingClientRect() }))
  root.els.d.dispatchEvent(up(DRAG.x, DRAG.y))

  expect.soft(maxDrift(a, "c1", C1_AT), "the `layoutAnchor: false` child stays on D").toBeLessThan(1)
  expect.soft(maxDrift(r, "c1", C1_AT), "the `layoutRoot` child stays on D").toBeLessThan(1)
  expect
    .soft(Math.max(...r.map((f) => Math.abs(f.v.g.left - f.v.c1.left - 5))), "the layoutRoot's own child stays on it")
    .toBeLessThan(1)
})

it("T9: a dragged layoutId Lead with a Follower keeps opacity 1 through a mid-drag pass", async () => {
  const [sibling, setSibling] = createSignal(40)
  let lead: HTMLElement | undefined
  let follower: HTMLElement | undefined
  render(() => (
    <WardicProvider env={DomLive}>
      <div style={{ position: "absolute", top: "40px", left: "300px", width: "100px" }}>
        {/* eslint-disable-next-line solid/reactivity */}
        <wardic.div layoutId="twin" ref={(n: HTMLElement) => (follower = n)} style={{ width: "60px", height: "60px" }} />
      </div>
      <div style={{ position: "absolute", top: "40px", left: "40px", width: "200px" }}>
        <wardic.div layout layoutDependency={sibling()} style={{ width: "100px", height: `${sibling()}px` }} />
        {/* eslint-disable-next-line solid/reactivity */}
        <wardic.div layoutId="twin" drag ref={(n: HTMLElement) => (lead = n)} style={{ width: "60px", height: "60px" }} />
      </div>
    </WardicProvider>
  ))
  // Let the mount crossfade (the Lead animating from the Follower's box) settle.
  await until(() => Number(getComputedStyle(lead!).opacity) === 1 && Number(getComputedStyle(follower!).opacity) === 0, 3000)
  for (let i = 0; i < 10; i++) await raf()
  await afterPaint()
  const r = lead!.getBoundingClientRect()
  await grab(lead!, { left: r.left, top: r.top })
  const sampling = paintedReads(10, () => Number(getComputedStyle(lead!).opacity))
  for (let i = 0; i < 2; i++) await raf()
  await afterPaint()
  setSibling(100) // a pass moves the Lead's slot
  const opacities = await sampling
  expect(Math.min(...opacities.map((f) => f.v)), "the dragged Lead stays opaque").toBeGreaterThan(0.99)
  lead!.dispatchEvent(up(DRAG.x, DRAG.y))
})

it("T10: a slot resize mid-drag paints D at its new size about the same centre, its children unscaled", async () => {
  const { els, start, held, setDHeight } = await mountScene()
  await grab(els.d, start)
  const { after } = await acrossTrigger(els, 12, () => setDHeight(120)) // D's slot: 80 -> 120 tall
  const heldCentreY = held.top + 40
  expect.soft(Math.max(...after.map((f) => Math.abs(f.v.d.height - 120))), "D paints its new height").toBeLessThan(1)
  expect
    .soft(Math.max(...after.map((f) => Math.abs(f.v.d.top + f.v.d.height / 2 - heldCentreY))), "about the same centre")
    .toBeLessThan(1)
  expect.soft(Math.max(...after.map((f) => Math.abs(f.v.c2.height - 30))), "the plain child C2 is not scaled").toBeLessThan(1)
  expect.soft(Math.max(...after.map((f) => Math.abs(f.v.c1.height - 30))), "the layout child C1 is not scaled").toBeLessThan(1)
  els.d.dispatchEvent(up(DRAG.x, DRAG.y))
})

it("T11: a release from a task moves on its first painted frame; one after the frame's gate flush on its second", async () => {
  const heldFramesAfterRelease = async (fromFrame: boolean): Promise<number> => {
    const { els, start, held } = await mountScene()
    await grab(els.d, start)
    const sampling = paintedReads(8, () => els.d.getBoundingClientRect())
    await raf()
    await afterPaint()
    const releasedAt = performance.now()
    const releaseNow = (): void => {
      els.d.dispatchEvent(up(DRAG.x, DRAG.y))
    }
    // From a task (a real pointerup), or from a rAF callback requested now, which runs
    // after the gate's and the Clock's callbacks of the next frame.
    if (fromFrame) requestAnimationFrame(releaseNow)
    else releaseNow()
    const frames = (await sampling).filter((f) => f.frameAt > releasedAt)
    let heldFrames = 0
    for (const f of frames) {
      if (Math.abs(f.v.left - held.left) < 0.05 && Math.abs(f.v.top - held.top) < 0.05) heldFrames++
      else break
    }
    cleanup()
    return heldFrames
  }
  expect.soft(await heldFramesAfterRelease(false), "released from a task: moved on the first painted frame").toBe(0)
  expect.soft(await heldFramesAfterRelease(true), "released after the gate's flush: held one frame").toBe(1)
})

it("T12: a release that lands on the slot, in the same frame as its last move, ends on the slot", async () => {
  const { els, start } = await mountScene()
  await grab(els.d, start, { x: 0, y: 60 })
  // Come back up to the grab point one move per frame, and release right after the last one.
  for (const y of [40, 20, 0]) {
    await raf()
    els.d.dispatchEvent(move(0, y))
  }
  els.d.dispatchEvent(up(0, 0))
  const frames = await paintedReads(40, () => els.d.getBoundingClientRect())
  const last = frames[frames.length - 1]!.v
  expect.soft(Math.abs(last.top - start.top), "D ends on its slot (y)").toBeLessThan(0.5)
  expect.soft(Math.abs(last.left - start.left), "D ends on its slot (x)").toBeLessThan(0.5)
})

// Runs under this tier's microtask-backed `setImmediate` (browser-setup.ts). With a
// browser's own scheduler (`setTimeout(0)`), pointer input reaches the drag one hop
// later, so a move paints a frame later (#32; the layout lab's scenario 11 shows both).
it("T13: with real mouse input, a dragged layout node paints each move in the frame it was delivered", async () => {
  let d: HTMLElement | undefined
  render(() => (
    <WardicProvider env={DomLive}>
      <div style={{ position: "absolute", top: "40px", left: "40px" }}>
        {/* eslint-disable-next-line solid/reactivity */}
        <wardic.div layout drag ref={(n: HTMLElement) => (d = n)} style={{ position: "relative", width: "120px", height: "80px" }} />
      </div>
    </WardicProvider>
  ))
  await settle()
  const el = d!
  const slot = el.getBoundingClientRect()
  // Page-side record: every frame's rAF time and painted left, every delivered move.
  const frames: Array<{ cbAt: number; left: number }> = []
  const moves: Array<{ t: number; x: number }> = []
  let downX = 0
  const onDown = (e: PointerEvent): void => {
    downX = e.clientX
  }
  const onMove = (e: PointerEvent): void => {
    moves.push({ t: performance.now(), x: e.clientX })
  }
  window.addEventListener("pointerdown", onDown, true)
  window.addEventListener("pointermove", onMove, true)
  let recording = true
  const channel = new MessageChannel()
  let cbAt = 0
  const tick = (): void => {
    cbAt = performance.now()
    channel.port2.postMessage(undefined)
  }
  channel.port1.onmessage = () => {
    frames.push({ cbAt, left: el.getBoundingClientRect().left })
    if (recording) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
  try {
    const x0 = slot.left + 20
    const y0 = slot.top + 20
    await commands.realMouse("down", x0, y0)
    for (let k = 1; k <= 3; k++) {
      await commands.realMouse("move", x0 + 2 * k, y0) // past the recognizer's threshold
      await wait(20)
    }
    await wait(200)
    const since = performance.now()
    for (let k = 1; k <= 30; k++) {
      await commands.realMouse("move", x0 + 6 + 8 * k, y0)
      await wait(16)
    }
    await wait(100)
    recording = false
    await commands.realMouse("up", x0 + 6 + 8 * 30, y0)
    // Per move: the frame it was delivered in (the first whose rAF ran after it) and the
    // first frame from there whose box reached its position.
    const lags: Array<number> = []
    for (const m of moves.filter((mv) => mv.t > since)) {
      const want = slot.left + (m.x - downX)
      const delivered = frames.findIndex((f) => f.cbAt > m.t)
      if (delivered < 0) continue
      const painted = frames.findIndex((f, i) => i >= delivered && f.left >= want - 0.5)
      if (painted >= 0) lags.push(painted - delivered)
    }
    expect.soft(lags.length, "moves measured").toBeGreaterThan(20)
    expect.soft(Math.max(...lags), "every move painted in the frame it was delivered").toBe(0)
  } finally {
    recording = false
    window.removeEventListener("pointerdown", onDown, true)
    window.removeEventListener("pointermove", onMove, true)
  }
})

it("T14: a dragged node inside a FLIPing layout parent stays under the pointer, through a mid-drag pass too", async () => {
  const [parentX, setParentX] = createSignal(0)
  let d: HTMLElement | undefined
  render(() => (
    <WardicProvider env={DomLive}>
      <wardic.div
        layout
        layoutDependency={parentX()}
        style={{ position: "absolute", top: "40px", left: `${40 + parentX()}px`, width: "300px", height: "200px" }}
      >
        {/* eslint-disable-next-line solid/reactivity */}
        <wardic.div layout drag ref={(n: HTMLElement) => (d = n)} style={{ position: "absolute", left: "20px", top: "20px", width: "80px", height: "60px" }} />
      </wardic.div>
    </WardicProvider>
  ))
  await settle()
  const el = d!
  const r = el.getBoundingClientRect()
  const start = { left: r.left, top: r.top }
  await grab(el, start, { x: 10, y: 0 })
  // Move the pointer 10 px per frame from a task after each paint (where real input
  // lands); after 3 moves the parent FLIPs 120 px right, moving D's slot with it.
  const offs: Array<number> = []
  for (let k = 2; k <= 20; k++) {
    await afterPaint()
    if (k === 5) setParentX(120)
    const painted = paintedReads(1, () => el.getBoundingClientRect())
    el.dispatchEvent(move(10 * k, 0))
    const [f] = await painted
    offs.push(Math.max(Math.abs(f!.v.left - (start.left + 10 * k)), Math.abs(f!.v.top - start.top)))
  }
  expect(Math.max(...offs), "D under the pointer in every painted frame").toBeLessThanOrEqual(1)
  el.dispatchEvent(up(200, 0))
})

it("T15: grabbing a node during its own scale FLIP leaves no stale projection on a resting child", async () => {
  const [wide, setWide] = createSignal(false)
  let d: HTMLElement | undefined
  let c1: HTMLElement | undefined
  render(() => (
    <WardicProvider env={DomLive}>
      <div style={{ position: "absolute", top: "40px", left: "40px" }}>
        <wardic.div
          layout
          drag
          layoutDependency={wide()}
          // eslint-disable-next-line solid/reactivity
          ref={(n: HTMLElement) => (d = n)}
          style={{ position: "relative", width: Bool.match(wide(), { onTrue: () => "320px", onFalse: () => "160px" }), height: "80px" }}
        >
          {/* eslint-disable-next-line solid/reactivity */}
          <wardic.div layout ref={(n: HTMLElement) => (c1 = n)} style={{ position: "absolute", left: "10px", top: "10px", width: "30px", height: "30px" }} />
        </wardic.div>
      </div>
    </WardicProvider>
  ))
  await settle()
  const el = d!
  setWide(true) // D FLIPs its width 160 -> 320; C1 is counter-scaled while it runs
  for (let i = 0; i < 4; i++) await raf()
  el.dispatchEvent(down(0, 0))
  el.dispatchEvent(move(DRAG.x, DRAG.y))
  for (let i = 0; i < 6; i++) await raf()
  const frames = await paintedReads(6, () => c1!.getBoundingClientRect())
  expect(
    Math.max(...frames.map((f) => Math.max(Math.abs(f.v.width - 30), Math.abs(f.v.height - 30)))),
    "C1 keeps its own size",
  ).toBeLessThan(0.5)
  el.dispatchEvent(up(DRAG.x, DRAG.y))
})

it("T16: a dragged `layoutRoot` node stays under the pointer through a mid-drag pass", async () => {
  const [sibling, setSibling] = createSignal(40)
  let d: HTMLElement | undefined
  render(() => (
    <WardicProvider env={DomLive}>
      <div style={{ position: "absolute", top: "40px", left: "40px", width: "400px" }}>
        <wardic.div layout style={{ width: "200px", height: `${sibling()}px` }} />
        {/* eslint-disable-next-line solid/reactivity */}
        <wardic.div layoutRoot drag ref={(n: HTMLElement) => (d = n)} style={{ position: "relative", width: "160px", height: "80px" }} />
      </div>
    </WardicProvider>
  ))
  await settle()
  const el = d!
  const r = el.getBoundingClientRect()
  const start = { left: r.left, top: r.top }
  await grab(el, start)
  const sampling = paintedReads(20, () => el.getBoundingClientRect())
  for (let i = 0; i < 4; i++) await raf()
  await afterPaint()
  const triggerAt = performance.now()
  setSibling(100) // the engine observer's pass moves the layoutRoot's slot down by 60
  const frames = (await sampling).filter((f) => f.frameAt > triggerAt)
  const off = Math.max(...frames.map((f) => Math.max(Math.abs(f.v.left - (start.left + DRAG.x)), Math.abs(f.v.top - (start.top + DRAG.y)))))
  expect(off, "the dragged layoutRoot under the pointer across the pass").toBeLessThanOrEqual(1)
  el.dispatchEvent(up(DRAG.x, DRAG.y))
})

it("T17: a running descendant keeps its animation, without a jump, through a mid-drag pass and through the release", async () => {
  // Under a `layoutRoot` inside D too, through the release: the root's target carries D's
  // drag and its Release offset, and the child's correction counts D (ADR-0013, Amendment
  // (#33); before, the child jumped about 100 px at the release).
  /** Frame-to-frame change of `child`'s offset from D, at its largest. */
  const maxJumpOf = (frames: ReadonlyArray<Painted<{ d: DOMRect; child: DOMRect }>>): number => {
    let jump = 0
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i - 1]!.v
      const b = frames[i]!.v
      jump = Math.max(
        jump,
        Math.abs(b.child.left - b.d.left - (a.child.left - a.d.left)),
        Math.abs(b.child.top - b.d.top - (a.child.top - a.d.top)),
      )
    }
    return jump
  }
  const run = async (under: "d" | "layout-root") => {
    const [sibling, setSibling] = createSignal(40)
    const [x, setX] = createSignal(10)
    let d: HTMLElement | undefined
    let child: HTMLElement | undefined
    const springy = { stiffness: 30, damping: 12 } // slow, so it is still running at the release
    const Runner = () => (
      <wardic.div
        layout
        layoutDependency={x()}
        transition={springy}
        // eslint-disable-next-line solid/reactivity
        ref={(n: HTMLElement) => (child = n)}
        style={{ position: "absolute", left: `${x()}px`, top: "10px", width: "20px", height: "20px" }}
      />
    )
    render(() => (
      <WardicProvider env={DomLive}>
        <div style={{ position: "absolute", top: "40px", left: "40px", width: "400px" }}>
          <wardic.div layout style={{ width: "200px", height: `${sibling()}px` }} />
          {/* eslint-disable-next-line solid/reactivity */}
          <wardic.div layout drag ref={(n: HTMLElement) => (d = n)} style={{ position: "relative", width: "200px", height: "80px" }}>
            {Bool.match(under === "d", {
              onTrue: () => <Runner />,
              onFalse: () => (
                <wardic.div layoutRoot style={{ position: "absolute", left: "0px", top: "0px", width: "200px", height: "80px" }}>
                  <Runner />
                </wardic.div>
              ),
            })}
          </wardic.div>
        </div>
      </WardicProvider>
    ))
    await settle()
    const el = d!
    const r = el.getBoundingClientRect()
    const sampling = paintedReads(45, () => ({ d: el.getBoundingClientRect(), child: child!.getBoundingClientRect() }))
    setX(150) // the child starts a slow FLIP inside D
    for (let i = 0; i < 3; i++) await raf()
    await grab(el, { left: r.left, top: r.top })
    await afterPaint()
    setSibling(100) // a mid-drag pass moves D's slot (and the running child's box) down by 60
    for (let i = 0; i < 6; i++) await raf()
    el.dispatchEvent(up(DRAG.x, DRAG.y)) // released while the child still runs
    const frames = await sampling
    cleanup()
    return maxJumpOf(frames)
  }
  expect.soft(await run("d"), "a running child of D: no jump").toBeLessThan(15)
  expect.soft(await run("layout-root"), "a running child of a layoutRoot inside D: no jump, through the release").toBeLessThan(15)
})

it("T18: a `layoutAnchor: false` child stays on the dragged node through the release", async () => {
  const { els, start } = await mountScene({ child: "anchor-false" })
  await grab(els.d, start)
  const rel = await release(els)
  expect(maxDrift(rel, "c1", C1_AT), "the `layoutAnchor: false` child glued while D flies back").toBeLessThan(1)
  expect(Math.abs(rel[rel.length - 1]!.v.d.top - start.top), "D ends on its slot").toBeLessThan(1)
})

/**
 * The lab's s12 (#691): a `layout` sibling above the draggable `layout` item D, which holds the lab's
 * children: C1 (`layout`), C2 (`layoutAnchor: false`), M (`layout`, its `layoutDependency` flipped at each
 * press), and R, a `layoutRoot` (with `layout` too, given `rootLayout`) holding its own `layout` child G.
 * `grabMidFlight` moves D's slot at rest (the lab's X), waits `wait` frames into D's FLIP, grabs D with the
 * real mouse, drags it `hold` moves 16 ms apart, releases it, and returns R's offset from D in every frame
 * painted from the X until D has landed, and G's from R at the end.
 */
const layoutRootScene = async (opts: { readonly rootLayout: boolean }) => {
  const [tall, setTall] = createSignal(false)
  const [mRight, setMRight] = createSignal(false)
  let d: HTMLElement | undefined
  let r: HTMLElement | undefined
  let g: HTMLElement | undefined
  const BOX = { display: "flex", "align-items": "center", "justify-content": "center", overflow: "hidden", "border-radius": "6px" } as const
  const child = (left: number, top: number) => ({ position: "absolute", left: `${left}px`, top: `${top}px`, width: "28px", height: "28px" }) as const
  render(() => (
    <WardicProvider env={DomLive}>
      <div style={{ position: "relative", width: "340px", height: "260px", overflow: "hidden", "margin-top": "40px", "margin-left": "40px" }}>
        <div style={{ padding: "16px 20px" }}>
          <wardic.div layout style={{ ...BOX, width: "200px", height: Bool.match(tall(), { onTrue: () => "70px", onFalse: () => "20px" }) }} />
          <wardic.div
            layout
            drag
            // eslint-disable-next-line solid/reactivity
            ref={(n: HTMLElement) => (d = n)}
            style={{ ...BOX, position: "relative", width: "220px", height: "96px", "touch-action": "none", "user-select": "none" }}
            onPointerDown={() => setMRight((v) => !v)}
          >
            <wardic.div layout style={child(10, 10)} />
            <wardic.div layout layoutAnchor={false} style={child(50, 10)} />
            {/* eslint-disable-next-line solid/reactivity */}
            <wardic.div layout={opts.rootLayout} layoutRoot ref={(n: HTMLElement) => (r = n)} style={{ ...child(90, 10), width: "40px", height: "40px" }}>
              {/* eslint-disable-next-line solid/reactivity */}
              <wardic.div layout ref={(n: HTMLElement) => (g = n)} style={{ ...child(8, 8), width: "12px", height: "12px" }} />
            </wardic.div>
            <wardic.div
              layout
              layoutDependency={mRight()}
              transition={{ stiffness: 30, damping: 12 }}
              style={{ ...child(Bool.match(mRight(), { onTrue: () => 180, onFalse: () => 10 }), 60), width: "24px", height: "24px" }}
            />
          </wardic.div>
        </div>
      </div>
    </WardicProvider>
  ))
  await settle()
  const offsetOf = (): { x: number; y: number } => {
    const dBox = d!.getBoundingClientRect()
    const rBox = r!.getBoundingClientRect()
    return { x: rBox.left - dBox.left, y: rBox.top - dBox.top }
  }
  const rest = offsetOf()
  const grabMidFlight = async (wait: number, hold: number) => {
    const sampling = paintedReads(130, offsetOf)
    await raf()
    setTall((t) => !t) // D's slot moves 50 px at rest, and D FLIPs to it
    for (let i = 0; i < wait; i++) await raf()
    // The real mouse, as the lab's: a press, then moves 16 ms apart, then a release.
    const box = d!.getBoundingClientRect()
    const x0 = box.left + box.width / 2
    const y0 = box.top + box.height / 2
    await commands.realMouse("down", x0, y0)
    const grabAt = performance.now()
    for (let k = 1; k <= hold; k++) {
      await commands.realMouse("move", x0 + 6 * k, y0 + 4 * k)
      await new Promise((resolve) => setTimeout(resolve, 16))
    }
    await commands.realMouse("up", x0 + 6 * hold, y0 + 4 * hold)
    const frames = await sampling
    const gBox = g!.getBoundingClientRect()
    const rBox = r!.getBoundingClientRect()
    return { frames, grabAt, end: offsetOf(), g: { x: gBox.left - rBox.left, y: gBox.top - rBox.top } }
  }
  return { rest, grabMidFlight }
}

/** How far apart two offsets are, on either axis. */
const apartBy = (a: { readonly x: number; readonly y: number }, b: { readonly x: number; readonly y: number }): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))

it("T19 (#691): a `layoutRoot` alone rides D's layout animation: on D at its place in every frame, through a grab mid-flight and the release", async () => {
  const scene = await layoutRootScene({ rootLayout: false })
  const run = await scene.grabMidFlight(4, 6)
  const worst = Math.max(...run.frames.map((f) => apartBy(f.v, scene.rest)))
  expect.soft(worst, `R's offset from D, worst off its ${JSON.stringify(scene.rest)} (Motion's: 0 every frame)`).toBeLessThan(1)
  expect.soft(apartBy(run.g, { x: 8, y: 8 }), "G on R").toBeLessThan(1)
})

it("T19b (#691): a `layout layoutRoot` is isolated from D's layout animation: at its new place at a grab mid-flight, at its place in D once D's flight has ended", async () => {
  const scene = await layoutRootScene({ rootLayout: true })
  const run = await scene.grabMidFlight(4, 6)
  const atGrab = run.frames.find((f) => f.frameAt > run.grabAt)!
  // At its new place while D flies, as Motion's: off its place in D by D's remaining flight.
  expect.soft(apartBy(atGrab.v, scene.rest), `R's offset from D at the grab: ${JSON.stringify(atGrab.v)}`).toBeGreaterThan(10)
  expect.soft(apartBy(run.end, scene.rest), `R's offset from D at the end: ${JSON.stringify(run.end)}`).toBeLessThan(1)
  expect.soft(apartBy(run.g, { x: 8, y: 8 }), "G on R").toBeLessThan(1)
})
