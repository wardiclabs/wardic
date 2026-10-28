// A key already at its target starts no leg (#448, Motion's `visual-element-target.ts`), on Solid 1: it
// stays where it is, written once more, and a Retarget whose every key is there lands at once. A mount
// that starts at its `animate` tells nothing (Motion's `animation-state.ts`). Solid 2's are TH7–TH8;
// the server's, AR21; the Handoff's, AH13.
//
// - TH1: a mount already at its `animate`, on a 1 s tween, starts and completes at once: one the
//   element already shows (no `initial`), and one whose `style` is its `animate`'s.
// - TH2: `initial={false}` tells nothing at mount, the element drawn at its `animate`; a later change
//   is told.
// - TH3: an `initial` that is the same values map, or the same names, as `animate` tells nothing; an
//   equal copy of the map is told, at once.
// - TH4: a variant change that leaves a key where it is starts it no leg: its 3 s transition doesn't
//   hold the landing.
// - TH5: a key a leg is drawing is never already there: a target it's still at, set as its leg
//   starts, runs a leg of its own, as Motion's does while a value animates.
// - TH6: a `when: "beforeChildren"` parent with nothing to move releases its children at once.
// - TH9: a key with nothing to start from (`z-index`, `auto` on the element) isn't already there: its
//   leg runs its duration and writes it, as Motion's does for a value it has none of.
// - TH10: a key whose transition gives it a velocity isn't already there: kicked, it moves and comes
//   back (Motion's `valueTransition.velocity`), a value's own entry's included.
import { render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { wardic, type WardicAnimationDefinition, WardicProvider } from "@wardic/solid"
import { createSignal, type JSX } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf, until } from "./browser-helpers.ts"
import { resetScene, wait } from "./reorder-harness.tsx"

afterEach(resetScene)

// Clear of the page's one mouse, parked at (5, 5) for every browser file.
const BOX = { width: "40px", height: "40px", background: "teal", "margin-top": "120px", "margin-left": "120px" } as const
const SLOW = { type: "tween", duration: 1 } as const

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

/** A log of the callbacks, each with its definition. */
const recorder = () => {
  const calls: Array<string> = []
  return {
    calls,
    start: (definition: WardicAnimationDefinition) => calls.push(`start ${JSON.stringify(definition)}`),
    complete: (definition: WardicAnimationDefinition) => calls.push(`complete ${JSON.stringify(definition)}`),
  }
}

const show = (ui: () => JSX.Element): void => {
  render(() => <WardicProvider env={DomLive}>{ui()}</WardicProvider>)
}

const opacity = (el: Element): number => Number(getComputedStyle(el).opacity)
const xOf = (el: Element): number => new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)")).m41

