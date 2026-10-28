// Solid 1's animation callbacks (#257, Motion's `onAnimationStart` / `onAnimationComplete`), in real
// frames: each Retarget's start, and its landing, with Motion's `definition`.
//
// - AC1: the entrance at mount starts and completes, with the target values as its definition.
// - AC2: a variant's animation hands over the variant's name. A mount whose `initial` is its `animate`'s
//   name tells nothing (#448, Motion's).
// - AC3: an animation the next Retarget interrupts doesn't complete; the next one does.
// - AC4: a change that resolves the same target (a `style` change) starts nothing.
// - AC5: a gesture layer's animation counts: a hover's start and landing, with its target values.
// - AC6: a callback that throws is reported, and the element animates on and completes.
// - AC7: through `createWard`'s accessor config, the same.
// - AC8: a Retarget to where the element already is (a variant with the same values) starts and
//   completes too, at once, as Motion's does (#448): it starts no leg.
// - AC9: a spring's Retarget of two legs (a number and a colour) completes once, when the later lands.
// - AC10: a Retarget with nothing to animate (an empty variant, on a spring) starts and completes at once.
// - AC11: over a variant, a hover's definition is its target values, and so is the return: the
//   variant didn't change (Motion's fallback animation for the keys the hover leaves). The mount, at
//   its `animate`, tells nothing (#448).
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { createWard, wardic, WardicProvider, type WardicAnimationDefinition, type WardicTransition } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import { createSignal } from "solid-js"
import { afterEach, expect, it } from "vitest"
import { raf, until } from "./browser-helpers.ts"

afterEach(cleanup)

const TWEEN: WardicTransition = { type: "tween", duration: 0.12 }
const SPRING: WardicTransition = { type: "spring", stiffness: 700, damping: 50 }
// Clear of the page's one mouse, parked at (5, 5) for every browser file: under it, Chrome's own
// hover could start a whileHover layer and interrupt the animation a test waits on.
const CLEAR = { "margin-top": "120px", "margin-left": "120px" } as const
const BOX = { width: "40px", height: "40px", background: "teal", ...CLEAR } as const

const opacityOf = (el: HTMLElement | undefined): number => Number(el?.style.opacity)

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

/** A log of the calls, each with its definition. */
const recorder = () => {
  const calls: Array<string> = []
  return {
    calls,
    start: (definition: WardicAnimationDefinition) => calls.push(`start ${JSON.stringify(definition)}`),
    complete: (definition: WardicAnimationDefinition) => calls.push(`complete ${JSON.stringify(definition)}`),
  }
}

it("AC1: the entrance at mount starts and completes, with the target values as its definition", async () => {
  const log = recorder()
  let el!: HTMLElement
  render(() => (
    <WardicProvider env={DomLive}>
      <wardic.div
        ref={(n: HTMLElement) => (el = n)}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={TWEEN}
        onAnimationStart={log.start}
        onAnimationComplete={(definition) => {
          log.complete(definition)
          log.calls.push(`landed at ${opacityOf(el)}`)
        }}
        style={BOX}
      />
    </WardicProvider>
  ))
  await until(() => log.calls.length === 3, 2000)
  expect(log.calls).toEqual(['start {"opacity":1}', 'complete {"opacity":1}', "landed at 1"])
})

it("AC2: a variant's animation hands over the variant's name", async () => {
  const log = recorder()
  const [open, setOpen] = createSignal(false)
  render(() => (
    <WardicProvider env={DomLive}>
      <wardic.div
        variants={{ open: { opacity: 1 }, shut: { opacity: 0.2 } }}
        initial="shut"
        animate={Bool.match(open(), { onTrue: () => "open", onFalse: () => "shut" })}
        transition={TWEEN}
        onAnimationStart={log.start}
        onAnimationComplete={log.complete}
        style={BOX}
      />
    </WardicProvider>
  ))
  await frames(20)
  expect(log.calls, "a mount at its animate tells nothing").toEqual([])
  setOpen(true)
  await until(() => log.calls.length === 2, 2000)
  expect(log.calls).toEqual(['start "open"', 'complete "open"'])
  setOpen(false)
  await until(() => log.calls.length === 4, 2000)
  expect(log.calls.slice(2)).toEqual(['start "shut"', 'complete "shut"'])
})

