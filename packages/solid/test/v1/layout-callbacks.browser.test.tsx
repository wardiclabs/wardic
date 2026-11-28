// Layout animation callbacks in Solid (#191, ADR-0039), in real paint: `onLayoutAnimationStart` and
// `onLayoutAnimationComplete` on every surface that makes a layout node, and `animateLayout`'s
// `onSettled` through `useAnimateLayout`.
//
// - LCS1: on a `wardic.div`: start once its first step is painted (the element has moved off its
//   origin by then), complete once it has landed.
// - LCS2: through `createWard`, the same.
// - LCS3: on `Reorder.Item`s the app reorders: each moved item starts and completes.
// - LCS4: `animateLayout(fn, { onSettled })` settles after the last complete.
// - LCS5 (#979 group I, row 29; ADR-0074 decision 3): a layout callback throwing at each flight, or each
//   measure, is reported once a run, again after a clean call; each callback's run, and each node's, its own.
// - LCS6 (#979 group I; ADR-0074's open list): a config's getter for `onLayoutAnimationStart` that throws, read
//   as the flight starts, is that node's callback failing: reported, and the next node's start still told.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { type AnimateLayout, Reorder, useAnimateLayout, createWard, wardic, WardicProvider, type WardicTransition } from "@wardic/solid/v1"
import * as Bool from "effect/Boolean"
import { createSignal, For } from "solid-js"
import { afterEach, expect, it } from "vitest"
import { raf, until } from "../browser-helpers.ts"
import { envWith, errorsNamed, type Logged } from "../report-env.ts"

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

it("LCS2: through createWard, start and complete", async () => {
  const [moved, setMoved] = createSignal(false)
  const calls: Array<string> = []
  const Box = () => {
    const ward = createWard(() => ({
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

it("LCS5 (#979 group I, row 29): a layout callback throwing at each flight is reported once a run; each callback's run, and each node's, its own", async () => {
  const logs: Array<Logged> = []
  const [moved, setMoved] = createSignal(false)
  let aStartBreaks = true
  let landings = 0
  const left = (): string => Bool.match(moved(), { onTrue: () => "200px", onFalse: () => "0px" })
  render(() => (
    <WardicProvider env={envWith({ logs, reports: [] })}>
      <div style={{ position: "relative", height: "100px" }}>
        <wardic.div
          layout
          layoutDependency={moved()}
          transition={TWEEN}
          onLayoutAnimationStart={() => {
            if (aStartBreaks) throw new Error("a's start broke")
          }}
          onLayoutAnimationComplete={() => {
            landings++
            throw new Error("a's landing broke")
          }}
          onLayoutMeasure={() => {
            throw new Error("a's measure broke")
          }}
          style={{ ...BOX, left: left() }}
        />
        <wardic.div
          layout
          layoutDependency={moved()}
          transition={TWEEN}
          onLayoutAnimationStart={() => {
            throw new Error("b's start broke")
          }}
          style={{ ...BOX, top: "50px", left: left() }}
        />
      </div>
    </WardicProvider>
  ))
  const failed = (message: string): number => errorsNamed(logs, `wardic.projection: ${message} failed`).length
  /** A move, and a's landing waited for. */
  const flight = async (): Promise<void> => {
    const count = landings
    setMoved((m) => !m)
    await until(() => landings === count + 1, 2000)
  }
  for (let i = 0; i < 5; i++) await raf()
  await flight()
  await flight()
  await flight()
  expect(failed("onLayoutAnimationStart"), "a's run and b's, once each").toBe(2)
  expect(failed("onLayoutAnimationComplete"), "a's landings, once").toBe(1)
  expect(failed("an onLayoutMeasure"), "a's measures, once").toBe(1)
  // A clean start ends a's start run, not its landing's.
  aStartBreaks = false
  await flight()
  aStartBreaks = true
  await flight()
  expect(failed("onLayoutAnimationStart"), "a's new run").toBe(3)
  expect(failed("onLayoutAnimationComplete"), "its landing's run goes on").toBe(1)
})

it("LCS6 (#979 group I): a config getter for onLayoutAnimationStart that throws is that node's failure; the next node's start is still told", async () => {
  const logs: Array<Logged> = []
  const [moved, setMoved] = createSignal(false)
  let breaks = false
  const calls: Array<string> = []
  const Box = (props: { readonly name: string; readonly top: string; readonly breaking: boolean }) => {
    const ward = createWard(() => ({
      layout: true,
      layoutDependency: moved(),
      transition: TWEEN,
      // The app's own code, read where the start is told.
      get onLayoutAnimationStart() {
        if (Bool.and(props.breaking, breaks)) throw new Error(`${props.name}'s getter broke`)
        return () => calls.push(`start ${props.name}`)
      },
      onLayoutAnimationComplete: () => calls.push(`complete ${props.name}`),
    }))
    return <div {...ward({ style: { ...BOX, top: props.top, left: Bool.match(moved(), { onTrue: () => "200px", onFalse: () => "0px" }) } })} />
  }
  render(() => (
    <WardicProvider env={envWith({ logs, reports: [] })}>
      <div style={{ position: "relative", height: "100px" }}>
        <Box name="a" top="0px" breaking />
        <Box name="b" top="50px" breaking={false} />
      </div>
    </WardicProvider>
  ))
  for (let i = 0; i < 5; i++) await raf()
  breaks = true
  setMoved(true)
  await until(() => calls.filter((call) => call.startsWith("complete")).length === 2, 2000)
  expect(calls, "b's start told, a's not").toEqual(["start b", "complete a", "complete b"])
  expect(errorsNamed(logs, "wardic.projection: onLayoutAnimationStart failed"), "a's, as its callback's").toHaveLength(1)
})
