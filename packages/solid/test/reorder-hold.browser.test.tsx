// A Reorder group's holds on Solid 1 (#348, ADR-0020 *Amendment (#348)*): an item in a user's hand,
// from its drag's start or its keyboard lift to its end, told by `onHoldStart` and `onHoldEnd`, with
// `onReorderEnd` between when it moved. Real mouse, real keys, real frames.
//
// - HO1: a drag's start is told at the drag's start, not the press; at its release, reorderEnd,
//   then the end (`drop`).
// - HO2: a click is no hold. HO3: a drag dropped back ends with no reorderEnd.
// - HO4: a keyboard lift is a hold: dropped elsewhere, reorderEnd then its end. HO5: Escape ends it
//   as a `cancel`. HO6: focus leaving drops it.
// - HO7: one at a time: a drag of another item, its press moving no focus, ends the lift first; each
//   hold ends once.
// - HO8: the dragged item unmounting mid-drag ends its hold as an `unmount`; its release tells nothing.
// - HO9: another item unmounting mid-drag leaves the hold be. HO10: an item unmounting after its
//   hold ended tells nothing more. HO11: a lift outlives a re-read of the values that changes nothing.
import { createSignal } from "solid-js"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { commands, page } from "vitest/browser"
import "./browser-commands.ts"
import { raf } from "./browser-helpers.ts"
import { add, centreOf, glide, mountReorder, mouse, resetScene, type Scene, type SceneOptions, settle, wait } from "./reorder-harness.tsx"

afterEach(resetScene)
let viewport = { width: 0, height: 0 }
beforeAll(async () => {
  viewport = { width: window.innerWidth, height: window.innerHeight }
  await page.viewport(1000, viewport.height)
  await wait(50)
})
afterAll(async () => {
  await page.viewport(viewport.width, viewport.height)
})

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

const SCENE = (o: SceneOptions = {}): Promise<Scene> => mountReorder(o)
const LOG = (s: Scene): ReadonlyArray<string> => s.holds

