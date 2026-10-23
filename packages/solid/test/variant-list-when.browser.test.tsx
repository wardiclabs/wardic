// A list's names each run their own `when` on Solid 1 (#297's PR 2, ADR-0007, Motion's `animateVariant`
// a name). Real frames.
//
// - NW1: a name's `beforeChildren`: the children's keys of that name wait for the parent's; another
//   name's start at once.
// - NW2: a name's `afterChildren`: the parent's keys of that name wait for its children's; its other
//   name's start at once.
// - NW3: a name's gate opening doesn't restart another name's running animation.
// - NW4: an exit list inside a leaver: a name's `beforeChildren` holds the children's keys of that name.
// - NW5: a name with `beforeChildren` that sets no key on the parent lets its children's keys start at
//   once, as Motion's empty variant settles at once.
// - NW6: the same, the name later in the list.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, wardic, WardicProvider, type WardicVariants } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import { createSignal, type JSX, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf, until } from "./browser-helpers.ts"

afterEach(cleanup)

const opacityOf = (el: HTMLElement): number => Number(getComputedStyle(el).opacity)
const matrixOf = (el: HTMLElement): DOMMatrix => new DOMMatrix(getComputedStyle(el).transform)
const xOf = (el: HTMLElement): number => matrixOf(el).m41
const scaleOf = (el: HTMLElement): number => matrixOf(el).a

const BOX = { display: "block", width: "20px", height: "20px" } as const

const mount = (ui: () => JSX.Element) => {
  const { container } = render(() => <WardicProvider env={DomLive}>{ui()}</WardicProvider>)
  return (k: string): HTMLElement => container.querySelector<HTMLElement>(`[data-k="${k}"]`)!
}

