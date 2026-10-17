// Layout animation callbacks in Solid (#191, ADR-0039), in real paint: `onLayoutAnimationStart` and
// `onLayoutAnimationComplete` on every surface that makes a layout node, and `animateLayout`'s
// `onSettled` through `useAnimateLayout`.
//
// - LCS1: on a `wardic.div`: start once its first step is painted (the element has moved off its
//   origin by then), complete once it has landed.
// - LCS2: through `useWardic`, the same.
// - LCS3: on `Reorder.Item`s the app reorders: each moved item starts and completes.
// - LCS4: `animateLayout(fn, { onSettled })` settles after the last complete.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { type AnimateLayout, Reorder, useAnimateLayout, useWardic, wardic, WardicProvider, type WardicTransition } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import { createSignal, For } from "solid-js"
import { afterEach, expect, it } from "vitest"
import { raf, until } from "./browser-helpers.ts"

afterEach(cleanup)

const TWEEN: WardicTransition = { type: "tween", duration: 0.15 }
const BOX = { position: "absolute", width: "40px", height: "40px", background: "teal" } as const

it("LCS1: on a wardic.div, start once its first step is painted and complete once it has landed", async () => {
  const [moved, setMoved] = createSignal(false)
  const calls: Array<string> = []
  let el!: HTMLElement
  render(() => (
    <WardicProvider env={DomLive}>
      <div style={{ position: "relative", height: "100px" }}>
        <wardic.div
          ref={(n: HTMLElement) => (el = n)}
          layout
          layoutDependency={moved()}
          transition={TWEEN}
          onLayoutAnimationStart={() => calls.push(`start ${el.style.transform}`)}
          onLayoutAnimationComplete={() => calls.push(`complete ${el.style.transform}`)}
          style={{ ...BOX, left: Bool.match(moved(), { onTrue: () => "200px", onFalse: () => "0px" }) }}
        />
      </div>
    </WardicProvider>
  ))
  for (let i = 0; i < 5; i++) await raf()
  setMoved(true)
  await until(() => calls.length === 2, 2000)
  const [start, complete] = calls
  const startX = Number(/translate3d\((-?[\d.]+)px/.exec(start!)?.[1])
  expect(startX, "its first step painted: past its origin, -200").toBeGreaterThan(-200)
  expect(startX).toBeLessThan(0)
  expect(complete, "landed: no transform left").toBe("complete none")
})

it("LCS2: through useWardic, start and complete", async () => {
  const [moved, setMoved] = createSignal(false)
  const calls: Array<string> = []
  const Box = () => {
    const ward = useWardic(() => ({
      layout: true,
      layoutDependency: moved(),
      transition: TWEEN,
      onLayoutAnimationStart: () => calls.push("start"),
      onLayoutAnimationComplete: () => calls.push("complete"),
    }))
    return <div {...ward({ style: { ...BOX, left: Bool.match(moved(), { onTrue: () => "200px", onFalse: () => "0px" }) } })} />
  }
  render(() => (
    <WardicProvider env={DomLive}>
      <div style={{ position: "relative", height: "100px" }}>
        <Box />
      </div>
    </WardicProvider>
  ))
  for (let i = 0; i < 5; i++) await raf()
  setMoved(true)
  await until(() => calls.length === 2, 2000)
  expect(calls).toEqual(["start", "complete"])
})

it("LCS3: on Reorder.Items the app reorders, each moved item starts and completes", async () => {
  const [items, setItems] = createSignal(["a", "b", "c"])
  const calls: Array<string> = []
  render(() => (
    <WardicProvider env={DomLive}>
      <Reorder.Group values={items()} onReorder={setItems} as="ul" style={{ "list-style": "none", padding: "0", width: "100px" }}>
        <For each={items()}>
          {(value) => (
            <Reorder.Item
              value={value}
              as="li"
              transition={TWEEN}
              onLayoutAnimationStart={() => calls.push(`start ${value}`)}
              onLayoutAnimationComplete={() => calls.push(`complete ${value}`)}
              style={{ height: "40px", "margin-bottom": "10px", background: "teal" }}
            />
          )}
        </For>
      </Reorder.Group>
    </WardicProvider>
  ))
  for (let i = 0; i < 5; i++) await raf()
  setItems(["c", "b", "a"])
  await until(() => calls.filter((c) => c.startsWith("complete")).length === 2, 2000)
  for (let i = 0; i < 5; i++) await raf()
  expect([...calls].sort()).toEqual(["complete a", "complete c", "start a", "start c"])
})

it("LCS4: animateLayout's onSettled settles after the last complete", async () => {
  const [items, setItems] = createSignal(["a", "b", "c"])
  const calls: Array<string> = []
  let animateLayout: AnimateLayout | undefined
  const Grab = () => {
    animateLayout = useAnimateLayout()
    return null
  }
  render(() => (
    <WardicProvider env={DomLive}>
      <Grab />
      <div style={{ width: "100px" }}>
        <For each={items()}>
          {(value) => (
            <wardic.div
              layout
              transition={TWEEN}
              onLayoutAnimationComplete={() => calls.push(`complete ${value}`)}
              style={{ height: "40px", "margin-bottom": "10px", background: "teal" }}
            />
          )}
        </For>
      </div>
    </WardicProvider>
  ))
  for (let i = 0; i < 5; i++) await raf()
  animateLayout!(() => setItems(["c", "b", "a"]), { onSettled: () => calls.push("settled") })
  await until(() => calls.includes("settled"), 2000)
  expect(calls.at(-1)).toBe("settled")
  expect(calls.filter((c) => c.startsWith("complete")).sort()).toEqual(["complete a", "complete c"])
})