it("AC3: an animation the next Retarget interrupts doesn't complete; the next one does", async () => {
  const log = recorder()
  const [to, setTo] = createSignal(1)
  render(() => (
    <WardicProvider env={DomLive}>
      <wardic.div
        initial={{ opacity: 0 }}
        animate={{ opacity: to() }}
        transition={{ type: "tween", duration: 0.4 }}
        onAnimationStart={log.start}
        onAnimationComplete={log.complete}
        style={BOX}
      />
    </WardicProvider>
  ))
  for (let i = 0; i < 4; i++) await raf()
  setTo(0.5)
  await until(() => log.calls.some((c) => c.startsWith("complete")), 3000)
  expect(log.calls).toEqual(['start {"opacity":1}', 'start {"opacity":0.5}', 'complete {"opacity":0.5}'])
})

it("AC4: a change that resolves the same target (a style change) starts nothing", async () => {
  const log = recorder()
  const [color, setColor] = createSignal("red")
  render(() => (
    <WardicProvider env={DomLive}>
      <wardic.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={TWEEN}
        onAnimationStart={log.start}
        onAnimationComplete={log.complete}
        style={{ ...BOX, color: color() }}
      />
    </WardicProvider>
  ))
  await until(() => log.calls.length === 2, 2000)
  expect(log.calls).toHaveLength(2)
  setColor("blue")
  for (let i = 0; i < 6; i++) await raf()
  expect(log.calls, "no Retarget, no call").toHaveLength(2)
})

it("AC5: a gesture layer's animation counts: a hover's start and landing, with its target values", async () => {
  const log = recorder()
  let el!: HTMLElement
  render(() => (
    <WardicProvider env={DomLive}>
      <wardic.div
        ref={(n: HTMLElement) => (el = n)}
        initial={{ opacity: 0.2 }}
        animate={{ opacity: 0.2 }}
        whileHover={{ opacity: 1 }}
        transition={TWEEN}
        onAnimationStart={log.start}
        onAnimationComplete={log.complete}
        style={BOX}
      />
    </WardicProvider>
  ))
  await until(() => log.calls.length === 2, 2000)
  // The recognizer attaches its listener asynchronously: re-dispatch until the hover's Retarget starts.
  await until(() => {
    el.dispatchEvent(new PointerEvent("pointerenter", { pointerId: 1, bubbles: true }))
    return log.calls.length > 2
  }, 2000)
  await until(() => log.calls.length === 4, 2000)
  expect(log.calls.slice(2)).toEqual(['start {"opacity":1}', 'complete {"opacity":1}'])
})

it("AC6: a callback that throws is reported, and the element animates on and completes", async () => {
  const completed: Array<number> = []
  let el!: HTMLElement
  render(() => (
    <WardicProvider env={DomLive}>
      <wardic.div
        ref={(n: HTMLElement) => (el = n)}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={TWEEN}
        onAnimationStart={() => {
          throw new Error("the app's start failed")
        }}
        onAnimationComplete={() => completed.push(opacityOf(el))}
        style={BOX}
      />
    </WardicProvider>
  ))
  await until(() => completed.length === 1, 2000)
  expect(completed).toEqual([1])
})

it("AC7: through createWard's accessor config, the same", async () => {
  const log = recorder()
  const [open, setOpen] = createSignal(false)
  const Box = () => {
    const ward = createWard(() => ({
      animate: { opacity: Bool.match(open(), { onTrue: () => 1, onFalse: () => 0.3 }) },
      transition: TWEEN,
      onAnimationStart: log.start,
      onAnimationComplete: log.complete,
    }))
    return <div {...ward({ style: BOX })} />
  }
  render(() => (
    <WardicProvider env={DomLive}>
      <Box />
    </WardicProvider>
  ))
  await until(() => log.calls.length === 2, 2000)
  setOpen(true)
  await until(() => log.calls.length === 4, 2000)
  expect(log.calls).toEqual(['start {"opacity":0.3}', 'complete {"opacity":0.3}', 'start {"opacity":1}', 'complete {"opacity":1}'])
})

