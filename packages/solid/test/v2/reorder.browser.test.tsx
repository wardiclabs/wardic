// `<Reorder>` on Solid 2 (#209 PR 3b, ADR-0020), with real Playwright mouse input: the Solid 1
// binding's Reorder cases, each through `Reorder.Group` / `Reorder.Item` and through
// `reorderGroup` / `reorderItem` on a plain `ul` / `li` (#209 PR 3b's R1).
//
// - RV1: a `ul` of `li`s by default, other tags with `as`, and no motion prop reaches the DOM.
// - RV2: a slow drag of b past c calls `onReorder` once with the swapped values; the DOM follows;
//   b stays under the pointer.
// - RV3: a slow drag of a past three neighbours reorders three times, in order.
// - RV4: a displaced sibling moves on its first painted frame after the reorder and ends on its slot.
// - RV5: axis x: a row reorders a past b and c; with no axis a wrapped grid is detected as xy.
// - RV6: the dragged item is raised while dragged, and its z-index goes after the release flies it
//   to its new slot.
// - RV7: an item's `touch-action` follows the group's axis, detected or given, and clearing the
//   given one detects it at once.
// - RV8: the group's `overflow-anchor` is none, and the user's style wins.
// - RV9: an item's motion config still works: `whileDrag` scales it while held.
// - RV10: `list.move(value, toIndex)` reorders through `onReorder`, and a reorder the app makes
//   itself animates the items.
// - RV11: an item is a ward: `row.read(key)`; a group given to `ref` alone sets its own
//   `overflow-anchor`.
// - RV12: an item's style stays reactive.
// - RV13: the gesture's axis: in a y list a diagonal drag moves the item only on y.
// - RV14: items rendered with `.map` log one warning per group when they remount; `<For>` logs none.
import { DomLive } from "@wardic/dom"
import { reorderGroup, reorderItem, WardicProvider } from "@wardic/solid/unstable/v2"
import type * as CoreReorder from "@wardic/core/Reorder"
import * as Bool from "effect/Boolean"
import { type Accessor, createSignal, flush, For } from "solid-js"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { page } from "vitest/browser"
import { until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"
import { add, centreOf, glide, grabOffsetOf, mountReorder, mouse, offPointer, type Pt, resetScene, sampleFrames, type Scene, settle, wait } from "./reorder-scene.tsx"

afterEach(resetScene)

// Rows are 440 px wide at left 40: widen the test iframe past its default 414 px.
let viewport = { width: 0, height: 0 }
beforeAll(async () => {
  viewport = { width: window.innerWidth, height: window.innerHeight }
  await page.viewport(1000, viewport.height)
  await wait(50)
})
afterAll(async () => {
  await page.viewport(viewport.width, viewport.height)
})

/** Press on `value`'s centre, glide by (dx, dy) in `steps`, hold `holdMs`, and return the grab. */
const drag = async (
  s: Scene,
  value: string,
  dx: number,
  dy: number,
  steps: number,
  options: { readonly ms?: number; readonly holdMs?: number } = {},
): Promise<{ readonly g: Pt; readonly to: Pt; readonly grabOffset: Pt }> => {
  const el = s.item(value)
  const g = centreOf(el)
  const grabOffset = grabOffsetOf(el, g)
  const to = add(g, dx, dy)
  await mouse.down(g)
  await glide(g, to, steps, options.ms ?? 20)
  await wait(options.holdMs ?? 300)
  return { g, to, grabOffset }
}

const joined = (orders: ReadonlyArray<ReadonlyArray<string>>): ReadonlyArray<string> => orders.map((o) => o.join(""))

/** The attributes a motion prop would leave if it leaked through to the DOM. */
const MOTION_ATTRIBUTES = ["values", "onreorder", "axis", "value", "as", "layout", "layoutid", "drag", "whiledrag", "initial", "animate", "transition"]

describe("Reorder.Group and Reorder.Item on Solid 2", () => {
  it("RV1: a ul of lis by default, other tags with as, and no motion prop reaches the DOM", async () => {
    const s = await mountReorder({ whileDrag: { scale: 1.05 } })
    expect(s.group().tagName).toBe("UL")
    expect(s.item("a").tagName).toBe("LI")
    for (const el of [s.group(), s.item("a")]) {
      const names = el.getAttributeNames()
      for (const name of MOTION_ATTRIBUTES) expect(names, `${el.tagName} has no ${name}`).not.toContain(name)
    }
    await resetScene()
    const t = await mountReorder({ groupAs: "section", itemAs: "article" })
    expect(t.group().tagName).toBe("SECTION")
    expect(t.item("a").tagName).toBe("ARTICLE")
  })
})

describe.each([
  { mode: "components", factories: false },
  { mode: "factories", factories: true },
])("Reorder on Solid 2, through the $mode", ({ factories }) => {
  it("RV2: a slow drag of b past c calls onReorder once with the swapped values; the DOM follows; b stays under the pointer", async () => {
    const s = await mountReorder({ factories })
    const { to, grabOffset } = await drag(s, "b", 0, 46, 23, { holdMs: 400 })
    expect(joined(s.reorders)).toEqual(["acbde"])
    expect([...s.group().querySelectorAll<HTMLElement>("[data-value]")].map((el) => el.dataset.value).join("")).toBe("acbde")
    expect(offPointer(s.item("b"), to, grabOffset)).toBeLessThan(1)
  })

  it("RV3: a slow drag of a past three neighbours reorders three times, in order", async () => {
    const s = await mountReorder({ factories })
    await drag(s, "a", 0, 201, 67)
    expect(joined(s.reorders)).toEqual(["bacde", "bcade", "bcdae"])
  })

  it("RV4: a displaced sibling moves on its first painted frame after the reorder and ends on its slot", async () => {
    const s = await mountReorder({ factories })
    const c = s.item("c")
    const before = c.getBoundingClientRect().top
    const sampling = sampleFrames(() => c.getBoundingClientRect().top)
    await drag(s, "b", 0, 46, 23, { holdMs: 700 })
    const frames = sampling.stop()
    expect(joined(s.reorders)).toEqual(["acbde"])
    const slot = before - 60
    const after = frames.filter((f) => f.frameAt > s.reorderTimes[0]!)
    const first = after[0]!.v
    expect(Math.abs(first - slot), "no jump to the new slot").toBeGreaterThan(1)
    expect(before - first, "moved toward it on the first frame").toBeGreaterThan(0.05)
    expect(Math.abs(after.at(-1)!.v - slot), "ends on the slot").toBeLessThanOrEqual(0.5)
  })

  it("RV5: axis x: a row reorders a past b and c; with no axis a wrapped grid is detected as xy", async () => {
    const s = await mountReorder({ factories, layout: "x", axis: () => "x" })
    const { to, grabOffset } = await drag(s, "a", 201, 0, 67)
    expect(joined(s.reorders)).toEqual(["bacde", "bcade"])
    expect(offPointer(s.item("a"), to, grabOffset)).toBeLessThan(1)
    await resetScene()
    const grid = await mountReorder({ factories, layout: "xy" })
    await drag(grid, "a", 90, 60, 40)
    expect(grid.order().join("")).toBe("bcdeaf")
  })

  it("RV6: the dragged item is raised while dragged; the release flies it to its slot, and its z-index goes", async () => {
    const s = await mountReorder({ factories })
    const b = s.item("b")
    const groupTop = s.group().getBoundingClientRect().top
    const { to } = await drag(s, "b", 0, 46, 23)
    expect(getComputedStyle(b).zIndex, "raised while dragged").not.toBe("auto")
    const sampling = sampleFrames(() => b.getBoundingClientRect().top)
    const upAt = performance.now()
    await mouse.up(to)
    await wait(900)
    const frames = sampling.stop().filter((f) => f.frameAt > upAt)
    const slot = groupTop + 2 * 60
    expect(Math.abs(frames[0]!.v - slot), "flies (not a jump)").toBeGreaterThan(1)
    expect(Math.abs(frames.at(-1)!.v - slot), "ends on the slot").toBeLessThanOrEqual(0.5)
    expect(b.style.getPropertyValue("z-index"), "no inline z-index at rest").toBe("")
  })

  it("RV7: touch-action follows the group's axis, detected or given; clearing the given one detects it at once", async () => {
    const y = await mountReorder({ factories })
    expect(y.item("a").style.getPropertyValue("touch-action")).toBe("pan-x")
    await resetScene()
    const xy = await mountReorder({ factories, layout: "xy" })
    expect(xy.item("a").style.getPropertyValue("touch-action")).toBe("none")
    await resetScene()
    // A row given "y": the controller detects nothing while the app gives the axis, so clearing it
    // has to detect the row's "x" then.
    const [axis, setAxis] = createSignal<CoreReorder.Axis | undefined>("y")
    const s = await mountReorder({ factories, layout: "x", axis })
    expect(s.item("a").style.getPropertyValue("touch-action")).toBe("pan-x")
    setAxis(undefined)
    // At once: in the flush that clears it (the detection), and the next (the style), before any frame.
    flush()
    flush()
    expect(s.item("a").style.getPropertyValue("touch-action")).toBe("pan-y")
  })

  it("RV8: the group's overflow-anchor is none, and the user's style wins", async () => {
    const s = await mountReorder({ factories })
    expect(s.group().style.getPropertyValue("overflow-anchor")).toBe("none")
    await resetScene()
    const t = await mountReorder({ factories, groupStyle: () => ({ "overflow-anchor": "auto" }) })
    expect(t.group().style.getPropertyValue("overflow-anchor")).toBe("auto")
  })

  it("RV9: an item's motion config still works: whileDrag scales it while held", async () => {
    const s = await mountReorder({ factories, whileDrag: { scale: 1.1 } })
    const b = s.item("b")
    await drag(s, "b", 0, 10, 5)
    let previous = 0
    await until(() => {
      const width = b.getBoundingClientRect().width
      const settled = width > 215 && Math.abs(width - previous) < 0.01
      previous = width
      return settled
    })
    expect(b.getBoundingClientRect().width).toBeCloseTo(220, 0)
  })

  it("RV13: the gesture's axis: in a y list a diagonal drag moves the item only on y", async () => {
    const s = await mountReorder({ factories })
    const b = s.item("b")
    const start = b.getBoundingClientRect()
    await drag(s, "b", 40, 20, 10)
    const now = b.getBoundingClientRect()
    expect(Math.abs(now.left - start.left), "x").toBeLessThan(0.5)
    expect(now.top - start.top, "y").toBeCloseTo(20, 0)
  })

  it("RV12: an item's style stays reactive", async () => {
    const [color, setColor] = createSignal("rgb(1, 2, 3)")
    const s = await mountReorder({ factories, itemStyle: () => ({ color: color() }) })
    expect(s.item("b").style.color).toBe("rgb(1, 2, 3)")
    setColor("rgb(4, 5, 6)")
    flush()
    await settle()
    expect(s.item("b").style.color).toBe("rgb(4, 5, 6)")
  })
})

describe("reorderGroup and reorderItem", () => {
  it("RV10: list.move reorders through onReorder, and a reorder the app makes itself animates the items", async () => {
    const s = await mountReorder({ factories: true })
    const c = s.item("c")
    const before = c.getBoundingClientRect().top
    const sampling = sampleFrames(() => c.getBoundingClientRect().top)
    s.move("c", 0)
    flush()
    await wait(900)
    expect(joined(s.reorders)).toEqual(["cabde"])
    const frames = sampling.stop().map((f) => f.v)
    const slot = before - 2 * 60
    expect(frames.filter((top) => top < before - 1 && top > slot + 1).length, "it flies there").toBeGreaterThan(3)
    expect(Math.abs(frames.at(-1)! - slot)).toBeLessThanOrEqual(0.5)
    // The app's own reorder.
    const e = s.item("e")
    const eBefore = e.getBoundingClientRect().top
    const eSampling = sampleFrames(() => e.getBoundingClientRect().top)
    s.setOrder(["e", "c", "a", "b", "d"])
    await wait(900)
    const eFrames = eSampling.stop().map((f) => f.v)
    const eSlot = eBefore - 4 * 60
    expect(eFrames.filter((top) => top < eBefore - 1 && top > eSlot + 1).length, "it flies there too").toBeGreaterThan(3)
    expect(Math.abs(eFrames.at(-1)! - eSlot)).toBeLessThanOrEqual(0.5)
  })

  it("RV11: an item is a ward (read); a group given to ref alone sets its own overflow-anchor", async () => {
    const [values, setValues] = createSignal<ReadonlyArray<string>>(["a", "b", "c"])
    let group!: HTMLElement
    let opacityOfB!: Accessor<number | undefined>
    const List = () => {
      const list = reorderGroup({ values, onReorder: setValues })
      return (
        <ul ref={[list, (el: HTMLElement) => (group = el)]} style={{ position: "absolute", left: "40px", top: "40px", width: "200px", margin: "0", padding: "0" }}>
          <For each={values()}>
            {(value) => {
              const row = reorderItem(list, { value, style: { height: "40px", opacity: 0.5 } })
              if (value === "b") opacityOfB = row.read("opacity")
              return (
                <li {...row} data-value={value}>
                  {value}
                </li>
              )
            }}
          </For>
        </ul>
      )
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <List />
      </WardicProvider>
    ))
    await settle()
    expect(group.style.getPropertyValue("overflow-anchor")).toBe("none")
    expect(opacityOfB()).toBe(0.5)
  })

  it("RV14: items rendered with .map log one warning per group when they remount; <For> logs none", async () => {
    const lines: Array<string> = []
    const methods = ["log", "info", "warn", "error", "debug", "group", "groupCollapsed"] as const
    const spies = methods.map((m) =>
      vi.spyOn(console, m).mockImplementation((...args: Array<unknown>) => {
        lines.push(args.map(String).join(" "))
      }),
    )
    const scene = (keyed: boolean) => {
      const [values, setValues] = createSignal<ReadonlyArray<string>>(["a", "b", "c"])
      const List = () => {
        const list = reorderGroup({ values, onReorder: setValues })
        const row = (value: string) => {
          const item = reorderItem(list, { value, style: { height: "30px" } })
          return <li {...item}>{value}</li>
        }
        return (
          <ul {...list}>
            {Bool.match(keyed, { onTrue: () => <For each={values()}>{row}</For>, onFalse: () => values().map(row) })}
          </ul>
        )
      }
      const { unmount } = mount(() => (
        <WardicProvider env={DomLive}>
          <List />
        </WardicProvider>
      ))
      return { setValues, unmount }
    }
    try {
      const mapped = scene(false)
      await settle()
      mapped.setValues(["b", "a", "c"])
      flush()
      await settle()
      mapped.setValues(["c", "b", "a"])
      flush()
      await settle()
      expect(lines.filter((l) => l.includes("<For>")), "one warning, naming <For>").toHaveLength(1)
      mapped.unmount()
      lines.length = 0
      const keyed = scene(true)
      await settle()
      keyed.setValues(["b", "a", "c"])
      flush()
      await settle()
      expect(lines.filter((l) => l.includes("<For>"))).toHaveLength(0)
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })
})
