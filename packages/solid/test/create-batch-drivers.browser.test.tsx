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
// - CD4: an element given two Batches' handles, and `layout` or `layoutId` on a member's ward (either
//   made first), are errors naming the element.
// - CD5: a drag starts where the Batch drew the member, not from 0.
// - CD6: flung, its release glides on past where it's let go, then the Batch takes it back.
// - CD7: a Batch change that doesn't move a held member leaves it to its ward: its `scale` runs on as a
//   plain ward's, frame for frame.
// - CD8: a transform key the Batch doesn't draw (`rotate` on an `{ x }` Batch) keeps the transform the
//   ward's through a Batch change, its leg running as a plain ward's; once it's back at its identity, the
//   Batch takes the transform back.
// - CD9: each group goes back as its own last leg ends: `opacity`'s short leg lands, and the Batch turns
//   it toward its target while the ward's `scale` still runs.
// - CD10: hovered mid-flight, its `whileHover` takes the transform, `x` holding where the Batch had it;
//   once the hover ends and its `scale` is back, the Batch takes the transform back toward its target.
// - CD11: a held member leaving: its ward, gone with it, hands its group back, and its exit fades it out
//   from where the ward had it; its element goes as its exit lands.
import { render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, createBatch, wardic, type WardicBatch, WardicProvider } from "@wardic/solid"
import { createSignal, For, type JSX } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf } from "./browser-helpers.ts"
import { add, centreOf, flingFrom, glide, mouse, resetScene } from "./reorder-harness.tsx"

afterEach(resetScene)

const BOX: JSX.CSSProperties = { width: "40px", height: "40px", background: "teal" }
const SPRING = { type: "spring", stiffness: 210, damping: 20 } as const
const TWEEN = { type: "tween", duration: 0.3 } as const