describe("a key already at its target on Solid 1 (#448)", () => {
  it("TH1: a mount already at its animate starts and completes at once", async () => {
    const shown = recorder()
    const styled = recorder()
    show(() => (
      <>
        <wardic.div style={BOX} animate={{ opacity: 1 }} transition={SLOW} onAnimationStart={shown.start} onAnimationComplete={shown.complete} />
        <wardic.div style={{ ...BOX, opacity: 0.5 }} animate={{ opacity: 0.5 }} transition={SLOW} onAnimationStart={styled.start} onAnimationComplete={styled.complete} />
      </>
    ))
    await frames(3)
    expect(shown.calls, "one the element already shows").toEqual(['start {"opacity":1}', 'complete {"opacity":1}'])
    expect(styled.calls, "one its style already sets").toEqual(['start {"opacity":0.5}', 'complete {"opacity":0.5}'])
  })

  it("TH2: initial={false} tells nothing at mount, drawn at its animate; a later change is told", async () => {
    const log = recorder()
    const [to, setTo] = createSignal(0.5)
    let el!: HTMLElement
    show(() => (
      <wardic.div
        ref={(n: HTMLElement) => (el = n)}
        style={BOX}
        initial={false}
        animate={{ opacity: to(), x: 20 }}
        transition={{ type: "tween", duration: 0.1 }}
        onAnimationStart={log.start}
        onAnimationComplete={log.complete}
      />
    ))
    await wait(300)
    expect(log.calls, "nothing at mount").toEqual([])
    expect(opacity(el)).toBe(0.5)
    expect(xOf(el)).toBeCloseTo(20, 3)
    setTo(1)
    await until(() => log.calls.length === 2, 2000)
    expect(log.calls).toEqual(['start {"opacity":1,"x":20}', 'complete {"opacity":1,"x":20}'])
  })

  it("TH3: an initial that is animate's map or names tells nothing; an equal copy is told at once", async () => {
    const same = recorder()
    const names = recorder()
    const copy = recorder()
    const target = { opacity: 0.5 }
    const variants = { a: { opacity: 0.5 }, b: { x: 10 } }
    show(() => (
      <>
        <wardic.div style={BOX} initial={target} animate={target} transition={SLOW} onAnimationStart={same.start} onAnimationComplete={same.complete} />
        <wardic.div style={BOX} variants={variants} initial={["a", "b"]} animate={["a", "b"]} transition={SLOW} onAnimationStart={names.start} onAnimationComplete={names.complete} />
        <wardic.div style={BOX} initial={{ opacity: 0.5 }} animate={{ opacity: 0.5 }} transition={SLOW} onAnimationStart={copy.start} onAnimationComplete={copy.complete} />
      </>
    ))
    await frames(3)
    expect(copy.calls, "an equal copy, at once").toEqual(['start {"opacity":0.5}', 'complete {"opacity":0.5}'])
    await wait(200)
    expect(same.calls, "the same map").toEqual([])
    expect(names.calls, "the same names").toEqual([])
  })

  it("TH4: a variant change that leaves a key where it is starts it no leg", async () => {
    const log = recorder()
    const [name, setName] = createSignal("a")
    let el!: HTMLElement
    show(() => (
      <wardic.div
        ref={(n: HTMLElement) => (el = n)}
        style={BOX}
        variants={{ a: { opacity: 0.5, x: 0 }, b: { opacity: 0.5, x: 60 } }}
        initial={false}
        animate={name()}
        transition={{ type: "tween", duration: 0.1, opacity: { type: "tween", duration: 3 } }}
        onAnimationStart={log.start}
        onAnimationComplete={log.complete}
      />
    ))
    await frames(3)
    setName("b")
    await until(() => log.calls.length === 2, 1000)
    expect(log.calls, "landed with x, not after opacity's 3 s").toEqual(['start "b"', 'complete "b"'])
    expect(xOf(el)).toBeCloseTo(60, 3)
    expect(opacity(el)).toBe(0.5)
  })

  it("TH5: a key a leg is drawing, set back to where it still is, runs a leg of its own", async () => {
    const log = recorder()
    const [x, setX] = createSignal(0)
    show(() => (
      <wardic.div style={BOX} initial={false} animate={{ x: x() }} transition={{ type: "tween", duration: 0.4 }} onAnimationStart={log.start} onAnimationComplete={log.complete} />
    ))
    await frames(3)
    // Both in one task: the leg toward 100 has drawn nothing, so x is still at 0.
    setX(100)
    setX(0)
    const at = performance.now()
    await until(() => log.calls.includes('complete {"x":0}'), 2000)
    expect(log.calls).toEqual(['start {"x":100}', 'start {"x":0}', 'complete {"x":0}'])
    expect(performance.now() - at, "its leg ran its duration").toBeGreaterThan(300)
  })

  it("TH6: a beforeChildren parent with nothing to move releases its children at once", async () => {
    let child!: HTMLElement
    show(() => (
      <wardic.div
        style={BOX}
        variants={{ hidden: { opacity: 1 }, shown: { opacity: 1 } }}
        initial="hidden"
        animate="shown"
        transition={{ type: "tween", duration: 2, when: "beforeChildren" }}
      >
        <wardic.div
          ref={(n: HTMLElement) => (child = n)}
          style={{ width: "10px", height: "10px" }}
          variants={{ hidden: { opacity: 0 }, shown: { opacity: 1 } }}
          transition={{ type: "tween", duration: 0.1 }}
        />
      </wardic.div>
    ))
    await until(() => opacity(child) === 1, 1000)
    expect(opacity(child), "not held for the parent's 2 s").toBe(1)
  })

  it("TH9: a key with nothing to start from runs its leg its duration, and is written", async () => {
    const log = recorder()
    let el!: HTMLElement
    show(() => (
      <wardic.div ref={(n: HTMLElement) => (el = n)} style={BOX} animate={{ "z-index": 2 }} transition={{ type: "tween", duration: 0.5 }} onAnimationStart={log.start} onAnimationComplete={log.complete} />
    ))
    await frames(3)
    expect(log.calls, "started, not landed").toEqual(['start {"z-index":2}'])
    await until(() => log.calls.length === 2, 2000)
    expect(log.calls).toEqual(['start {"z-index":2}', 'complete {"z-index":2}'])
    expect(getComputedStyle(el).zIndex).toBe("2")
  })

  it("TH10: a key its transition gives a velocity is kicked: it moves and comes back", async () => {
    const log = recorder()
    const [name, setName] = createSignal("rest")
    let el!: HTMLElement
    show(() => (
      <wardic.div
        ref={(n: HTMLElement) => (el = n)}
        style={BOX}
        variants={{ rest: { x: 0 }, kicked: { x: 0, transition: { x: { type: "spring", stiffness: 300, damping: 20, velocity: 800 } } } }}
        initial={false}
        animate={name()}
        onAnimationStart={log.start}
        onAnimationComplete={log.complete}
      />
    ))
    await frames(3)
    setName("kicked")
    let farthest = 0
    for (let i = 0; i < 20; i++) {
      await raf()
      farthest = Math.max(farthest, Math.abs(xOf(el)))
    }
    expect(farthest, "it moved").toBeGreaterThan(5)
    await until(() => log.calls.length === 2, 3000)
    expect(log.calls).toEqual(['start "kicked"', 'complete "kicked"'])
    expect(xOf(el)).toBeCloseTo(0, 1)
  })
})
