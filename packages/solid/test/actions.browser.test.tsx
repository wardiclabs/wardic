// Sequences as actions (#884's PR 5; ADR-0073 decision 21, 8a), in a real browser: `createAnimate`'s
// controls are a promise of their landing, so an action yields them one after another. A
// `createOptimistic` flag shows at once, and the action's other writes land with it, once its last
// animation has.
//
// - AC1: an action yielding two animations runs them in turn: the second starts once the first has landed.
// - AC2: its `createOptimistic` flag reads true at once and false once it's done; a signal it wrote
//   before its first `yield` reads its old value until then.
import { DomLive } from "@wardic/dom"
import { createAnimate, WardicProvider } from "@wardic/solid"
import { action, createOptimistic, createSignal, flush } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf, until } from "./browser-helpers.ts"
import { mount } from "./mount.tsx"

/** An element's committed translateX: its computed matrix's e, 0 for none. */
const translateXOf = (el: Element): number => {
  const t = getComputedStyle(el).transform
  if (t === "" || t === "none") return 0
  return Number(/\(([^)]+)\)/.exec(t)![1]!.split(",")[4])
}

const LINEAR = { type: "tween", duration: 0.2, ease: "linear" } as const
const BOX = { width: "20px", height: "20px" } as const

describe("sequences as actions (#884's PR 5, 8a)", () => {
  it("AC1 and AC2: the action's animations run in turn; its optimistic flag shows at once, its other writes once it's done", async () => {
    let open!: () => Promise<unknown>
    let busy!: () => boolean
    let opened!: () => boolean
    let lid!: HTMLDivElement
    let gem!: HTMLDivElement
    const atLanding: Array<readonly [number, number]> = []
    const Box = () => {
      const [scope, animate] = createAnimate()
      const [isOpened, setOpened] = createSignal(false)
      const [isBusy, setBusy] = createOptimistic(false)
      opened = isOpened
      busy = isBusy
      open = action(function* () {
        setBusy(true)
        setOpened(true)
        yield animate(lid, { x: 100 }, LINEAR)
        atLanding.push([translateXOf(lid), translateXOf(gem)])
        yield animate(gem, { x: 50 }, LINEAR)
      })
      return (
        <div ref={scope}>
          <div ref={lid} style={BOX} />
          <div ref={gem} style={BOX} />
        </div>
      )
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    await raf()
    const done = open()
    flush()
    // AC2: the flag at once; the action's own write held until it's done.
    expect([busy(), opened()]).toEqual([true, false])
    await until(() => translateXOf(lid) > 10, 4000, "the lid moving")
    // AC1: the gem waits for the lid.
    expect(translateXOf(gem)).toBe(0)
    expect(opened()).toBe(false)
    await done
    flush()
    expect(atLanding).toEqual([[100, 0]])
    expect(translateXOf(gem)).toBe(50)
    // AC2: once it's done, the write lands and the flag goes back.
    expect([busy(), opened()]).toEqual([false, true])
  })
})