describe("a Reorder group's holds on Solid 1 (#348)", () => {
  it("HO1: a drag tells its start at the drag's start, not the press; at the release, reorderEnd, then its end", async () => {
    const s = await SCENE()
    const log = LOG(s)
    const g = centreOf(s.item("a"))
    await mouse.down(g)
    await mouse.move(add(g, 0, 1))
    await wait(100)
    expect([...log], "nothing at the press").toEqual([])
    await glide(add(g, 0, 1), add(g, 0, 130), 14)
    await wait(300)
    expect([...log], "the start, once the drag started").toEqual(["start a 0"])
    await mouse.up(add(g, 0, 130))
    await settle()
    const to = s.order().indexOf("a")
    expect(to, "moved down").toBeGreaterThan(1)
    expect([...log]).toEqual(["start a 0", `reorder a 0→${to}`, `end a 0→${to} drop`])
  })

  it("HO2: a click is no hold", async () => {
    const s = await SCENE()
    const log = LOG(s)
    const g = centreOf(s.item("a"))
    await mouse.down(g)
    await mouse.up(g)
    await settle()
    expect([...log]).toEqual([])
  })

  it("HO3: a drag dropped back where it began ends, with no reorderEnd", async () => {
    const s = await SCENE()
    const log = LOG(s)
    const g = centreOf(s.item("a"))
    await mouse.down(g)
    await glide(g, add(g, 0, 130), 14)
    await wait(200)
    await glide(add(g, 0, 130), g, 14)
    await wait(200)
    await mouse.up(g)
    await settle()
    expect([...log]).toEqual(["start a 0", "end a 0→0 drop"])
  })

  it("HO4: a keyboard lift is a hold: dropped elsewhere, reorderEnd, then its end", async () => {
    const s = await SCENE()
    const log = LOG(s)
    s.item("b").focus()
    await commands.realKey("press", "Space")
    await frames(2)
    expect([...log]).toEqual(["start b 1"])
    await commands.realKey("press", "ArrowDown")
    await frames(3)
    await commands.realKey("press", "ArrowDown")
    await frames(3)
    await commands.realKey("press", "Space")
    await frames(2)
    expect([...log]).toEqual(["start b 1", "reorder b 1→3", "end b 1→3 drop"])
  })

  it("HO5: Escape ends a lift as a cancel, the order put back, with no reorderEnd", async () => {
    const s = await SCENE()
    const log = LOG(s)
    s.item("b").focus()
    await commands.realKey("press", "Space")
    await commands.realKey("press", "ArrowDown")
    await frames(3)
    await commands.realKey("press", "Escape")
    await frames(2)
    expect([...log]).toEqual(["start b 1", "end b 1→1 cancel"])
  })

  it("HO6: focus leaving a lifted item drops it: its end", async () => {
    const s = await SCENE()
    const log = LOG(s)
    s.item("b").focus()
    await commands.realKey("press", "Space")
    await commands.realKey("press", "ArrowDown")
    await frames(3)
    s.item("b").blur()
    await frames(2)
    expect([...log]).toEqual(["start b 1", "reorder b 1→2", "end b 1→2 drop"])
  })

  it("HO7: one hold at a time: a drag of another item, its press moving no focus, ends the lift first", async () => {
    const s = await SCENE()
    const log = LOG(s)
    // Keep the press from moving focus, so nothing but the drag's start ends the lift.
    s.item("d").addEventListener("mousedown", (event) => event.preventDefault())
    s.item("b").focus()
    await commands.realKey("press", "Space")
    await frames(2)
    const g = centreOf(s.item("d"))
    await mouse.down(g)
    await glide(g, add(g, 0, -60), 10)
    await wait(200)
    expect(log.slice(0, 3), "the lift's end, then the drag's start").toEqual(["start b 1", "end b 1→1 drop", "start d 3"])
    await mouse.up(add(g, 0, -60))
    await settle()
    expect(log.filter((line) => line.startsWith("end")).length, "each hold ended once").toBe(2)
  })

  it("HO8: the dragged item unmounting mid-drag ends its hold as an unmount", async () => {
    const s = await SCENE()
    const log = LOG(s)
    const g = centreOf(s.item("a"))
    await mouse.down(g)
    await glide(g, add(g, 0, 20), 6)
    await wait(100)
    expect([...log]).toEqual(["start a 0"])
    s.setOrder(s.order().filter((value) => value !== "a"))
    await settle()
    expect([...log]).toEqual(["start a 0", "end a 0→-1 unmount"])
    await mouse.up(add(g, 0, 20))
    await settle()
    expect(log.length, "its release tells nothing more").toBe(2)
  })

  it("HO9: another item unmounting mid-drag leaves the hold be", async () => {
    const s = await SCENE()
    const log = LOG(s)
    const g = centreOf(s.item("a"))
    await mouse.down(g)
    await glide(g, add(g, 0, 20), 6)
    await wait(100)
    s.setOrder(s.order().filter((value) => value !== "e"))
    await settle()
    expect([...log], "still held").toEqual(["start a 0"])
    await mouse.up(add(g, 0, 20))
    await settle()
    expect([...log]).toEqual(["start a 0", "end a 0→0 drop"])
  })

  it("HO10: an item unmounting after its hold ended tells nothing more", async () => {
    const s = await SCENE()
    const log = LOG(s)
    s.item("b").focus()
    await commands.realKey("press", "Space")
    await frames(2)
    await commands.realKey("press", "Space")
    await frames(2)
    expect([...log]).toEqual(["start b 1", "end b 1→1 drop"])
    s.setOrder(s.order().filter((value) => value !== "b"))
    await settle()
    expect([...log], "each hold ends once").toEqual(["start b 1", "end b 1→1 drop"])
  })

  it("HO11: a lift outlives a re-read of the values that changes nothing", async () => {
    const [tick, setTick] = createSignal(0)
    const s = await SCENE({ alsoRead: tick })
    const log = LOG(s)
    s.item("b").focus()
    await commands.realKey("press", "Space")
    await frames(2)
    setTick(1)
    await frames(2)
    expect([...log], "still lifted").toEqual(["start b 1"])
    await commands.realKey("press", "ArrowDown")
    await frames(3)
    await commands.realKey("press", "Space")
    await frames(2)
    expect([...log]).toEqual(["start b 1", "reorder b 1→2", "end b 1→2 drop"])
  })
})
