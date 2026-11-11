// Hover and press per member on Solid 2 (#665's PR 5, ADR-0070 decision 12, Q56–Q61): Solid 1's
// (`../create-batch-gestures.browser.test.tsx`) on the Environment's own pushed input, each member against
// a `w.div` with the same `whileHover` and `whileTap`, the ward's events pushed with `push` and the
// member's with `pushTo`, in the same frames.
//
// - CVG1: hovered, a member moves into `whileHover`'s values as the ward does, frame for frame, and back
//   as the pointer leaves; pressed, into `whileTap`'s, and back to `whileHover`'s.
// - CVG2: `next` and `when` hear each member's gestures with its point, its element and the member, `{ i,
//   item }` keyed; asking for a press's event watches presses from then on, once its code has loaded
//   (Q62), its members' elements focusable only then.
// - CVG3: a Batch change mid-hover moves the keys the hover doesn't hold (Q59); a focused member's Enter
//   presses it; a release off a member tells its hover's end, then its press's, whichever was asked first;
//   a function form's unknown key is reported, naming it.
import { DomLive } from "@wardic/dom"
import type { JSX } from "@solidjs/web"
import * as InputSource from "@wardic/core/InputSource"
import { createBatch, hover, press, w, type WardicBatchPressInfo, WardicProvider } from "@wardic/solid/unstable/v2"
import { TestInput } from "@wardic/test"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { createEffect, createSignal, For } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf } from "../browser-helpers.ts"
import { envWith, errorsNamed, type Logged } from "../report-env.ts"
import { mount } from "./mount.tsx"

const BOX: JSX.CSSProperties = { width: "40px", height: "40px", background: "teal" }
const TWEEN = { type: "tween", duration: 0.2 } as const
const TAP = { type: "tween", duration: 0.15 } as const

const scaleOf = (el: Element): number => new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)")).a

