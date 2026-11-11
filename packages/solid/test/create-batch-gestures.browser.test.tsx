// Hover and press per member on Solid 1 (#665's PR 5, ADR-0070 decision 12, Q56–Q61): each member's
// `whileHover` and `whileTap` against a `wardic.div` with the same, frame for frame. The ward sits inside
// the member's element, so the real mouse hovers and presses both at once.
//
// - CG1: hovered, a member moves into `whileHover`'s values on its transition, as the ward does, frame for
//   frame, and back to `animate`'s on the Batch's as the pointer leaves.
// - CG2: pressed, into `whileTap`'s, and back to `whileHover`'s while still hovered, frame for frame.
// - CG3: a Batch change mid-hover moves the keys the hover doesn't hold; the held key stays, and turns
//   toward the new targets as the hover ends (Q59).
// - CG4: its callbacks, each with the platform's event, its point and the member: `{ i }` by index,
//   `{ i, item }` keyed; a release elsewhere is a cancel.
// - CG5: Enter and Space press a focused member (Q57): its element takes `tabindex="0"`, a button none.
// - CG6: a function form's key the Batch doesn't have is reported, naming it (Q58); an object form's
//   key joins the Batch's.
// - CG7: a Batch with no gesture adds no window listener; one with `whileHover` adds its set once, as its
//   gesture code arrives, whatever its count (S5).
//
// A Batch's gesture code loads at its first need (Q62): each test waits for it before the mouse moves.
import { render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { createBatch, wardic, WardicProvider } from "@wardic/solid"
import { createSignal, For, type JSX } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf } from "./browser-helpers.ts"
import { envWith, errorsNamed, type Logged } from "./report-env.ts"
import { add, centreOf, mouse, resetScene } from "./reorder-harness.tsx"

afterEach(resetScene)

const BOX: JSX.CSSProperties = { width: "60px", height: "60px", background: "teal" }
const INNER: JSX.CSSProperties = { width: "40px", height: "40px", background: "orange" }
const TWEEN = { type: "tween", duration: 0.2 } as const
// A point off every test's elements, for the mouse.
const AWAY = { x: 600, y: 400 }

const matrixOf = (el: Element): DOMMatrix => new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)"))
const xOf = (el: Element): number => matrixOf(el).m41
const scaleOf = (el: Element): number => matrixOf(el).a

/** A Batch's gesture code loaded (Q62: at its first need), and its watches started: what each test waits for before it moves the mouse. */
const gesturesLoaded = async (): Promise<void> => {
  await import("../src/batch-gestures.ts")
  await raf()
}

/** `frames` frames of `read`, read after each. */
const over = async <A,>(frames: number, read: () => A): Promise<ReadonlyArray<A>> => {
  const out: Array<A> = []
  for (let f = 0; f < frames; f++) {
    await raf()
    out.push(read())
  }
  return out
}

/** Each frame's member and ward the same: `scale` within 1e-6. */
const expectSame = (frames: ReadonlyArray<readonly [number, number]>, what: string): void =>
  frames.forEach(([member, ward], f) => expect(member, `${what}, frame ${f}`).toBeCloseTo(ward, 6))

/** A one-member Batch on `scale`, with `whileHover` and `whileTap`, and inside its element a `wardic.div` with the same. */
const mountPair = () => {
  let member!: HTMLDivElement
  let ward!: HTMLDivElement
  const Scene = (): JSX.Element => {
    const grid = createBatch({
      count: 1,
      initial: false,
      animate: () => ({ scale: 1 }),
      whileHover: { scale: 1.2, transition: TWEEN },
      whileTap: { scale: 0.9, transition: { type: "tween", duration: 0.15 } },
      transition: { type: "tween", duration: 0.3 },
    })
    return (
      <div style={BOX} {...grid.at(0, { ref: (el) => (member = el as HTMLDivElement) })}>
        <wardic.div
          ref={ward}
          style={INNER}
          animate={{ scale: 1 }}
          whileHover={{ scale: 1.2, transition: TWEEN }}
          whileTap={{ scale: 0.9, transition: { type: "tween", duration: 0.15 } }}
          transition={{ type: "tween", duration: 0.3 }}
        />
      </div>
    )
  }
  render(() => (
    <WardicProvider env={DomLive}>
      <Scene />
    </WardicProvider>
  ))
  return { member: () => member, ward: () => ward }
}

