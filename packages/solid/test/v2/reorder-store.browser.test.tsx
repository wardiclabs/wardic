// Reorder groups with `values` from a Solid 2 store (#721): `Reorder.Group` and `Reorder.BatchGroup`, each
// store form an app sets from `onReorder` (a returned array, which a root store takes in place, a splice, and
// a draft given a new array), with a real mouse and real keys. Solid 2's diagnostics gate holds every test: no
// strict read of the store outside its tracking.
//
// - RS1: a drag five places down moves the item five places, on both groups, whatever the store form: each
//   step's new order is measured (or placed) before the next crossover.
// - RS2: the keyboard reorder: Space lifts, two arrows step it two places, Space drops it, focus kept.
// - RS3: the app's own order while an item is lifted drops it at its new place (ADR-0037 decision 9): an
//   arrow after moves nothing.
// - RS4: the app's own reorder of its store animates: an item is between its old place and its new one a few
//   frames on, then lands.
// - RS5: an app whose store keeps the very array `onReorder` handed it, then swaps two other items of it in
//   place while an item is lifted: dropped, as any change of the app's. The group's own order is a copy of
//   what it hands on, so the app's change of that array is the app's.
//
// The "assign" form, a draft given a new array of the same items, is one Solid 2 itself advises an app against
// (IMMUTABLE_UPDATE_IN_STORE: splice in place instead). An app may still write it, so it's tested, last, with
// that code allowed from its turn on: it's the app's, not the group's.
import type { JSX } from "@solidjs/web"
import { DomLive } from "@wardic/dom"
import { Reorder, WardicProvider } from "@wardic/solid/unstable/v2"
import * as Match from "effect/Match"
import { createStore, flush, For, untrack } from "solid-js"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { commands, page } from "vitest/browser"
import "../browser-commands.ts"
import { allowDiagnostic } from "./diagnostics.ts"
import { mount } from "./mount.tsx"
import { add, centreOf, glide, mouse, resetScene, wait } from "./reorder-scene.tsx"

/** The list a test mounted, unmounted before the next. */
let unmountList: () => void = () => {}
const reset = async (): Promise<void> => {
  unmountList()
  await resetScene()
}
afterEach(reset)

let viewport = { width: 0, height: 0 }
beforeAll(async () => {
  viewport = { width: window.innerWidth, height: window.innerHeight }
  await page.viewport(1000, 900)
  await wait(50)
})
afterAll(async () => {
  await page.viewport(viewport.width, viewport.height)
})

const VALUES: ReadonlyArray<string> = ["a", "b", "c", "d", "e", "f", "g", "h"]
const REVERSED: ReadonlyArray<string> = [...VALUES].reverse()
const AT: JSX.CSSProperties = { position: "absolute", left: "40px", top: "40px", margin: "0", padding: "0", "list-style": "none" }
const FAST = { type: "spring", stiffness: 500, damping: 40 } as const
const LOOK: JSX.CSSProperties = { background: "teal", "box-sizing": "border-box" }

type Kind = "group" | "batch"
/** How the app keeps its order: a root store given a returned array (taken in place), a splice, or a draft given a new array. */
type Form = "returned" | "splice" | "assign"
const KINDS: ReadonlyArray<Kind> = ["group", "batch"]
/** "assign" last: the diagnostic it makes is allowed from its turn on. */
const FORMS: ReadonlyArray<Form> = ["returned", "splice", "assign"]

interface Order {
  readonly values: () => ReadonlyArray<string>
  /** What `onReorder` does: the app sets its store. */
  readonly set: (next: ReadonlyArray<string>) => void
}

const orderOf: (form: Form) => Order = Match.type<Form>().pipe(
  Match.when("returned", () => {
    const [rows, setRows] = createStore<Array<string>>([...VALUES])
    return { values: () => rows, set: (next: ReadonlyArray<string>) => setRows(() => [...next]) }
  }),
  Match.when("splice", () => {
    const [state, setState] = createStore({ rows: [...VALUES] })
    return {
      values: () => state.rows,
      set: (next: ReadonlyArray<string>) =>
        setState((draft) => {
          draft.rows.splice(0, draft.rows.length, ...next)
        }),
    }
  }),
  Match.when("assign", () => {
    allowAssign()
    const [state, setState] = createStore({ rows: [...VALUES] })
    return {
      values: () => state.rows,
      set: (next: ReadonlyArray<string>) =>
        setState((draft) => {
          draft.rows = [...next]
        }),
    }
  }),
  Match.exhaustive,
)

/** The app's own "assign" form, under test: Solid 2's advice to it, not a diagnostic of the group's. */
function allowAssign(): void {
  allowDiagnostic("IMMUTABLE_UPDATE_IN_STORE", "the assign form under test replaces the app's array with the same items, reordered")
}

