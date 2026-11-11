// Reorder groups with `values` from a Solid 1 store (#721): `Reorder.Group` and `Reorder.BatchGroup`, each
// store form an app sets from `onReorder` (a new array at a path, a root store merged in place, and
// `reconcile`), with a real mouse and real keys.
//
// - RS1: a drag five places down moves the item five places, on both groups, whatever the store form: each
//   step's new order is measured (or placed) before the next crossover.
// - RS2: the keyboard reorder: Space lifts, two arrows step it two places, Space drops it, focus kept.
// - RS3: the app's own order while an item is lifted drops it at its new place (ADR-0037 decision 9): an
//   arrow after moves nothing.
// - RS4: the app's own reorder of its store animates: an item is between its old place and its new one a few
//   frames on, then lands.
// - RS5: an app whose store keeps the very array `onReorder` handed it, then swaps two other items of it in
//   place while an item is lifted (its node not moved, so not blurred): dropped, as any change of the app's.
//   The group's own order is a copy of what it hands on, so the app's change of that array is the app's.
import { render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { Reorder, WardicProvider } from "@wardic/solid"
import * as Match from "effect/Match"
import { For, type JSX } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { commands, page } from "vitest/browser"
import "./browser-commands.ts"
import { add, centreOf, glide, mouse, resetScene, wait } from "./reorder-harness.tsx"

afterEach(resetScene)

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
/** How the app keeps its order: a store whose path it sets to a new array, a root store it merges in place, or `reconcile`. */
type Form = "path" | "root" | "reconcile"
const KINDS: ReadonlyArray<Kind> = ["group", "batch"]
const FORMS: ReadonlyArray<Form> = ["path", "root", "reconcile"]

interface Order {
  readonly values: () => ReadonlyArray<string>
  /** What `onReorder` does: the app sets its store. */
  readonly set: (next: ReadonlyArray<string>) => void
}

const orderOf: (form: Form) => Order = Match.type<Form>().pipe(
  Match.when("path", () => {
    const [state, setState] = createStore({ rows: [...VALUES] })
    return { values: () => state.rows, set: (next: ReadonlyArray<string>) => setState("rows", [...next]) }
  }),
  Match.when("root", () => {
    const [rows, setRows] = createStore<Array<string>>([...VALUES])
    return { values: () => rows, set: (next: ReadonlyArray<string>) => setRows([...next]) }
  }),
  Match.when("reconcile", () => {
    const [state, setState] = createStore({ rows: [...VALUES] })
    return { values: () => state.rows, set: (next: ReadonlyArray<string>) => setState("rows", reconcile([...next])) }
  }),
  Match.exhaustive,
)

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
  render(() => <WardicProvider env={DomLive}>{list()}</WardicProvider>)
}

/** `run` over each store form's list on both groups, each mounted, settled and taken down in turn. */
const eachList = async (run: (order: Order, name: string) => Promise<void>): Promise<void> => {
  for (const form of FORMS) {
    for (const kind of KINDS) {
      const order = orderOf(form)
      mountList(kind, order)
      await wait(150)
      await run(order, `${kind}, ${form}`)
      await resetScene()
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

describe("Reorder groups with values from a Solid 1 store (#721)", () => {
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
      await wait(80)
      const mid = topOf("a")
      expect(mid, `${name}: a few frames on, a is on its way`).toBeGreaterThan(40)
      expect(mid, `${name}: not yet there`).toBeLessThan(40 + 7 * 60)
      await wait(800)
      expect(topOf("a"), `${name}: landed`).toBe(40 + 7 * 60)
    })
  }, 120_000)

  it("RS5: a store keeping the array onReorder handed it, two other items swapped in it while an item is lifted: dropped", async () => {
    for (const kind of KINDS) {
      const [state, setState] = createStore({ rows: [...VALUES] })
      // The group's own array, kept as the store's: no copy.
      mountList(kind, { values: () => state.rows, set: (next) => setState("rows", next as Array<string>) })
      await wait(150)
      item("b").focus()
      await press("Space")
      await press("ArrowDown")
      // b lifted and a step on (acbdefgh): the app swaps a and h in place, b's node not moved.
      setState("rows", reconcile(["h", "c", "b", "d", "e", "f", "g", "a"]))
      await wait(500)
      expect(document.activeElement, `${kind}: b still has focus`).toBe(item("b"))
      await press("ArrowDown")
      await wait(500)
      expect(state.rows.join(""), `${kind}: dropped, so the arrow moved nothing`).toBe("hcbdefga")
      await resetScene()
    }
  }, 60_000)
})