describe("hover and press per member on Solid 1 (#665)", () => {
  it("CG1: hovered, a member moves into whileHover's values as a ward does, and back as the pointer leaves", async () => {
    await mouse.move(AWAY)
    const pair = mountPair()
    await gesturesLoaded()
    await mouse.move(centreOf(pair.ward()))
    const into = await over(20, () => [scaleOf(pair.member()), scaleOf(pair.ward())] as const)
    expectSame(into, "into the hover")
    expect(into[into.length - 1][0]).toBeCloseTo(1.2, 6)
    await mouse.move(AWAY)
    const back = await over(30, () => [scaleOf(pair.member()), scaleOf(pair.ward())] as const)
    expectSame(back, "back")
    expect(back[back.length - 1][0]).toBe(1)
  })

  it("CG2: pressed, into whileTap's values, and back to whileHover's while still hovered, frame for frame", async () => {
    await mouse.move(AWAY)
    const pair = mountPair()
    await gesturesLoaded()
    const at = centreOf(pair.ward())
    await mouse.move(at)
    await over(20, () => 0)
    await mouse.down(at)
    const pressed = await over(16, () => [scaleOf(pair.member()), scaleOf(pair.ward())] as const)
    expectSame(pressed, "pressed")
    expect(pressed[pressed.length - 1][0]).toBeCloseTo(0.9, 6)
    await mouse.up(at)
    const released = await over(20, () => [scaleOf(pair.member()), scaleOf(pair.ward())] as const)
    expectSame(released, "released")
    expect(released[released.length - 1][0]).toBeCloseTo(1.2, 6)
  })

  it("CG3: a Batch change mid-hover moves the keys the hover doesn't hold; the held one turns toward the new targets as it ends", async () => {
    await mouse.move(AWAY)
    const [s, setS] = createSignal(1)
    const [tx, setTx] = createSignal(0)
    let member!: HTMLDivElement
    const Scene = (): JSX.Element => {
      const grid = createBatch({ count: 1, initial: false, animate: () => ({ x: tx(), scale: s() }), whileHover: { scale: 1.2 }, transition: TWEEN })
      return <div style={BOX} {...grid.at(0, { ref: (el) => (member = el as HTMLDivElement) })} />
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await gesturesLoaded()
    await mouse.move(add(centreOf(member), 0, 0))
    await over(20, () => 0)
    expect(scaleOf(member)).toBeCloseTo(1.2, 6)
    // `x` and `scale` change: `x` moves, `scale` is the hover's.
    setTx(40)
    setS(1.5)
    const during = await over(20, () => [xOf(member), scaleOf(member)] as const)
    during.forEach(([, scale], f) => expect(scale, `frame ${f}: held`).toBeCloseTo(1.2, 6))
    expect(during[during.length - 1][0]).toBe(40)
    await mouse.move(AWAY)
    const after = await over(20, () => [xOf(member), scaleOf(member)] as const)
    expect(after[after.length - 1]).toEqual([40, 1.5])
  })

  it("CG4: its callbacks hear each member's gestures, with the platform's event, its point and the member", async () => {
    await mouse.move(AWAY)
    const heard: Array<string> = []
    const indexed = new Map<number, HTMLDivElement>()
    const keyedEls = new Map<string, HTMLDivElement>()
    const Scene = (): JSX.Element => {
      const grid = createBatch({
        count: 2,
        animate: (i) => ({ x: i * 80 }),
        onHoverStart: (event, info) => heard.push(`hoverStart ${info.i} ${event.type} ${Math.round(info.point.x) > 0}`),
        onHoverEnd: (_, info) => heard.push(`hoverEnd ${info.i}`),
        onTapStart: (event, info) => heard.push(`tapStart ${info.i} ${event.type} ${info.input}`),
        onTap: (_, info) => heard.push(`tap ${info.i}`),
        onTapCancel: (_, info) => heard.push(`tapCancel ${info.i}`),
      })
      const list = createBatch({
        each: () => ["a", "b"],
        key: (id) => id,
        animate: (_, i) => ({ x: i * 80 }),
        onTap: (_, info) => heard.push(`keyed tap ${info.i} ${info.item}`),
      })
      return (
        <>
          <For each={[0, 1]}>{(i) => <div style={BOX} {...grid.at(i, { ref: (el) => indexed.set(i, el as HTMLDivElement) })} />}</For>
          <For each={["a", "b"]}>{(id) => <div style={BOX} {...list.member(id, { ref: (el) => keyedEls.set(id, el as HTMLDivElement) })} />}</For>
        </>
      )
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await over(40, () => 0)
    await gesturesLoaded()
    const one = centreOf(indexed.get(1) as Element)
    await mouse.move(one)
    await mouse.down(one)
    await mouse.up(one)
    // Pressed on it, let go off it: a cancel.
    await mouse.down(one)
    await mouse.up(AWAY)
    const b = centreOf(keyedEls.get("b") as Element)
    await mouse.move(b)
    await mouse.down(b)
    await mouse.up(b)
    await mouse.move(AWAY)
    // Let go off it, its hover ends first, then its press: a Wardic element's order, its hover watched first.
    expect(heard).toEqual([
      "hoverStart 1 pointerover true",
      "tapStart 1 pointerdown pointer",
      "tap 1",
      "tapStart 1 pointerdown pointer",
      "hoverEnd 1",
      "tapCancel 1",
      "keyed tap 1 b",
    ])
  })

  it("CG5: Enter and Space press a focused member: its element takes tabindex 0, a button none", async () => {
    const heard: Array<string> = []
    let div!: HTMLDivElement
    let button!: HTMLButtonElement
    const Scene = (): JSX.Element => {
      const grid = createBatch({
        count: 2,
        animate: () => ({ scale: 1 }),
        whileTap: { scale: 0.9 },
        onTapStart: (event, info) => heard.push(`start ${info.i} ${event.type} ${info.input}`),
        onTap: (_, info) => heard.push(`tap ${info.i}`),
      })
      return (
        <>
          <div style={BOX} {...grid.at(0, { ref: (el) => (div = el as HTMLDivElement) })} />
          <button style={BOX} {...grid.at(1, { ref: (el) => (button = el as HTMLButtonElement) })} />
        </>
      )
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await gesturesLoaded()
    expect([div.getAttribute("tabindex"), button.hasAttribute("tabindex")]).toEqual(["0", false])
    div.focus()
    div.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    const pressed = await over(30, () => scaleOf(div))
    expect(pressed[pressed.length - 1]).toBeCloseTo(0.9, 6)
    div.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }))
    button.focus()
    button.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }))
    button.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true }))
    expect(heard).toEqual(["start 0 keydown keyboard", "tap 0", "start 1 keydown keyboard", "tap 1"])
  })

  it("CG6: a function form's unknown key is reported, naming it; an object form's key joins the Batch's", async () => {
    await mouse.move(AWAY)
    const logs: Array<Logged> = []
    const reports: Array<string> = []
    let bad!: HTMLDivElement
    let good!: HTMLDivElement
    const Scene = (): JSX.Element => {
      const wrong = createBatch({ count: 1, animate: () => ({ x: 0 }), whileHover: () => ({ rotate: 10 }) })
      // `scale` isn't one of `animate`'s keys: the object brings it.
      const right = createBatch({ count: 1, initial: false, animate: () => ({ x: 100 }), whileHover: { scale: 1.2 }, transition: TWEEN })
      return (
        <>
          <div style={BOX} {...wrong.at(0, { ref: (el) => (bad = el as HTMLDivElement) })} />
          <div style={BOX} {...right.at(0, { ref: (el) => (good = el as HTMLDivElement) })} />
        </>
      )
    }
    render(() => (
      <WardicProvider env={envWith({ logs, reports })}>
        <Scene />
      </WardicProvider>
    ))
    await gesturesLoaded()
    await mouse.move(centreOf(bad))
    await over(4, () => 0)
    expect(errorsNamed(logs, "createBatch: a gesture failed")).toHaveLength(1)
    expect(reports.join("\n")).toMatch(/member 0's `whileHover` gives "rotate", which isn't one of its keys \(x\)/)
    await mouse.move(centreOf(good))
    const grown = await over(20, () => scaleOf(good))
    expect(grown[grown.length - 1]).toBeCloseTo(1.2, 6)
  })

  it("CG7: a Batch with no gesture adds no window listener; one with whileHover adds its set once", async () => {
    let added: Array<string> = []
    const real = window.addEventListener.bind(window)
    window.addEventListener = ((...args: Parameters<typeof real>) => {
      if (args[0].startsWith("pointer")) added.push(args[0])
      return real(...args)
    }) as typeof window.addEventListener
    try {
      const Plain = (): JSX.Element => {
        const grid = createBatch({ count: 300, animate: (i) => ({ x: i }) })
        return <For each={Array.from({ length: 300 }, (_, i) => i)}>{(i) => <div {...grid.at(i)} />}</For>
      }
      const plain = render(() => (
        <WardicProvider env={DomLive}>
          <Plain />
        </WardicProvider>
      ))
      await over(2, () => 0)
      expect(added).toEqual([])
      plain.unmount()
      added = []
      const Hovered = (): JSX.Element => {
        const grid = createBatch({ count: 300, animate: (i) => ({ x: i }), whileHover: { scale: 1.1 } })
        return <For each={Array.from({ length: 300 }, (_, i) => i)}>{(i) => <div {...grid.at(i)} />}</For>
      }
      render(() => (
        <WardicProvider env={DomLive}>
          <Hovered />
        </WardicProvider>
      ))
      await gesturesLoaded()
      expect(added.sort()).toEqual(["pointercancel", "pointerdown", "pointerout", "pointerover", "pointerup"])
    } finally {
      window.addEventListener = real
    }
  })
})
