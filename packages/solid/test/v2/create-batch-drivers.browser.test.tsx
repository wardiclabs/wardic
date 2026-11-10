// The latest driver of a Batch member's keys on Solid 2 (#665, PR 4, ADR-0069 decision 17, Q52–Q55):
// Solid 1's (`../create-batch-drivers.browser.test.tsx`), the member's element a `w.div`.
//
// - CVD1: mid-flight, a ward's `scale` leg takes the member's transform: its `x` holds while the ward's
//   `scale` runs as a plain ward's does, frame for frame; as the leg lands, the Batch takes both back.
// - CVD2: a Batch change during the ward's leg takes the transform back at once.
// - CVD3: dragged, the member follows the pointer, a Batch change mid-drag leaving `x` to it; once its
//   release rests, the Batch turns it toward its target.
// - CVD4: a member's handle given an element with a layout node, or one another Batch's member has, is an
//   error naming the element. (Each is given outside a render: one thrown in a Solid 2 render halts that
//   root's reactive system for the file's later tests. Solid 1's CD4 holds the ones a render throws.)
// - CVD5: a drag starts where the Batch drew the member, not from 0.
// - CVD6: a transform key the Batch doesn't draw keeps the transform the ward's through a Batch change;
//   back at its identity, the Batch takes it back.
import { DomLive } from "@wardic/dom"
import type { JSX } from "@solidjs/web"
import * as InputSource from "@wardic/core/InputSource"
import { createBatch, drag, layout, w, type WardicBatch, WardicProvider } from "@wardic/solid/unstable/v2"
import { TestInput } from "@wardic/test"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { createSignal } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"


const BOX: JSX.CSSProperties = { width: "40px", height: "40px", background: "teal" }
const SPRING = { type: "spring", stiffness: 210, damping: 20 } as const
const TWEEN = { type: "tween", duration: 0.3 } as const

const matrixOf = (el: Element): DOMMatrix => new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)"))
const xOf = (el: Element): number => matrixOf(el).m41
const scaleOf = (el: Element): number => matrixOf(el).a
const turnOf = (el: Element): number => (Math.atan2(matrixOf(el).b, matrixOf(el).a) * 180) / Math.PI

/** `frames` frames of `read`, read after each. */
const over = async <A,>(frames: number, read: () => A): Promise<ReadonlyArray<A>> => {
  const out: Array<A> = []
  for (let f = 0; f < frames; f++) {
    await raf()
    out.push(read())
  }
  return out
}

/** A one-member Batch on `x` and `scale`, its member a `w.div` animating `scale`, and a plain `w.div` beside it doing the same. */
const mountWard = () => {
  const [tx, setTx] = createSignal(0)
  const [s, setS] = createSignal(1)
  let member!: HTMLDivElement
  let reference!: HTMLDivElement
  const Scene = (): JSX.Element => {
    const grid = createBatch({ count: 1, initial: false, animate: () => ({ x: tx(), scale: 1 }), transition: SPRING })
    return (
      <>
        <w.div style={BOX} {...grid.at(0, { ref: (el) => (member = el as HTMLDivElement) })} animate={{ scale: s() }} transition={TWEEN} />
        <w.div ref={(el: HTMLDivElement) => (reference = el)} style={BOX} animate={{ scale: s() }} transition={TWEEN} />
      </>
    )
  }
  mount(() => (
    <WardicProvider env={DomLive}>
      <Scene />
    </WardicProvider>
  ))
  return { setTx, setS, member: () => member, reference: () => reference }
}

