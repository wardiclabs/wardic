// A Reorder group's `reorderEnd` on Solid 2 (#257 item 3): a user's reorder that changed the order,
// told once at its end with `{ values, value, from, to }`, through `list.next` / `list.each`, from
// `reorderGroup` and from `Reorder.Group`'s `groupRef`. Real mouse, real keys, real frames.
//
// - RE1: a drag that moves an item tells one `reorderEnd` at its release, however many `onReorder`s
//   it made: the final order, the item, its indexes at the start and the end.
// - RE2: a drag dropped back where it began tells none.
// - RE3: a keyboard lift dropped elsewhere tells one; one cancelled (Escape), or dropped where it was
//   lifted, tells none.
// - RE4: `list.move` in code tells none.
// - RE5: the save pattern: `values` a writable memo of the saved order, written while dragging; a save
//   action at `reorderEnd` puts it back if the save fails, and the item glides back to its slot.
// - RE6: the group's disposal rejects a waiting `next` with an `AbortError`, and ends an `each`.
import * as ReorderController from "@wardic/dom/ReorderController"
import { DomLive } from "@wardic/dom"
import { type ReorderGroup, reorderGroup, reorderItem, WardicProvider } from "@wardic/solid/unstable/v2"
import * as Bool from "effect/Boolean"
import { action, createSignal, For } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { commands } from "vitest/browser"
import "../browser-commands.ts"
import { raf } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"
import { add, centreOf, glide, mountReorder, mouse, resetScene, settle, wait } from "./reorder-scene.tsx"

afterEach(resetScene)

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

/** Every `reorderEnd` the group tells from now on. */
const collect = (list: ReorderGroup<string>): Array<ReorderController.End<string>> => {
  const ends: Array<ReorderController.End<string>> = []
  void (async () => {
    for await (const end of list.each("reorderEnd")) ends.push(end)
  })()
  return ends
}

describe.each([
  { mode: "Reorder.Group's groupRef", factories: false },
  { mode: "reorderGroup", factories: true },
])("reorderEnd on Solid 2, through $mode (#257 item 3)", ({ factories }) => {
  it("RE1: a drag that moves an item tells one reorderEnd at its release", async () => {
    const s = await mountReorder({ factories })
    const ends = collect(s.list())
    const g = centreOf(s.item("a"))
    await mouse.down(g)
    await glide(g, add(g, 0, 130), 14)
    await wait(300)
    expect(s.reorders.length, "onReorder at each crossover").toBeGreaterThan(1)
    expect(ends, "nothing before the release").toEqual([])
    await mouse.up(add(g, 0, 130))
    await settle()
    expect(ends).toEqual([{ values: [...s.order()], value: "a", from: 0, to: s.order().indexOf("a") }])
    expect(s.order().indexOf("a"), "moved down").toBeGreaterThan(1)
  })

  it("RE2: a drag dropped back where it began tells none", async () => {
    const s = await mountReorder({ factories })
    const ends = collect(s.list())
    const g = centreOf(s.item("a"))
    await mouse.down(g)
    await glide(g, add(g, 0, 130), 14)
    await wait(200)
    expect(s.order().indexOf("a"), "moved on the way").toBeGreaterThan(0)
    await glide(add(g, 0, 130), g, 14)
    await wait(200)
    await mouse.up(g)
    await settle()
    expect(s.order().indexOf("a"), "back where it began").toBe(0)
    expect(ends).toEqual([])
  })

  it("RE3: a keyboard lift dropped elsewhere tells one; cancelled, or dropped in place, none", async () => {
    const s = await mountReorder({ factories })
    const ends = collect(s.list())
    const b = s.item("b")
    b.focus()
    await commands.realKey("press", "Space")
    await commands.realKey("press", "ArrowDown")
    await frames(3)
    await commands.realKey("press", "ArrowDown")
    await frames(3)
    await commands.realKey("press", "Space")
    await frames(2)
    expect(ends).toEqual([{ values: [...s.order()], value: "b", from: 1, to: 3 }])
    s.item("b").focus()
    await commands.realKey("press", "Space")
    await commands.realKey("press", "ArrowUp")
    await frames(3)
    await commands.realKey("press", "Escape")
    await frames(2)
    await commands.realKey("press", "Space")
    await frames(2)
    await commands.realKey("press", "Space")
    await frames(2)
    expect(ends.length, "a cancel, and a drop in place, tell none").toBe(1)
  })

  it("RE4: list.move in code tells none", async () => {
    const s = await mountReorder({ factories })
    const ends = collect(s.list())
    s.list().move("a", 3)
    await frames(3)
    expect(s.order().indexOf("a")).toBe(3)
    expect(ends).toEqual([])
  })
})

