// A ward an optimistic write makes inside an action (#337, ADR-0045 *Amendment (#337)*): its target
// memo, made in the action's transaction, has nothing committed to compare with at first. In a real
// browser. Solid logs a memo's thrown error with `console.error`, not as a diagnostic: the setup's
// gate fails a test on it since #337.
//
// - OA1: a `<For>` row an optimistic store write adds animates to its target.
//   On `main` its target memo threw (`a.dragging` of `undefined`), and the row stayed at `initial`.
//   Nothing is logged, in any of them: the setup's gate.
// - OA2: the store refuses the write: the overlay is dropped, and the row, a `layout` element under
//   `<AnimatePresence mode="popLayout">`, exits and goes.
// - OA3: the store keeps it: the row the refresh returns is the same element, at its target.
import { DomLive } from "@wardic/dom"
import { AnimatePresence, wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import { action, createOptimisticStore, For, Loading, refresh, Show } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

interface Row {
  readonly id: string
}

const TWEEN = { type: "tween", duration: 0.15 } as const

const later = <A,>(ms: number, value: A): Promise<A> => new Promise((resolve) => setTimeout(() => resolve(value), ms))
const opacityOf = (el: Element | null): number => Number(getComputedStyle(el as Element).opacity)

/**
 * A list on an optimistic store over a "server" list, and an action that adds a row optimistically,
 * waits, then keeps it on the server or not, and refreshes.
 */
const mountRows = (keep: boolean, presence: boolean) => {
  let server: ReadonlyArray<Row> = []
  const [rows, setRows] = createOptimisticStore<Array<Row>>(async () => later(10, [...server]), [])
  const add = action(function* (id: string) {
    setRows((draft) => [...draft, { id }])
    yield later(80, null)
    if (keep) server = [...server, { id }]
    refresh(rows)
  })
  const row = (one: Row) => <wardic.li data-row={one.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={TWEEN} />
  const { host } = mount(() => (
    <WardicProvider env={DomLive}>
      <Loading>
        <ul style={{ position: "relative" }}>
          <Show when={presence} fallback={<For each={rows}>{row}</For>}>
            <AnimatePresence mode="popLayout">
              <For each={rows}>{row}</For>
            </AnimatePresence>
          </Show>
        </ul>
      </Loading>
    </WardicProvider>
  ))
  return { host, add }
}

describe("a ward an optimistic write makes inside an action (#337)", () => {
  it("OA1: animates to its target", async () => {
    const { host, add } = mountRows(true, false)
    await later(50, null)
    void add("a")
    await raf()
    const row = host.querySelector("[data-row]")
    expect(row, "added at once").not.toBeNull()
    await until(() => opacityOf(row) >= 0.99, 1000)
    expect(opacityOf(row), "faded in").toBeGreaterThanOrEqual(0.99)
  })

  it("OA2: refused, the overlay drops, and the row exits and goes", async () => {
    const { host, add } = mountRows(false, true)
    await later(50, null)
    void add("a")
    await raf()
    const row = host.querySelector("[data-row]")
    expect(row, "added at once").not.toBeNull()
    await until(() => !row!.isConnected, 2000)
    expect(row!.isConnected, "gone once the store refused it").toBe(false)
  })

  it("OA3: kept, the refreshed row is the same element, at its target", async () => {
    const { host, add } = mountRows(true, true)
    await later(50, null)
    void add("a")
    await raf()
    const row = host.querySelector("[data-row]")
    await later(400, null)
    expect(host.querySelector("[data-row]"), "the same element").toBe(row)
    expect(opacityOf(row)).toBeGreaterThanOrEqual(0.99)
  })
})