const matrixOf = (el: Element): DOMMatrix => new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)"))
const xOf = (el: Element): number => matrixOf(el).m41
const scaleOf = (el: Element): number => matrixOf(el).a
const turnOf = (el: Element): number => (Math.atan2(matrixOf(el).b, matrixOf(el).a) * 180) / Math.PI
const opacityOf = (el: Element): number => Number(getComputedStyle(el).opacity)

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
    expect(() => render(() => <WardicProvider env={DomLive}><Two /></WardicProvider>)).toThrow(/an element \(div\) is a member of two Batches/)
    await raf()
    const Laid = (): JSX.Element => {
      const grid = createBatch({ count: 1, animate: () => ({ x: 10 }) })
      return <wardic.div id="laid" {...grid.at(0)} layout />
    }
    expect(() => render(() => <WardicProvider env={DomLive}><Laid /></WardicProvider>)).toThrow(/\(div#laid\) has `layout` or `layoutId`/)
    await raf()
    const Shared = (): JSX.Element => {
      const grid = createBatch({ count: 1, animate: () => ({ x: 10 }) })
      return <wardic.div class="card" {...grid.at(0)} layoutId="card" />
    }
    expect(() => render(() => <WardicProvider env={DomLive}><Shared /></WardicProvider>)).toThrow(/\(div\.card\) has `layout` or `layoutId`/)
    await raf()
    // The other order: the layout node first, then the member's handle.
    let later!: WardicBatch
    let laid!: HTMLDivElement
    const First = (): JSX.Element => {
      later = createBatch({ count: 1, animate: () => ({ x: 10 }) })
      return <wardic.div id="first" ref={laid} layout />
    }
    render(() => <WardicProvider env={DomLive}><First /></WardicProvider>)
    await raf()
    expect(() => later.at(0).ref(laid)).toThrow(/\(div#first\) has `layout` or `layoutId`/)
  })

  it("CD5: a drag starts where the Batch drew the member", async () => {
    let member!: HTMLDivElement
    const Scene = (): JSX.Element => {
      const grid = createBatch({ count: 1, initial: false, animate: () => ({ x: 60 }), transition: SPRING })
      return <wardic.div style={BOX} {...grid.at(0, { ref: (el) => (member = el as HTMLDivElement) })} drag="x" dragMomentum={false} />
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await over(4, () => 0)
    expect(xOf(member)).toBe(60)
    const grab = centreOf(member)
    await mouse.down(grab)
    await glide(grab, add(grab, 20, 0), 5, 16)
    await over(2, () => 0)
    // The pointer's 20 on the Batch's 60.
    expect(xOf(member)).toBeCloseTo(80, 0)
    await mouse.up(add(grab, 20, 0))
    const back = await over(90, () => xOf(member))
    expect(back[back.length - 1]).toBe(60)
  })

  it("CD6: flung, its release glides on past where it's let go; then the Batch takes it back", async () => {
    let member!: HTMLDivElement
    const Scene = (): JSX.Element => {
      const grid = createBatch({ count: 1, initial: false, animate: () => ({ x: 0 }), transition: SPRING })
      return <wardic.div style={BOX} {...grid.at(0, { ref: (el) => (member = el as HTMLDivElement) })} drag="x" dragTransition={{ power: 0.1, timeConstant: 120 }} />
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await over(4, () => 0)
    const grab = centreOf(member)
    const letGo = await flingFrom(grab, 20, 25)
    await mouse.up(letGo)
    const after = await over(120, () => xOf(member))
    const far = Math.max(...after)
    // Its glide's: on past where it was let go, then back to the Batch's 0.
    expect(far).toBeGreaterThan(letGo.x - grab.x + 5)
    expect(after.findIndex((x) => x === far)).toBeGreaterThan(2)
    expect(after[after.length - 1]).toBe(0)
  })

  it("CD7: a Batch change that doesn't move a held member leaves it to its ward", async () => {
    const [tx, setTx] = createSignal(0)
    const [s, setS] = createSignal(1)
    let held!: HTMLDivElement
    let moved!: HTMLDivElement
    let reference!: HTMLDivElement
    const Scene = (): JSX.Element => {
      const grid = createBatch({ count: 2, initial: false, animate: (i) => ({ x: tx() * i, scale: 1 }), transition: SPRING })
      return (
        <>
          <wardic.div style={BOX} {...grid.at(0, { ref: (el) => (held = el as HTMLDivElement) })} animate={{ scale: s() }} transition={TWEEN} />
          <div style={BOX} {...grid.at(1, { ref: (el) => (moved = el as HTMLDivElement) })} />
          <wardic.div ref={reference} style={BOX} animate={{ scale: s() }} transition={TWEEN} />
        </>
      )
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await over(4, () => 0)
    setS(1.5)
    await over(4, () => 0)
    // It moves member 1 alone.
    setTx(100)
    const frames = await over(24, () => [scaleOf(held), scaleOf(reference), xOf(moved)] as const)
    // Up to its leg's landing, after which the Batch takes it back.
    const landed = frames.findIndex(([, plain]) => plain === 1.5)
    expect(landed).toBeGreaterThan(4)
    frames.slice(0, landed + 1).forEach(([own, plain], f) => expect(own, `frame ${f}: scale`).toBeCloseTo(plain, 6))
    expect(frames[frames.length - 1][2]).toBeGreaterThan(50)
  })

  it("CD8: a transform key the Batch doesn't draw keeps the transform the ward's through a Batch change", async () => {
    const [tx, setTx] = createSignal(0)
    const [r, setR] = createSignal(0)
    let member!: HTMLDivElement
    let reference!: HTMLDivElement
    const Scene = (): JSX.Element => {
      const grid = createBatch({ count: 1, initial: false, animate: () => ({ x: tx() }), transition: SPRING })
      return (
        <>
          <wardic.div style={BOX} {...grid.at(0, { ref: (el) => (member = el as HTMLDivElement) })} animate={{ rotate: r() }} transition={TWEEN} />
          <wardic.div ref={reference} style={BOX} animate={{ rotate: r() }} transition={TWEEN} />
        </>
      )
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await over(4, () => 0)
    setR(30)
    await over(4, () => 0)
    setTx(100)
    // Its turn runs on as the plain ward's, and x stays where the ward took it, past its leg's landing.
    const kept = await over(30, () => [turnOf(member), turnOf(reference), xOf(member)] as const)
    kept.forEach(([own, plain, x], f) => {
      expect(own, `frame ${f}: rotate`).toBeCloseTo(plain, 4)
      expect(x, `frame ${f}: x`).toBe(0)
    })
    expect(kept[kept.length - 1][0]).toBeCloseTo(30, 4)
    // Back at its identity, the Batch takes the transform back, toward its 100.
    setR(0)
    const back = await over(90, () => [turnOf(member), xOf(member)] as const)
    expect(back[back.length - 1]).toEqual([0, 100])
  })

  it("CD9: each group goes back as its own last leg ends", async () => {
    const [o, setO] = createSignal(1)
    const [s, setS] = createSignal(1)
    let member!: HTMLDivElement
    const Scene = (): JSX.Element => {
      const grid = createBatch({ count: 1, initial: false, animate: () => ({ scale: 1, opacity: 1 }), transition: SPRING })
      return (
        <wardic.div
          style={BOX}
          {...grid.at(0, { ref: (el) => (member = el as HTMLDivElement) })}
          animate={{ opacity: o(), scale: s() }}
          transition={{ type: "tween", duration: 0.8, opacity: { type: "tween", duration: 0.1 } }}
        />
      )
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await over(4, () => 0)
    setO(0.2)
    setS(1.5)
    const frames = await over(30, () => [opacityOf(member), scaleOf(member)] as const)
    // Its opacity's leg landed at 0.2 by a tenth of a second; the Batch's spring, from there at its speed,
    // turns it back up while scale still rises.
    const low = Math.min(...frames.map(([opacity]) => opacity))
    expect(low).toBeGreaterThan(0.15)
    expect(low).toBeLessThan(0.21)
    const [opacity, scale] = frames[frames.length - 1]
    expect(opacity).toBeGreaterThan(0.6)
    expect(scale).toBeLessThan(1.45)
  })

  it("CD10: hovered mid-flight, its whileHover takes the transform; once it's back, the Batch takes it", async () => {
    const [tx, setTx] = createSignal(0)
    let member!: HTMLDivElement
    const Scene = (): JSX.Element => {
      const grid = createBatch({ count: 1, initial: false, animate: () => ({ x: tx() }), transition: { type: "tween", duration: 1 } })
      return <wardic.div style={BOX} {...grid.at(0, { ref: (el) => (member = el as HTMLDivElement) })} whileHover={{ scale: 1.2 }} transition={TWEEN} />
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await over(4, () => 0)
    const at = centreOf(member)
    setTx(100)
    await over(6, () => 0)
    // Onto it: the hover takes the transform where the Batch had it.
    await mouse.move(add(at, xOf(member), 0))
    const hovered = await over(24, () => [xOf(member), scaleOf(member)] as const)
    const x = hovered[0][0]
    expect(x).toBeGreaterThan(1)
    expect(x).toBeLessThan(60)
    hovered.forEach(([held], f) => expect(held, `frame ${f}: x held`).toBeCloseTo(x, 6))
    expect(hovered[hovered.length - 1][1]).toBeCloseTo(1.2, 6)
    // Off it: scale back to 1, and the Batch takes the transform back, on toward its 100.
    await mouse.move({ x: 5, y: 5 })
    const back = await over(120, () => [xOf(member), scaleOf(member)] as const)
    expect(back[back.length - 1]).toEqual([100, 1])
  })

  it("CD11: a held member leaving: its ward hands its group back, and its exit fades it from there", async () => {
    const [items, setItems] = createSignal<ReadonlyArray<string>>(["a", "b"])
    const [o, setO] = createSignal(1)
    const members = new Map<string, HTMLDivElement>()
    const Scene = (): JSX.Element => {
      const list = createBatch({
        each: items,
        key: (id) => id,
        initial: false,
        animate: (_, i) => ({ x: i * 50, opacity: 1 }),
        exit: { opacity: 0, transition: { type: "tween", duration: 0.2 } },
        transition: TWEEN,
      })
      return (
        <AnimatePresence>
          <For each={items()}>
            {(id) => <wardic.div style={BOX} {...list.member(id, { ref: (el) => members.set(id, el as HTMLDivElement) })} animate={{ opacity: o() }} transition={{ type: "tween", duration: 1 }} />}
          </For>
        </AnimatePresence>
      )
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await over(4, () => 0)
    // Each ward takes its member's opacity, on a second's leg toward 0.5.
    setO(0.5)
    await over(12, () => 0)
    const b = members.get("b") as HTMLDivElement
    const was = opacityOf(b)
    expect(was).toBeGreaterThan(0.75)
    setItems(["a"])
    const exit = await over(24, () => [opacityOf(b), b.isConnected] as const)
    // Its exit's: down from where the ward had it, toward 0, and its element gone as it lands.
    expect(exit[6][0]).toBeLessThan(was - 0.3)
    expect(exit[exit.length - 1][1]).toBe(false)
  })
})