describe("the latest driver of a Batch member's keys on Solid 2 (#665)", () => {
  it("CVD1: a ward's leg takes the member's transform mid-flight; the Batch takes it back as the leg lands", async () => {
    const scene = mountWard()
    await over(4, () => 0)
    scene.setTx(100)
    await over(6, () => 0)
    scene.setS(1.5)
    const held = await over(16, () => [xOf(scene.member()), scaleOf(scene.member()), scaleOf(scene.reference())] as const)
    const x = held[0][0]
    expect(x).toBeGreaterThan(5)
    expect(x).toBeLessThan(95)
    held.forEach(([at, scale, reference], f) => {
      expect(at, `frame ${f}: x held`).toBeCloseTo(x, 6)
      expect(scale, `frame ${f}: scale`).toBeCloseTo(reference, 6)
    })
    const after = await over(90, () => [xOf(scene.member()), scaleOf(scene.member())] as const)
    expect(after[after.length - 1]).toEqual([100, 1])
  })

  it("CVD2: a Batch change during the ward's leg takes the transform back at once", async () => {
    const scene = mountWard()
    await over(4, () => 0)
    scene.setS(1.5)
    await over(6, () => 0)
    const taken = scaleOf(scene.member())
    scene.setTx(50)
    const after = await over(60, () => [xOf(scene.member()), scaleOf(scene.member()), scaleOf(scene.reference())] as const)
    expect(after[3][2]).toBeGreaterThan(taken)
    expect(after[3][1]).toBeLessThan(after[3][2])
    expect(after[after.length - 1].slice(0, 2)).toEqual([50, 1])
  })

  it("CVD3: dragged, it follows the pointer, a Batch change mid-drag leaving x; once released, it turns toward its target", async () => {
    // On the Environment's own input, pushed, under a provider with the `drag` Feature.
    const input = Effect.runSync(TestInput.pushable())
    const [tx, setTx] = createSignal(0)
    let member!: HTMLDivElement
    const Scene = (): JSX.Element => {
      const grid = createBatch({ count: 1, initial: false, animate: () => ({ x: tx() }), transition: SPRING })
      return <w.div style={BOX} {...grid.at(0, { ref: (el) => (member = el as HTMLDivElement) })} drag="x" dragMomentum={false} />
    }
    mount(() => (
      <WardicProvider env={input.layer.pipe(Layer.provideMerge(DomLive))} features={[drag]}>
        <Scene />
      </WardicProvider>
    ))
    await over(20, () => 0)
    let t = 0
    const push = (type: InputSource.PointerLikeEvent["type"], x: number): void => {
      t += 20
      Effect.runSync(input.push(InputSource.makePointerLikeEvent({ type, x, y: 0, timeStamp: t })))
    }
    push("down", 0)
    for (let k = 1; k <= 4; k++) push("move", 20 * k)
    await over(3, () => 0)
    expect(xOf(member)).toBeCloseTo(80, 0)
    // A Batch change mid-drag: x stays the pointer's.
    setTx(40)
    push("move", 100)
    await over(3, () => 0)
    expect(xOf(member)).toBeCloseTo(100, 0)
    push("up", 100)
    // Released where it's let go: the Batch turns it toward its 40, from 100.
    const back = await over(90, () => xOf(member))
    expect(back.some((x) => x > 41 && x < 99)).toBe(true)
    expect(back[back.length - 1]).toBe(40)
  })

  it("CVD4: a member's handle on an element with a layout node, or another Batch's member's, is an error naming it", async () => {
    let one!: WardicBatch
    let two!: WardicBatch
    let laid!: HTMLDivElement
    const Scene = (): JSX.Element => {
      one = createBatch({ count: 2, animate: () => ({ x: 10 }) })
      two = createBatch({ count: 1, animate: () => ({ x: 20 }) })
      return <w.div id="laid" ref={(el: HTMLDivElement) => (laid = el)} style={BOX} layout />
    }
    mount(() => (
      <WardicProvider env={DomLive} features={[layout]}>
        <Scene />
      </WardicProvider>
    ))
    await over(2, () => 0)
    expect(() => one.at(0).ref(laid)).toThrow(/\(div#laid\) has `layout` or `layoutId`/)
    const plain = document.createElement("div")
    plain.className = "tile"
    one.at(1).ref(plain)
    expect(() => two.at(0).ref(plain)).toThrow(/an element \(div\.tile\) is a member of two Batches/)
  })

  it("CVD5: a drag starts where the Batch drew the member", async () => {
    const input = Effect.runSync(TestInput.pushable())
    let member!: HTMLDivElement
    const Scene = (): JSX.Element => {
      const grid = createBatch({ count: 1, initial: false, animate: () => ({ x: 60 }), transition: SPRING })
      return <w.div style={BOX} {...grid.at(0, { ref: (el) => (member = el as HTMLDivElement) })} drag="x" dragMomentum={false} />
    }
    mount(() => (
      <WardicProvider env={input.layer.pipe(Layer.provideMerge(DomLive))} features={[drag]}>
        <Scene />
      </WardicProvider>
    ))
    await over(20, () => 0)
    expect(xOf(member)).toBe(60)
    let t = 0
    const push = (type: InputSource.PointerLikeEvent["type"], x: number): void => {
      t += 20
      Effect.runSync(input.push(InputSource.makePointerLikeEvent({ type, x, y: 0, timeStamp: t })))
    }
    push("down", 0)
    for (let k = 1; k <= 4; k++) push("move", 5 * k)
    await over(3, () => 0)
    // The pointer's 20 on the Batch's 60.
    expect(xOf(member)).toBeCloseTo(80, 0)
    push("up", 20)
    const back = await over(90, () => xOf(member))
    expect(back[back.length - 1]).toBe(60)
  })

  it("CVD6: a transform key the Batch doesn't draw keeps the transform the ward's through a Batch change", async () => {
    const [tx, setTx] = createSignal(0)
    const [r, setR] = createSignal(0)
    let member!: HTMLDivElement
    let reference!: HTMLDivElement
    const Scene = (): JSX.Element => {
      const grid = createBatch({ count: 1, initial: false, animate: () => ({ x: tx() }), transition: SPRING })
      return (
        <>
          <w.div style={BOX} {...grid.at(0, { ref: (el) => (member = el as HTMLDivElement) })} animate={{ rotate: r() }} transition={TWEEN} />
          <w.div ref={(el: HTMLDivElement) => (reference = el)} style={BOX} animate={{ rotate: r() }} transition={TWEEN} />
        </>
      )
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await over(4, () => 0)
    setR(30)
    await over(4, () => 0)
    setTx(100)
    const kept = await over(30, () => [turnOf(member), turnOf(reference), xOf(member)] as const)
    kept.forEach(([own, plain, x], f) => {
      expect(own, `frame ${f}: rotate`).toBeCloseTo(plain, 4)
      expect(x, `frame ${f}: x`).toBe(0)
    })
    setR(0)
    const back = await over(90, () => [turnOf(member), xOf(member)] as const)
    expect(back[back.length - 1]).toEqual([0, 100])
  })
})
