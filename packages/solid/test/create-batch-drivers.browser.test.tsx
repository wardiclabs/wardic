// The latest driver of a Batch member's keys on Solid 1 (#665, PR 4, ADR-0069 decision 17, Q52–Q55): a
// Wardic element on a member's own element takes its transform from the Batch as one of its legs starts,
// and the Batch takes it back as the leg ends, or at its own next change of the member.
//
// - CD1: mid-flight, a ward's `scale` leg takes the member's transform: its `x` holds where the Batch had
//   it while the ward's `scale` runs as a plain ward's does, frame for frame; as the leg lands, the Batch
//   takes both back and turns them toward its targets.
// - CD2: a Batch change during the ward's leg takes the transform back at once: `scale` turns toward the
//   Batch's, and `x` heads for its new target.
// - CD3: dragged, the member follows the pointer, a Batch change mid-drag leaving `x` to it; once its
//   release rests (`dragMomentum={false}`: where it's let go), the Batch turns it toward its target.
// - CD4: an element given two Batches' handles, and `layout` on a member's ward, are errors.
import { render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { createBatch, wardic, WardicProvider } from "@wardic/solid"
import { createSignal, type JSX } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf } from "./browser-helpers.ts"
import { centreOf, glide, mouse, resetScene } from "./reorder-harness.tsx"

afterEach(resetScene)

const BOX: JSX.CSSProperties = { width: "40px", height: "40px", background: "teal" }
const SPRING = { type: "spring", stiffness: 210, damping: 20 } as const
const TWEEN = { type: "tween", duration: 0.3 } as const

const matrixOf = (el: Element): DOMMatrix => new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)"))
const xOf = (el: Element): number => matrixOf(el).m41
const scaleOf = (el: Element): number => matrixOf(el).a

/** `frames` frames of `read`, read after each. */
const over = async <A,>(frames: number, read: () => A): Promise<ReadonlyArray<A>> => {
  const out: Array<A> = []
  for (let f = 0; f < frames; f++) {
    await raf()
    out.push(read())
  }
  return out
}

/** A one-member Batch on `x` and `scale`, its member a `wardic.div` animating `scale`, and a plain `wardic.div` beside it doing the same. */
const mountWard = () => {
  const [tx, setTx] = createSignal(0)
  const [s, setS] = createSignal(1)
  let member!: HTMLDivElement
  let reference!: HTMLDivElement
  const Scene = (): JSX.Element => {
    const grid = createBatch({ count: 1, initial: false, animate: () => ({ x: tx(), scale: 1 }), transition: SPRING })
    return (
      <>
        <wardic.div style={BOX} {...grid.at(0, { ref: (el) => (member = el as HTMLDivElement) })} animate={{ scale: s() }} transition={TWEEN} />
        <wardic.div ref={reference} style={BOX} animate={{ scale: s() }} transition={TWEEN} />
      </>
    )
  }
  render(() => (
    <WardicProvider env={DomLive}>
      <Scene />
    </WardicProvider>
  ))
  return { setTx, setS, member: () => member, reference: () => reference }
}

describe("the latest driver of a Batch member's keys on Solid 1 (#665)", () => {
  it("CD1: a ward's leg takes the member's transform mid-flight; the Batch takes it back as the leg lands", async () => {
    const scene = mountWard()
    await over(4, () => 0)
    scene.setTx(100)
    await over(6, () => 0)
    scene.setS(1.5)
    const held = await over(16, () => [xOf(scene.member()), scaleOf(scene.member()), scaleOf(scene.reference())] as const)
    // x holds where the Batch had it; scale runs as the plain ward's.
    const x = held[0][0]
    expect(x).toBeGreaterThan(5)
    expect(x).toBeLessThan(95)
    held.forEach(([at, scale, reference], f) => {
      expect(at, `frame ${f}: x held`).toBeCloseTo(x, 6)
      expect(scale, `frame ${f}: scale`).toBeCloseTo(reference, 6)
    })
    expect(held[held.length - 1][1]).toBeGreaterThan(1.3)
    // The leg lands: the Batch takes both back, x to 100 and scale to its 1.
    const after = await over(90, () => [xOf(scene.member()), scaleOf(scene.member())] as const)
    expect(after[after.length - 1]).toEqual([100, 1])
    expect(after.some(([at]) => at > x + 1 && at < 99)).toBe(true)
  })

  it("CD2: a Batch change during the ward's leg takes the transform back at once", async () => {
    const scene = mountWard()
    await over(4, () => 0)
    scene.setS(1.5)
    await over(6, () => 0)
    const taken = scaleOf(scene.member())
    scene.setTx(50)
    const after = await over(60, () => [xOf(scene.member()), scaleOf(scene.member()), scaleOf(scene.reference())] as const)
    // The plain ward's scale still rises; the member's turns toward the Batch's 1 within a frame or two.
    expect(after[3][2]).toBeGreaterThan(taken)
    expect(after[3][1]).toBeLessThan(after[3][2])
    expect(after[after.length - 1].slice(0, 2)).toEqual([50, 1])
  })

  it("CD3: dragged, it follows the pointer, a Batch change mid-drag leaving x; once its release rests, it turns toward its target", async () => {
    const [tx, setTx] = createSignal(0)
    let member!: HTMLDivElement
    const Scene = (): JSX.Element => {
      const grid = createBatch({ count: 1, initial: false, animate: () => ({ x: tx() }), transition: SPRING })
      // No momentum: its release rests where it's let go, so the Batch takes it back then.
      return <wardic.div style={BOX} {...grid.at(0, { ref: (el) => (member = el as HTMLDivElement) })} drag="x" dragMomentum={false} />
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await over(4, () => 0)
    const grab = centreOf(member)
    await mouse.down(grab)
    await glide(grab, { x: grab.x + 80, y: grab.y }, 10, 16)
    await over(2, () => 0)
    expect(xOf(member)).toBeCloseTo(80, 0)
    // A Batch change mid-drag: x stays the pointer's.
    setTx(40)
    await glide({ x: grab.x + 80, y: grab.y }, { x: grab.x + 100, y: grab.y }, 4, 16)
    await over(2, () => 0)
    expect(xOf(member)).toBeCloseTo(100, 0)
    await mouse.up({ x: grab.x + 100, y: grab.y })
    // Released and at rest: the Batch turns it toward its 40, from 100.
    const back = await over(90, () => xOf(member))
    expect(back.some((x) => x > 41 && x < 99)).toBe(true)
    expect(back[back.length - 1]).toBe(40)
  })

  it("CD4: an element given two Batches' handles, and layout on a member's ward, are errors", async () => {
    const Two = (): JSX.Element => {
      const a = createBatch({ count: 1, animate: () => ({ x: 10 }) })
      const b = createBatch({ count: 1, animate: () => ({ x: 20 }) })
      return (
        <div
          ref={(el) => {
            a.at(0).ref(el)
            b.at(0).ref(el)
          }}
        />
      )
    }
    expect(() => render(() => <WardicProvider env={DomLive}><Two /></WardicProvider>)).toThrow(/a member of two Batches/)
    await raf()
    const Laid = (): JSX.Element => {
      const grid = createBatch({ count: 1, animate: () => ({ x: 10 }) })
      return <wardic.div {...grid.at(0)} layout />
    }
    expect(() => render(() => <WardicProvider env={DomLive}><Laid /></WardicProvider>)).toThrow(/`layout` or `layoutId`/)
  })
})