describe("a list's names each run their own when on Solid 1 (#297)", () => {
  it("NW1: a name's beforeChildren holds the children's keys of that name; another name's start at once", async () => {
    const parent: WardicVariants = {
      visible: { opacity: 1, transition: { type: "tween", duration: 0.5, when: "beforeChildren" } },
      hidden: { opacity: 0 },
      active: {},
      inactive: {},
    }
    const child: WardicVariants = { visible: { x: 0 }, hidden: { x: -30 }, active: { scale: 1.5 }, inactive: { scale: 1 } }
    const q = mount(() => (
      <wardic.div data-k="parent" variants={parent} initial={["hidden", "inactive"]} animate={["visible", "active"]} style={BOX}>
        <wardic.span data-k="child" variants={child} transition={{ type: "tween", duration: 0.2 }} style={{ display: "inline-block" }} />
      </wardic.div>
    ))
    let scaledEarly = false
    let movedEarly = false
    await until(() => {
      if (opacityOf(q("parent")) < 0.8) {
        if (scaleOf(q("child")) > 1.2) scaledEarly = true
        if (xOf(q("child")) > -29) movedEarly = true
      }
      return Math.abs(xOf(q("child"))) < 0.5
    }, 3000)
    expect(scaledEarly, "active's keys at once").toBe(true)
    expect(movedEarly, "visible's keys waited for the parent's").toBe(false)
    expect(xOf(q("child"))).toBeCloseTo(0, 0)
  })

  it("NW2: a name's afterChildren holds the parent's keys of that name; its other name's start at once", async () => {
    const parent: WardicVariants = {
      faded: { opacity: 0.2, transition: { type: "tween", duration: 0.2, when: "afterChildren" } },
      lit: { opacity: 1 },
      big: { scale: 1.3, transition: { type: "tween", duration: 0.2 } },
      small: { scale: 1 },
    }
    const child: WardicVariants = { faded: { x: 40, transition: { type: "tween", duration: 0.5 } }, lit: { x: 0 }, big: {}, small: {} }
    const q = mount(() => (
      <wardic.div data-k="parent" variants={parent} initial={["lit", "small"]} animate={["faded", "big"]} style={BOX}>
        <wardic.span data-k="child" variants={child} style={{ display: "inline-block" }} />
      </wardic.div>
    ))
    let fadedEarly = false
    let grewEarly = false
    await until(() => {
      if (xOf(q("child")) < 38) {
        if (opacityOf(q("parent")) < 0.95) fadedEarly = true
        if (scaleOf(q("parent")) > 1.1) grewEarly = true
      }
      return opacityOf(q("parent")) < 0.21
    }, 3000)
    expect(grewEarly, "big's keys at once").toBe(true)
    expect(fadedEarly, "faded's keys waited for the children's").toBe(false)
    expect(opacityOf(q("parent"))).toBeLessThan(0.21)
  })

  it("NW3: a name's gate opening doesn't restart another name's running animation", async () => {
    const parent: WardicVariants = {
      visible: { opacity: 1, transition: { type: "tween", duration: 0.3, when: "beforeChildren" } },
      hidden: { opacity: 0 },
      active: {},
      inactive: {},
    }
    const child: WardicVariants = {
      visible: { x: 0, transition: { type: "tween", duration: 0.1 } },
      hidden: { x: -30 },
      active: { scale: 2, transition: { type: "tween", duration: 0.8 } },
      inactive: { scale: 1 },
    }
    const q = mount(() => (
      <wardic.div data-k="parent" variants={parent} initial={["hidden", "inactive"]} animate={["visible", "active"]} style={BOX}>
        <wardic.span data-k="child" variants={child} style={{ display: "inline-block" }} />
      </wardic.div>
    ))
    const t0 = performance.now()
    // The scale runs 0.8 s from the start; the visible gate opens at about 0.3 s. Restarted then, it
    // would run 0.8 s more, to about 1.1 s.
    await until(() => scaleOf(q("child")) > 1.99, 3000)
    expect(performance.now() - t0, "on its own 0.8 s").toBeLessThan(1000)
  })

  it("NW4: an exit list inside a leaver: a name's beforeChildren holds the children's keys of that name", async () => {
    const [shown, setShown] = createSignal(true)
    const parent: WardicVariants = {
      fade: { opacity: 0.2, transition: { type: "tween", duration: 0.4, when: "beforeChildren" } },
      slide: {},
    }
    const child: WardicVariants = { fade: { opacity: 0 }, slide: { x: 40 } }
    const q = mount(() => (
      <AnimatePresence>
        <Show when={shown()}>
          <wardic.div data-k="parent" variants={parent} initial={false} animate={{ opacity: 1 }} exit={["fade", "slide"]} style={BOX}>
            <wardic.span data-k="child" variants={child} transition={{ type: "tween", duration: 0.2 }} style={{ display: "inline-block", opacity: 1 }} />
          </wardic.div>
        </Show>
      </AnimatePresence>
    ))
    for (let i = 0; i < 3; i++) await raf()
    const p = q("parent")
    const c = q("child")
    setShown(false)
    let slidEarly = false
    let fadedEarly = false
    await until(() => {
      if (Bool.and(p.isConnected, opacityOf(p) > 0.4)) {
        if (xOf(c) > 20) slidEarly = true
        if (opacityOf(c) < 0.9) fadedEarly = true
      }
      return Bool.not(p.isConnected)
    }, 3000)
    expect(slidEarly, "slide's keys at once").toBe(true)
    expect(fadedEarly, "fade's keys waited for the parent's").toBe(false)
  })

  it("NW5: a name with beforeChildren and no key on the parent lets its children's keys start at once", async () => {
    const parent: WardicVariants = {
      staged: { transition: { type: "tween", duration: 0.8, when: "beforeChildren" } },
      flat: {},
    }
    const child: WardicVariants = { staged: { x: 0 }, flat: { x: -30 } }
    const q = mount(() => (
      <wardic.div data-k="parent" variants={parent} initial={["flat"]} animate={["staged"]} style={BOX}>
        <wardic.span data-k="child" variants={child} transition={{ type: "tween", duration: 0.2 }} style={{ display: "inline-block" }} />
      </wardic.div>
    ))
    const t0 = performance.now()
    await until(() => Math.abs(xOf(q("child"))) < 0.5, 3000)
    expect(performance.now() - t0, "not after an empty 0.8 s").toBeLessThan(600)
  })

  it("NW6: the same, the name later in the list", async () => {
    const parent: WardicVariants = {
      lit: { opacity: 1, transition: { type: "tween", duration: 0.1 } },
      dim: { opacity: 0.5 },
      staged: { transition: { type: "tween", duration: 0.8, when: "beforeChildren" } },
      flat: {},
    }
    const child: WardicVariants = { staged: { x: 0 }, flat: { x: -30 }, lit: {}, dim: {} }
    const q = mount(() => (
      <wardic.div data-k="parent" variants={parent} initial={["dim", "flat"]} animate={["lit", "staged"]} style={BOX}>
        <wardic.span data-k="child" variants={child} transition={{ type: "tween", duration: 0.2 }} style={{ display: "inline-block" }} />
      </wardic.div>
    ))
    const t0 = performance.now()
    await until(() => Math.abs(xOf(q("child"))) < 0.5, 3000)
    expect(performance.now() - t0, "not after an empty 0.8 s").toBeLessThan(600)
  })
})