/** How long a save takes: past the drop's own glide (0.45 s), so the item has landed before it fails. */
const SAVE_MS = 1000

describe("reorderEnd's save pattern on Solid 2 (#257 item 3)", () => {
  it("RE5: a failed save puts the order back, and the item glides back to its slot", async () => {
    let saves = 0
    let ok = false
    let list!: ReorderGroup<string>
    let saved!: () => ReadonlyArray<string>
    let items!: () => ReadonlyArray<string>
    const Scene = () => {
      const [savedOrder, setSaved] = createSignal<ReadonlyArray<string>>(["a", "b", "c", "d"])
      // The saved order, written while dragging: a writable memo of it.
      const [order, setOrder] = createSignal(() => savedOrder())
      saved = savedOrder
      items = order
      const save = action(function* (next: ReadonlyArray<string>) {
        saves++
        try {
          yield new Promise((resolve, reject) => setTimeout(() => Bool.match(ok, { onTrue: () => resolve(undefined), onFalse: () => reject(new Error("offline")) }), SAVE_MS))
          setSaved(next)
        } catch {
          setOrder(savedOrder())
        }
      })
      list = reorderGroup({ values: order, onReorder: setOrder, style: { position: "relative", "list-style": "none", margin: "0", padding: "0", width: "200px" } })
      void (async () => {
        for await (const end of list.each("reorderEnd")) void save(end.values)
      })()
      return (
        <ul {...list}>
          <For each={order()}>
            {(value) => {
              const row = reorderItem(list, { value, style: { height: "40px", "margin-bottom": "8px", background: "#9cf" } })
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
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await frames(4)
    const item = (value: string): HTMLElement => host.querySelector<HTMLElement>(`[data-value="${value}"]`)!
    const slotOfB = item("b").getBoundingClientRect().top
    item("b").focus()
    await commands.realKey("press", "Space")
    await commands.realKey("press", "ArrowDown")
    await frames(3)
    await commands.realKey("press", "ArrowDown")
    await frames(3)
    await commands.realKey("press", "Space")
    await frames(2)
    expect(items(), "shown at once").toEqual(["a", "c", "d", "b"])
    expect(saves).toBe(1)
    await wait(600)
    expect(items(), "still shown while the save is in flight").toEqual(["a", "c", "d", "b"])
    const moved = item("b").getBoundingClientRect().top
    expect(moved - slotOfB, "two slots down").toBeCloseTo(96, 0)
    // The save fails: the order goes back, and b glides from where it was drawn to its old slot.
    const tops: Array<number> = []
    const until = performance.now() + 1100
    while (performance.now() < until) {
      await raf()
      tops.push(item("b").getBoundingClientRect().top)
    }
    expect(items(), "put back").toEqual(["a", "b", "c", "d"])
    expect(saved(), "nothing saved").toEqual(["a", "b", "c", "d"])
    expect(tops.some((top) => top > slotOfB + 5 && top < moved - 5), "glided between the slots").toBe(true)
    expect(tops.at(-1), "back in its slot").toBeCloseTo(slotOfB, 0)
    // A save that succeeds keeps the order.
    ok = true
    item("c").focus()
    await commands.realKey("press", "Space")
    await commands.realKey("press", "ArrowDown")
    await frames(3)
    await commands.realKey("press", "Space")
    await wait(SAVE_MS + 150)
    await frames(2)
    expect(items()).toEqual(["a", "b", "d", "c"])
    expect(saved(), "saved").toEqual(["a", "b", "d", "c"])
  })

  it("RE6: the group's disposal rejects a waiting next with an AbortError, and ends an each", async () => {
    let list!: ReorderGroup<string>
    const Scene = () => {
      const [order, setOrder] = createSignal<ReadonlyArray<string>>(["a", "b"])
      list = reorderGroup({ values: order, onReorder: setOrder })
      return (
        <ul {...list}>
          <For each={order()}>
            {(value) => {
              const row = reorderItem(list, { value })
              return <li {...row}>{value}</li>
            }}
          </For>
        </ul>
      )
    }
    const { unmount } = mount(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await frames(2)
    const waiting = list.next("reorderEnd")
    let ended = false
    const loop = (async () => {
      for await (const _ of list.each("reorderEnd")) void _
      ended = true
    })()
    unmount()
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" })
    await loop
    expect(ended).toBe(true)
  })
})
