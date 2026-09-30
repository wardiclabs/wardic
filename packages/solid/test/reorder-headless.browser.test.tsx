// The headless `<Reorder>` API (ADR-0020, D8): `createReorderGroup` and
// `createReorderItem` spread onto any elements, and the `use:reorderItem` directive (a
// commit sink, client only). `Reorder.Group` / `Reorder.Item` are built on these, so
// a list outside JSX components (a web component, a plain element) reorders the same
// way. Real Playwright mouse input; the scene is reorder-harness.tsx's y list.
//
// Motion's cases matched here: a virtualized list keeps its unmeasured values at their
// indexes (Reorder/__tests__/index.test.tsx:66-108 at
// 16c61222c4166bbef5ff6ab0051192faa79fa8c8). Motion reads the group's `direction` on
// every sample (Group.tsx:138-144); the group here reads it once per drag start.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { createReorderGroup, createReorderItem, type ReorderGroupWard, reorderItem, WardicProvider } from "@wardic/solid"
import { createSignal, For, type JSX } from "solid-js"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  add,
  centreOf,
  domOrder,
  glide,
  grabOffsetOf,
  groupCss,
  itemCss,
  mouse,
  offPointer,
  resetScene,
  sampleFrames,
  settle,
  VALUES,
  wait,
} from "./reorder-harness.tsx"

// `use:reorderItem` needs the import to stay (the directive compiles to a bare call).
void reorderItem

afterEach(resetScene)

const GROUP = groupCss({})
const ITEM = itemCss({})

interface Headless {
  readonly order: () => ReadonlyArray<string>
  readonly setOrder: (values: ReadonlyArray<string>) => void
  readonly reorders: ReadonlyArray<string>
  readonly group: () => ReorderGroupWard<string>
  readonly groupEl: () => HTMLElement
  readonly item: (value: string) => HTMLElement
}

interface HeadlessOptions {
  readonly n?: number
  /** Only these values get an element (a virtualized list). */
  readonly rendered?: (value: string) => boolean
  /** The items: `createReorderItem` spreads (default), the directive, or `.map` instead of `<For>`. */
  readonly items?: "spread" | "directive" | "map"
}

/** A plain `<ul>` with `createReorderGroup`'s spread, and `<li>`s wired by `createReorderItem` or `use:reorderItem`. */
const mountHeadless = async (o: HeadlessOptions = {}): Promise<Headless> => {
  const [order, setOrder] = createSignal<ReadonlyArray<string>>(VALUES.slice(0, o.n ?? 5))
  const reorders: Array<string> = []
  let groupWard: ReorderGroupWard<string> | undefined
  let groupEl: HTMLElement | undefined
  function Item(props: { readonly group: ReorderGroupWard<string>; readonly value: string }): JSX.Element {
    // eslint-disable-next-line solid/reactivity -- the value is static (read once at mount)
    const item = createReorderItem(props.group, { value: props.value })
    return (
      <li {...item({ style: ITEM })} data-value={props.value}>
        {props.value}
      </li>
    )
  }
  function List(): JSX.Element {
    const group = createReorderGroup(() => ({
      values: order(),
      onReorder: (values: Array<string>) => {
        reorders.push(values.join(""))
        setOrder(values)
      },
    }))
    groupWard = group
    const visible = (): ReadonlyArray<string> => (o.rendered !== undefined ? order().filter(o.rendered) : order())
    const item = (value: string): JSX.Element =>
      o.items === "directive" ? (
        <li use:reorderItem={{ group, value }} data-value={value} style={ITEM}>
          {value}
        </li>
      ) : (
        <Item group={group} value={value} />
      )
    return (
      <ul {...group({ ref: (el: HTMLElement) => (groupEl = el), style: GROUP })}>
        {o.items === "map" ? visible().map((value) => item(value)) : <For each={visible()}>{(value) => item(value)}</For>}
      </ul>
    )
  }
  render(() => (
    <WardicProvider env={DomLive}>
      <List />
    </WardicProvider>
  ))
  await settle()
  return {
    order,
    setOrder,
    reorders,
    group: () => groupWard!,
    groupEl: () => groupEl!,
    item: (value) => document.querySelector<HTMLElement>(`[data-value="${value}"]`)!,
  }
}

/** Drag `value` from its centre by (0, dy) in `steps` moves, hold, release, let it settle. */
const dragY = async (h: Headless, value: string, dy: number, steps: number): Promise<void> => {
  const g = centreOf(h.item(value))
  await mouse.down(g)
  await glide(g, add(g, 0, dy), steps)
  await wait(300)
  await mouse.up(add(g, 0, dy))
  await wait(900)
}

