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
// - RE5: the README's save pattern: an optimistic store from the server, a writable memo of it the
//   drag writes, a memo over `list.each("reorderEnd")` and an effect that starts each save (an
//   action). A failed save drops the optimistic write: the order goes back, the item glides back to
//   its slot, and the failure shows from state, with no unhandled rejection.
// - RE6: the group's disposal rejects a waiting `next` with an `AbortError`, and ends an `each`.
import * as ReorderController from "@wardic/dom/ReorderController"
import { DomLive } from "@wardic/dom"
import { type ReorderGroup, reorderGroup, reorderItem, WardicProvider } from "@wardic/solid/unstable/v2"
import { action, createEffect, createMemo, createOptimisticStore, createSignal, For, Loading, refresh, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { commands } from "vitest/browser"
import "../browser-commands.ts"
import { raf } from "../browser-helpers.ts"
import { allowDiagnostic } from "./diagnostics.ts"
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

/** How long the fake server takes to save: past the drop's own glide (0.45 s), so the item has landed before a failure. */
const SAVE_MS = 1000

type Task = { readonly id: string; readonly title: string }

const ITEM = { height: "40px", "margin-bottom": "8px", background: "#9cf" } as const

describe("reorderEnd's save pattern on Solid 2 (#257 item 3)", () => {
  it("RE5: an optimistic save at each reorderEnd; a failed one puts the order back, gliding, and shows its error", async () => {
    allowDiagnostic("OPTIMISTIC_REVERTED", "a failed save puts the optimistic order back")
    // A fake server: its order, and a save that fails while `fail` is set.
    let server: Array<Task> = ["a", "b", "c", "d"].map((id) => ({ id, title: id.toUpperCase() }))
    let fail = true
    const api = {
      listTasks: (): Promise<Array<Task>> => new Promise((resolve) => setTimeout(() => resolve(server.map((task) => ({ ...task }))), 30)),
      saveOrder: (ids: Array<string>): Promise<void> =>
        new Promise((resolve, reject) =>
          setTimeout(() => {
            if (fail) return reject(new Error("offline"))
            server = ids.map((id) => server.find((task) => task.id === id)!)
            resolve()
          }, SAVE_MS)),
    }
    const unhandled: Array<unknown> = []
    const onUnhandled = (event: PromiseRejectionEvent): void => {
      unhandled.push(event.reason)
      event.preventDefault()
    }
    window.addEventListener("unhandledrejection", onUnhandled)
    let order!: () => ReadonlyArray<Task>
    let saveError!: () => Error | undefined
    let saves = 0
    // The README's pattern, as it's written there.
    const TaskList = () => {
      const [tasks, setTasks] = createOptimisticStore<Array<Task>>(() => api.listTasks(), [])
      const [shown, setShown] = createSignal(() => [...tasks])
      const [error, setError] = createSignal<Error>()
      order = shown
      saveError = error
      const save = action(function* (ids: Array<string>) {
        saves++
        setTasks((list) => ids.map((id) => list.find((task) => task.id === id)!))
        yield api.saveOrder(ids)
        refresh(tasks)
      })
      const list = reorderGroup({ values: shown, onReorder: setShown, style: { position: "relative", "list-style": "none", margin: "0", padding: "0", width: "200px" } })
      const reordered = createMemo(() => list.each("reorderEnd"))
      createEffect(
        () => reordered().values.map((task) => task.id),
        (ids) => {
          setError(undefined)
          save(ids).catch(setError)
        },
      )
      return (
        <>
          <Show when={error()}>{(failed) => <p role="alert" data-error>{failed().message}</p>}</Show>
          <ul {...list}>
            <For each={shown()}>
              {(task) => {
                const row = reorderItem(list, { value: task, style: ITEM })
                return (
                  <li {...row} data-id={task.id}>
                    {task.title}
                  </li>
                )
              }}
            </For>
          </ul>
        </>
      )
    }
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <Loading fallback={<p>loading</p>}>
          <TaskList />
        </Loading>
      </WardicProvider>
    ))
    await wait(150)
    await frames(4)
    const ids = (): string => order().map((task) => task.id).join("")
    const item = (id: string): HTMLElement => host.querySelector<HTMLElement>(`[data-id="${id}"]`)!
    // Where an item is drawn in the list: the error, shown above the list, moves the list itself.
    const topOf = (id: string): number => item(id).getBoundingClientRect().top - host.querySelector("ul")!.getBoundingClientRect().top
    expect(ids(), "loaded from the server").toBe("abcd")
    const slotOfB = topOf("b")
    item("b").focus()
    await commands.realKey("press", "Space")
    await commands.realKey("press", "ArrowDown")
    await frames(3)
    await commands.realKey("press", "ArrowDown")
    await frames(3)
    await commands.realKey("press", "Space")
    await frames(2)
    expect(ids(), "shown at once").toBe("acdb")
    expect(saves).toBe(1)
    await wait(600)
    expect(ids(), "still shown while the save is in flight").toBe("acdb")
    const moved = topOf("b")
    expect(moved - slotOfB, "two slots down").toBeCloseTo(96, 0)
    // The save fails: Solid drops the optimistic write, the order goes back, b glides from where it
    // was drawn to its old slot, and the failure shows.
    const tops: Array<number> = []
    const until = performance.now() + 1100
    while (performance.now() < until) {
      await raf()
      tops.push(topOf("b"))
    }
    expect(ids(), "put back").toBe("abcd")
    expect(server.map((task) => task.id).join(""), "nothing saved").toBe("abcd")
    expect(tops.some((top) => top > slotOfB + 5 && top < moved - 5), "glided between the slots").toBe(true)
    expect(tops.at(-1), "back in its slot").toBeCloseTo(slotOfB, 0)
    expect(saveError()?.message, "the failure kept in state").toBe("offline")
    expect(host.querySelector("[data-error]")?.textContent, "and shown").toBe("offline")
    // A save that succeeds keeps the order, reconciled from the server, and clears the error.
    fail = false
    item("c").focus()
    await commands.realKey("press", "Space")
    await commands.realKey("press", "ArrowDown")
    await frames(3)
    await commands.realKey("press", "Space")
    await wait(SAVE_MS + 200)
    await frames(2)
    expect(ids()).toBe("abdc")
    expect(server.map((task) => task.id).join(""), "saved").toBe("abdc")
    expect(saves).toBe(2)
    expect(saveError(), "cleared").toBeUndefined()
    expect(host.querySelector("[data-error]")).toBeNull()
    window.removeEventListener("unhandledrejection", onUnhandled)
    expect(unhandled, "no unhandled rejection").toEqual([])
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