/** A Batch's gesture code loaded (Q62: at its first need), and its watches started. */
const gesturesLoaded = async (): Promise<void> => {
  await import("../../src/batch-gestures.ts")
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

/** A primary mouse's event. */
const ev = (type: InputSource.PointerLikeEvent["type"], t: number): InputSource.PointerLikeEvent =>
  InputSource.makePointerLikeEvent({ type, x: 10, y: 10, timeStamp: t, onTarget: true })

describe("hover and press per member on Solid 2 (#665)", () => {
  it("CVG1: hovered and pressed, a member moves into whileHover's and whileTap's values as a w.div does, frame for frame", async () => {
    const input = Effect.runSync(TestInput.pushable())
    let member!: HTMLDivElement
    let ward!: HTMLDivElement
    const Scene = (): JSX.Element => {
      const grid = createBatch({
        count: 1,
        initial: false,
        animate: () => ({ scale: 1 }),
        whileHover: { scale: 1.2, transition: TWEEN },
        whileTap: { scale: 0.9, transition: TAP },
        transition: { type: "tween", duration: 0.3 },
      })
      return (
        <>
          <div style={BOX} {...grid.at(0, { ref: (el) => (member = el as HTMLDivElement) })} />
          <w.div
            ref={(el: HTMLDivElement) => (ward = el)}
            style={BOX}
            animate={{ scale: 1 }}
            whileHover={{ scale: 1.2, transition: TWEEN }}
            whileTap={{ scale: 0.9, transition: TAP }}
            transition={{ type: "tween", duration: 0.3 }}
          />
        </>
      )
    }
    mount(() => (
      <WardicProvider env={input.layer.pipe(Layer.provideMerge(DomLive))} features={[hover, press]}>
        <Scene />
      </WardicProvider>
    ))
    await gesturesLoaded()
    let t = 0
    const both = (type: InputSource.PointerLikeEvent["type"]): void => {
      t += 16
      const event = ev(type, t)
      Effect.runSync(input.push(event))
      Effect.runSync(input.pushTo(member, event))
    }
    const same = (frames: ReadonlyArray<readonly [number, number]>, what: string): void =>
      frames.forEach(([own, plain], f) => expect(own, `${what}, frame ${f}`).toBeCloseTo(plain, 6))
    both("enter")
    const into = await over(20, () => [scaleOf(member), scaleOf(ward)] as const)
    same(into, "into the hover")
    expect(into[into.length - 1][0]).toBeCloseTo(1.2, 6)
    both("down")
    const pressed = await over(16, () => [scaleOf(member), scaleOf(ward)] as const)
    same(pressed, "pressed")
    expect(pressed[pressed.length - 1][0]).toBeCloseTo(0.9, 6)
    both("up")
    const released = await over(20, () => [scaleOf(member), scaleOf(ward)] as const)
    same(released, "released")
    both("leave")
    const back = await over(30, () => [scaleOf(member), scaleOf(ward)] as const)
    same(back, "back")
    expect(back[back.length - 1][0]).toBe(1)
  })

  it("CVG2: next and when hear each member's gestures, with its point, element and the member; asking watches from then on", async () => {
    const input = Effect.runSync(TestInput.pushable())
    const members = new Map<string, HTMLDivElement>()
    const heard: Array<string> = []
    let list!: ReturnType<typeof makeList>
    const makeList = () => createBatch({ each: () => ["a", "b"], key: (id: string) => id, animate: (_, i) => ({ x: i * 50 }) })
    const Scene = (): JSX.Element => {
      list = makeList()
      return <For each={["a", "b"]}>{(id) => <div style={BOX} {...list.member(id, { ref: (el) => members.set(id, el as HTMLDivElement) })} />}</For>
    }
    mount(() => (
      <WardicProvider env={input.layer.pipe(Layer.provideMerge(DomLive))}>
        <Scene />
      </WardicProvider>
    ))
    await gesturesLoaded()
    const b = members.get("b") as HTMLDivElement
    // Nothing asked yet: no press watched, so no element made focusable.
    expect(b.hasAttribute("tabindex")).toBe(false)
    const tapped = list.next("tap")
    await gesturesLoaded()
    expect(b.getAttribute("tabindex")).toBe("0")
    Effect.runSync(input.pushTo(b, ev("down", 3)))
    Effect.runSync(input.pushTo(b, ev("up", 4)))
    const told: WardicBatchPressInfo = await tapped
    expect([told.i, told.item, told.element === b, told.input, told.point]).toEqual([1, "b", true, "pointer", { x: 10, y: 10 }])
    // `when` for an effect: each hover start from now on.
    mount(() => {
      createEffect(list.when("hoverStart"), (info) => {
        heard.push(`hoverStart ${info.i} ${String(info.item)}`)
      })
      return null
    })
    await over(2, () => 0)
    Effect.runSync(input.pushTo(members.get("a") as HTMLDivElement, ev("enter", 5)))
    await over(2, () => 0)
    expect(heard).toEqual(["hoverStart 0 a"])
  })

  it("CVG3: a change mid-hover, a focused member's Enter, the order of a release's events, and an unknown key", async () => {
    const input = Effect.runSync(TestInput.pushable())
    const [tx, setTx] = createSignal(0)
    const [s, setS] = createSignal(1)
    let member!: HTMLDivElement
    let pressable!: HTMLDivElement
    let grid!: ReturnType<typeof makeGrid>
    let presses!: ReturnType<typeof makeGrid>
    const makeGrid = () =>
      createBatch({ count: 1, initial: false, animate: () => ({ x: tx(), scale: s() }), whileHover: { scale: 1.2 }, whileTap: { scale: 0.9 }, transition: TWEEN })
    // Presses only, from its config: its hover asked for later.
    const makePresses = () => createBatch({ count: 1, animate: () => ({ x: 0 }), whileTap: { scale: 0.9 } })
    const Scene = (): JSX.Element => {
      grid = makeGrid()
      presses = makePresses() as ReturnType<typeof makeGrid>
      return (
        <>
          <div style={BOX} {...grid.at(0, { ref: (el) => (member = el as HTMLDivElement) })} />
          <div style={BOX} {...presses.at(0, { ref: (el) => (pressable = el as HTMLDivElement) })} />
        </>
      )
    }
    mount(() => (
      <WardicProvider env={input.layer.pipe(Layer.provideMerge(DomLive))}>
        <Scene />
      </WardicProvider>
    ))
    await gesturesLoaded()
    const order: Array<string> = []
    mount(() => {
      createEffect(presses.when("tapCancel"), () => {
        order.push("tapCancel")
      })
      createEffect(presses.when("hoverEnd"), () => {
        order.push("hoverEnd")
      })
      return null
    })
    await over(2, () => 0)
    // Hovered, then a change: `x` moves, `scale` stays the hover's.
    Effect.runSync(input.pushTo(member, ev("enter", 1)))
    await over(20, () => 0)
    setTx(40)
    setS(1.5)
    const during = await over(20, () => [new DOMMatrix(getComputedStyle(member).transform).m41, scaleOf(member)] as const)
    during.forEach(([, scale], f) => expect(scale, `frame ${f}: held`).toBeCloseTo(1.2, 6))
    expect(during[during.length - 1][0]).toBe(40)
    Effect.runSync(input.pushTo(member, ev("leave", 2)))
    const back = await over(30, () => scaleOf(member))
    expect(back[back.length - 1]).toBe(1.5)
    // The presses-only Batch, its hover asked for after its presses: hovered, pressed, let go off it, its
    // hover's end, then its press's.
    Effect.runSync(input.pushTo(pressable, ev("enter", 3)))
    Effect.runSync(input.pushTo(pressable, ev("down", 3)))
    Effect.runSync(input.pushTo(pressable, ev("leave", 3)))
    Effect.runSync(input.pushTo(pressable, InputSource.makePointerLikeEvent({ type: "up", x: 300, y: 300, timeStamp: 4, onTarget: false })))
    await over(2, () => 0)
    expect(order).toEqual(["hoverEnd", "tapCancel"])
    // Focused, Enter presses it.
    const tapped = grid.next("tap")
    Effect.runSync(input.pushFocusTo(member, { type: "focus", timeStamp: 5, fromTarget: true }))
    Effect.runSync(input.pushKey({ type: "down", key: "enter", repeat: false, timeStamp: 6, fromTarget: true, handled: false, handle: () => undefined, action: "none" }))
    const pressed = await over(20, () => scaleOf(member))
    expect(pressed[pressed.length - 1]).toBeCloseTo(0.9, 6)
    Effect.runSync(input.pushKey({ type: "up", key: "enter", repeat: false, timeStamp: 7, fromTarget: true, handled: false, handle: () => undefined, action: "none" }))
    expect((await tapped).input).toBe("keyboard")
    // A function form's unknown key: reported, naming it.
    const logs: Array<Logged> = []
    const reports: Array<string> = []
    let bad!: HTMLDivElement
    const Wrong = (): JSX.Element => {
      const wrong = createBatch({ count: 1, animate: () => ({ x: 0 }), whileHover: () => ({ rotate: 10 }) })
      return <div style={BOX} {...wrong.at(0, { ref: (el) => (bad = el as HTMLDivElement) })} />
    }
    mount(() => (
      <WardicProvider env={envWith({ logs, reports })}>
        <Wrong />
      </WardicProvider>
    ))
    await gesturesLoaded()
    bad.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse", isPrimary: true, relatedTarget: document.body }))
    await over(2, () => 0)
    expect(errorsNamed(logs, "createBatch: a gesture failed")).toHaveLength(1)
    expect(reports.join("\n")).toMatch(/member 0's `whileHover` gives "rotate", which isn't one of its keys \(x\)/)
  })
})