describe("the headless Reorder API", () => {
  it("RH1: createReorderGroup + createReorderItem on a plain ul / li reorder like Reorder.Group", async () => {
    const h = await mountHeadless()
    const b = h.item("b")
    const g = centreOf(b)
    const grabOffset = grabOffsetOf(b, g)
    await mouse.down(g)
    const to = add(g, 0, 46)
    await glide(g, to, 23)
    await wait(400)
    expect(h.reorders).toEqual(["acbde"])
    expect(domOrder(h.groupEl()).join("")).toBe("acbde")
    expect(offPointer(b, to, grabOffset)).toBeLessThan(1)
  })

  it("RH2: the accessor config tracks its values, and its fields are plain values", async () => {
    const h = await mountHeadless()
    h.setOrder([...h.order(), "f"])
    await settle()
    await dragY(h, "e", 46, 23)
    expect(h.reorders, "the group reads the new values").toEqual(["abcdfe"])
    // Type-level only: a field is a value, never an accessor (no MaybeAccessor).
    const typeOnly = (): void => {
      // @ts-expect-error axis is a ReorderAxis, not an accessor
      createReorderGroup({ values: ["a"], onReorder: () => {}, axis: () => "y" })
    }
    void typeOnly
  })

  it("RH3: group.move(value, toIndex) reorders through onReorder and the siblings fly; out of range clamps, unknown is ignored", async () => {
    const h = await mountHeadless()
    const b = h.item("b")
    const bSlot = b.getBoundingClientRect().top - 60
    const sampling = sampleFrames(() => b.getBoundingClientRect().top)
    const movedAt = performance.now()
    h.group().move("a", 2)
    await wait(800)
    const frames = sampling.stop().filter((f) => f.frameAt > movedAt)
    expect(h.reorders).toEqual(["bcade"])
    expect(Math.abs(frames[0]!.v - bSlot), "b flies to its slot (no jump)").toBeGreaterThan(1)
    expect(Math.abs(frames.at(-1)!.v - bSlot), "and ends on it").toBeLessThanOrEqual(0.5)
    h.group().move("a", 99)
    h.group().move("zz", 0)
    h.group().move("b", 0)
    expect(h.reorders).toEqual(["bcade", "bcdea"])
  })

  it("RH4: use:reorderItem on a plain li reorders (a commit sink)", async () => {
    const h = await mountHeadless({ items: "directive" })
    await dragY(h, "b", 46, 23)
    expect(h.reorders).toEqual(["acbde"])
    expect(domOrder(h.groupEl()).join("")).toBe("acbde")
  })

  it("RH5: a reorder the app makes itself animates the items", async () => {
    const h = await mountHeadless()
    const e = h.item("e")
    const aSlot = h.item("a").getBoundingClientRect().top
    const sampling = sampleFrames(() => e.getBoundingClientRect().top)
    const at = performance.now()
    h.setOrder(["e", "b", "c", "d", "a"])
    await wait(900)
    const frames = sampling.stop().filter((f) => f.frameAt > at)
    expect(Math.abs(frames[0]!.v - aSlot), "e flies to the first slot (no jump)").toBeGreaterThan(1)
    expect(Math.abs(frames.at(-1)!.v - aSlot), "and ends on it").toBeLessThanOrEqual(0.5)
  })

  it("RH6: items rendered with .map log one warning per group when they remount; <For> logs none", async () => {
    const lines: Array<string> = []
    const methods = ["log", "info", "warn", "error", "debug", "group", "groupCollapsed"] as const
    const spies = methods.map((m) =>
      vi.spyOn(console, m).mockImplementation((...args: Array<unknown>) => {
        lines.push(args.map(String).join(" "))
      }),
    )
    try {
      const mapped = await mountHeadless({ items: "map" })
      mapped.setOrder(["b", "a", "c", "d", "e"])
      await settle()
      mapped.setOrder(["c", "b", "a", "d", "e"])
      await settle()
      expect(lines.filter((l) => l.includes("<For>")), "one warning, naming <For>").toHaveLength(1)
      cleanup()
      lines.length = 0
      const keyed = await mountHeadless()
      keyed.setOrder(["b", "a", "c", "d", "e"])
      await settle()
      expect(lines.filter((l) => l.includes("<For>"))).toHaveLength(0)
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })

  it("RH7: a value with no element (a virtualized list) keeps its index across a reorder of the others", async () => {
    const h = await mountHeadless({ rendered: (v) => v !== "a" && v !== "e" })
    await dragY(h, "b", 46, 23)
    expect(h.reorders).toEqual(["acbde"])
  })

  it("RH8: createReorderItem returns a Ward: callable with the user's ref and style, and it has .Provider", async () => {
    let userEl: HTMLElement | undefined
    let ward: ReturnType<typeof createReorderItem> | undefined
    function Probe(props: { readonly group: ReorderGroupWard<string> }): JSX.Element {
      // eslint-disable-next-line solid/reactivity
      ward = createReorderItem(props.group, { value: "a" })
      return <li {...ward({ ref: (el: HTMLElement) => (userEl = el), style: { ...ITEM, color: "rgb(1, 2, 3)" } })} data-value="a" />
    }
    function List(): JSX.Element {
      const group = createReorderGroup({ values: ["a"], onReorder: () => {} })
      return (
        <ul {...group({ style: GROUP })}>
          <Probe group={group} />
        </ul>
      )
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <List />
      </WardicProvider>
    ))
    await settle()
    expect(userEl).toBeInstanceOf(HTMLLIElement)
    expect(userEl!.style.color).toBe("rgb(1, 2, 3)")
    expect(typeof ward!.Provider).toBe("function")
  })

  it("RH9: the group reads its container's direction once per drag start, not per sample", async () => {
    const h = await mountHeadless()
    const group = h.groupEl()
    const spy = vi.spyOn(window, "getComputedStyle")
    const readsDuring = async (steps: number): Promise<number> => {
      const g = centreOf(h.item("b"))
      const before = spy.mock.calls.filter(([el]) => el === group).length
      await mouse.down(g)
      await glide(g, add(g, 0, 12), steps)
      await mouse.up(add(g, 0, 12))
      await wait(600)
      return spy.mock.calls.filter(([el]) => el === group).length - before
    }
    try {
      const short = await readsDuring(5)
      const long = await readsDuring(20)
      expect(short, "read at the drag start").toBeGreaterThanOrEqual(1)
      expect(long, "20 samples read it no more than 5 do").toBe(short)
    } finally {
      spy.mockRestore()
    }
  })
})