/** A column of eight 200x50 items, 10 px apart, a `kind` group over `order`. */
const mountList = (kind: Kind, order: Order): void => {
  const list = (): JSX.Element =>
    Match.value(kind).pipe(
      Match.when("group", () => (
        <Reorder.Group values={order.values() as Array<string>} onReorder={order.set} axis="y" style={{ ...AT, display: "grid", gap: "10px" }}>
          <For each={order.values()}>
            {(value) => (
              <Reorder.Item value={value} data-value={value} transition={FAST} style={{ ...LOOK, width: "200px", height: "50px" }}>
                {value}
              </Reorder.Item>
            )}
          </For>
        </Reorder.Group>
      )),
      Match.when("batch", () => (
        <Reorder.BatchGroup values={order.values()} onReorder={order.set} itemSize={{ width: 200, height: 50 }} gap={10} transition={FAST} style={AT}>
          <For each={order.values()}>
            {(value) => (
              <Reorder.BatchItem value={value} data-value={value} style={LOOK}>
                {value}
              </Reorder.BatchItem>
            )}
          </For>
        </Reorder.BatchGroup>
      )),
      Match.exhaustive,
    )
  unmountList = mount(() => <WardicProvider env={DomLive}>{list()}</WardicProvider>).unmount
}

/** `run` over each store form's list on both groups, each mounted, settled and taken down in turn. */
const eachList = async (run: (order: Order, name: string) => Promise<void>): Promise<void> => {
  for (const form of FORMS) {
    for (const kind of KINDS) {
      const order = orderOf(form)
      mountList(kind, order)
      await wait(150)
      await run(order, `${kind}, ${form}`)
      await reset()
    }
  }
}

const item = (value: string): HTMLElement => document.querySelector<HTMLElement>(`[data-value="${value}"]`)!
const topOf = (value: string): number => Math.round(item(value).getBoundingClientRect().top)
const domOrder = (): string => [...document.querySelectorAll("[data-value]")].map((el) => el.getAttribute("data-value")).join("")
const press = async (key: string): Promise<void> => {
  await commands.realKey("press", key)
  await wait(60)
}

describe("Reorder groups with values from a Solid 2 store (#721)", () => {
  it("RS1: a drag five places moves the item five places, on both groups, in every store form", async () => {
    await eachList(async (order, name) => {
      const from = centreOf(item("b"))
      await mouse.down(from)
      await glide(from, add(from, 0, 5 * 60 + 10), 30, 20)
      await wait(100)
      await mouse.up(add(from, 0, 5 * 60 + 10))
      await wait(700)
      expect(order.values().join(""), `${name}: five places`).toBe("acdefgbh")
      expect(domOrder(), `${name}: the DOM follows`).toBe("acdefgbh")
      expect(topOf("b"), `${name}: landed at its place`).toBe(40 + 6 * 60)
    })
  }, 120_000)

  it("RS2: the keyboard reorder: a lift, two steps and a drop, on both groups, in every store form", async () => {
    await eachList(async (order, name) => {
      item("b").focus()
      for (const key of ["Space", "ArrowDown", "ArrowDown", "Space"]) await press(key)
      await wait(500)
      expect(order.values().join(""), `${name}: two places`).toBe("acdbefgh")
      expect(domOrder(), `${name}: the DOM follows`).toBe("acdbefgh")
      expect(document.activeElement, `${name}: focus kept`).toBe(item("b"))
      expect(topOf("b"), `${name}: at its place`).toBe(40 + 3 * 60)
    })
  }, 120_000)

  it("RS3: the app's own order while an item is lifted drops it at its new place", async () => {
    await eachList(async (order, name) => {
      item("b").focus()
      await press("Space")
      order.set(REVERSED)
      flush()
      await wait(500)
      await press("ArrowDown")
      await wait(500)
      expect(order.values().join(""), `${name}: dropped, so the arrow moved nothing`).toBe("hgfedcba")
      expect(topOf("b"), `${name}: at its new place`).toBe(40 + 6 * 60)
    })
  }, 120_000)

  it("RS4: the app's own reorder of its store animates, on both groups, in every store form", async () => {
    await eachList(async (order, name) => {
      order.set(REVERSED)
      flush()
      await wait(80)
      const mid = topOf("a")
      expect(mid, `${name}: a few frames on, a is on its way`).toBeGreaterThan(40)
      expect(mid, `${name}: not yet there`).toBeLessThan(40 + 7 * 60)
      await wait(800)
      expect(topOf("a"), `${name}: landed`).toBe(40 + 7 * 60)
    })
  }, 120_000)

  it("RS5: a store keeping the array onReorder handed it, two other items swapped in it while an item is lifted: dropped", async () => {
    allowAssign()
    for (const kind of KINDS) {
      const [state, setState] = createStore({ rows: [...VALUES] })
      // The group's own array, kept as the store's: no copy.
      mountList(kind, {
        values: () => state.rows,
        set: (next) =>
          setState((draft) => {
            draft.rows = next as Array<string>
          }),
      })
      await wait(150)
      item("b").focus()
      await press("Space")
      await press("ArrowDown")
      // b lifted and a step on (acbdefgh): the app swaps a and h in place, b's node not moved.
      setState((draft) => {
        draft.rows.splice(0, draft.rows.length, "h", "c", "b", "d", "e", "f", "g", "a")
      })
      flush()
      await wait(500)
      expect(document.activeElement, `${kind}: b still has focus`).toBe(item("b"))
      await press("ArrowDown")
      await wait(500)
      expect(untrack(() => state.rows.join("")), `${kind}: dropped, so the arrow moved nothing`).toBe("hcbdefga")
      await reset()
    }
  }, 60_000)
})