it("AC8: a Retarget to where the element already is starts and completes too", async () => {
  const log = recorder()
  const [name, setName] = createSignal("a")
  render(() => (
    <WardicProvider env={DomLive}>
      <wardic.div
        variants={{ a: { opacity: 1 }, b: { opacity: 1 } }}
        initial="a"
        animate={name()}
        transition={{ type: "tween", duration: 1 }}
        onAnimationStart={log.start}
        onAnimationComplete={log.complete}
        style={BOX}
      />
    </WardicProvider>
  ))
  await frames(4)
  expect(log.calls, "the mount, at its animate, tells nothing").toEqual([])
  setName("b")
  await frames(2)
  expect(log.calls, "at once, not after the second").toEqual(['start "b"', 'complete "b"'])
})

it("AC9: a spring's Retarget of two legs (a number and a colour) completes once, when the later lands", async () => {
  const log = recorder()
  let el!: HTMLElement
  render(() => (
    <WardicProvider env={DomLive}>
      <wardic.div
        ref={(n: HTMLElement) => (el = n)}
        initial={{ opacity: 0, "background-color": "rgb(255, 0, 0)" }}
        animate={{ opacity: 1, "background-color": "rgb(0, 0, 255)" }}
        transition={SPRING}
        onAnimationStart={log.start}
        onAnimationComplete={(definition) => {
          log.complete(definition)
          log.calls.push(`landed at ${opacityOf(el)}, ${el.style.backgroundColor}`)
        }}
        style={{ width: "40px", height: "40px", ...CLEAR }}
      />
    </WardicProvider>
  ))
  await until(() => log.calls.length >= 3, 2000)
  // The colour's spring settles about 170 ms after the opacity's (0→100 progress rests finer): long
  // enough after for a complete told per leg to show.
  for (let i = 0; i < 30; i++) await raf()
  expect(log.calls).toEqual([
    'start {"opacity":1,"background-color":"rgb(0, 0, 255)"}',
    'complete {"opacity":1,"background-color":"rgb(0, 0, 255)"}',
    "landed at 1, rgb(0, 0, 255)",
  ])
})

it("AC10: a Retarget with nothing to animate (an empty variant, on a spring) starts and completes at once", async () => {
  const log = recorder()
  const [name, setName] = createSignal("idle")
  render(() => (
    <WardicProvider env={DomLive}>
      <wardic.div
        variants={{ idle: {}, still: {} }}
        animate={name()}
        transition={SPRING}
        onAnimationStart={log.start}
        onAnimationComplete={log.complete}
        style={BOX}
      />
    </WardicProvider>
  ))
  for (let i = 0; i < 4; i++) await raf()
  const before = log.calls.length
  setName("still")
  expect(log.calls.slice(before), "both in the Retarget's own task").toEqual(['start "still"', 'complete "still"'])
})

it("AC11: over a variant, a hover's definition is its values, and so is the return's", async () => {
  const log = recorder()
  let el!: HTMLElement
  render(() => (
    <WardicProvider env={DomLive}>
      <wardic.div
        ref={(n: HTMLElement) => (el = n)}
        variants={{ rest: { opacity: 0.2 } }}
        initial="rest"
        animate="rest"
        whileHover={{ opacity: 1 }}
        transition={TWEEN}
        onAnimationStart={log.start}
        onAnimationComplete={log.complete}
        style={BOX}
      />
    </WardicProvider>
  ))
  await frames(4)
  expect(log.calls, "the mount, at its animate, tells nothing").toEqual([])
  await until(() => {
    el.dispatchEvent(new PointerEvent("pointerenter", { pointerId: 1, bubbles: true }))
    return log.calls.length > 0
  }, 2000)
  await until(() => log.calls.length === 2, 2000)
  el.dispatchEvent(new PointerEvent("pointerleave", { pointerId: 1, bubbles: true }))
  await until(() => log.calls.length === 4, 2000)
  expect(log.calls).toEqual(['start {"opacity":1}', 'complete {"opacity":1}', 'start {"opacity":0.2}', 'complete {"opacity":0.2}'])
})
