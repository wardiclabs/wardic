// The **Keyboard reorder** on Solid 2 (#209 PR 3b, ADR-0037), with real keys: the Solid 1 binding's
// keyboard cases, on `Reorder.Item` and on `reorderItem`, and where a kept item takes the app's own
// `tabindex` and `aria-describedby` (#209 PR 3b's R2: its config).
//
// - RK1: Space lifts, the arrows move one place per press, Space drops; focus stays, and the item
//   is raised and lifted (its `whileDrag`).
// - RK2: Escape cancels, restoring the order from the lift; Enter lifts and drops as Space does.
// - RK3: focus leaving the item drops it where it is.
// - RK4: `keyboard: false`: no tab stop, no instructions, keys do nothing; `move()` still announces.
// - RK5: the app's own ids come before the instructions', its `tabindex` wins, and a group's own
//   wording: through `Reorder.Item`'s props and through `reorderItem`'s config.
import { DomLive } from "@wardic/dom"
import * as DomAnnouncer from "@wardic/dom/DomAnnouncer"
import * as ReorderController from "@wardic/dom/ReorderController"
import type * as CoreReorder from "@wardic/core/Reorder"
import { Reorder, reorderGroup, reorderItem, WardicProvider } from "@wardic/solid/unstable/v2"
import * as Bool from "effect/Boolean"
import * as UndefinedOr from "effect/UndefinedOr"
import { createSignal, For } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { commands } from "vitest/browser"
import "../browser-commands.ts"
import { raf } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

afterEach(async () => {
  await commands.realMouse("move", 5, 5)
})

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

/** The page's live region's text: the last announcement. */
const announced = (): string => document.querySelector(`[${DomAnnouncer.ATTRIBUTE}]`)?.textContent ?? ""

interface MountOptions {
  readonly keyboard?: boolean
  readonly announcements?: Partial<CoreReorder.Announcements<string>>
  readonly instructions?: string
  /** Each item's own `tabindex` and `aria-describedby`. */
  readonly itemProps?: (value: string) => { readonly tabindex?: number; readonly "aria-describedby"?: string }
  /** Through `reorderGroup` / `reorderItem`, the item's own props in its config. */
  readonly factories?: boolean
}

const optional = <K extends string, A>(key: K, value: A | undefined): Partial<Record<K, A>> =>
  UndefinedOr.match(value, { onUndefined: () => ({}), onDefined: (v) => ({ [key]: v }) as Record<K, A> })

const GROUP_STYLE = { position: "relative", "list-style": "none", margin: "0", padding: "0", width: "200px" } as const
const ITEM_STYLE = { height: "40px", "margin-bottom": "8px", background: "#9cf" } as const

/** A column of items a to e, keyed with `<For>`; each scales to 1.05 while dragged or lifted. */
const mountList = async (options: MountOptions = {}) => {
  const [values, setValues] = createSignal<ReadonlyArray<string>>(["a", "b", "c", "d", "e"])
  let move: (value: string, toIndex: number) => void = () => {}
  const settings = {
    ...optional("keyboard", options.keyboard),
    ...optional("announcements", options.announcements),
    ...optional("instructions", options.instructions),
  }
  const Components = () => (
    <Reorder.Group values={values()} onReorder={setValues} {...settings} style={GROUP_STYLE}>
      <For each={values()}>
        {(value) => (
          <Reorder.Item value={value} data-value={value} whileDrag={{ scale: 1.05 }} {...(options.itemProps?.(value) ?? {})} style={ITEM_STYLE}>
            {value}
          </Reorder.Item>
        )}
      </For>
    </Reorder.Group>
  )
  const Factories = () => {
    const list = reorderGroup(() => ({ values: values(), onReorder: setValues, ...settings, style: GROUP_STYLE }))
    move = list.move
    return (
      <ul {...list}>
        <For each={values()}>
          {(value) => {
            const row = reorderItem(list, { value, whileDrag: { scale: 1.05 }, style: ITEM_STYLE, ...(options.itemProps?.(value) ?? {}) })
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
      <div style={{ padding: "8px" }}>{Bool.match(options.factories === true, { onTrue: () => <Factories />, onFalse: () => <Components /> })}</div>
    </WardicProvider>
  ))
  await frames(4)
  const item = (value: string): HTMLElement => host.querySelector<HTMLElement>(`[data-value="${value}"]`)!
  return { values, item, move: (value: string, toIndex: number) => move(value, toIndex) }
}

describe.each([
  { mode: "Reorder.Item", factories: false },
  { mode: "reorderItem", factories: true },
])("the keyboard reorder on Solid 2, through $mode", ({ factories }) => {
  it("RK1: Space lifts, the arrows move one place per press, Space drops; focus stays, raised and lifted", async () => {
    const m = await mountList({ factories })
    const b = m.item("b")
    expect(document.getElementById(b.getAttribute("aria-describedby") ?? "")?.textContent, "the default instructions").toBe(ReorderController.DEFAULT_INSTRUCTIONS)
    b.focus()
    await commands.realKey("press", "Space")
    await frames(2)
    expect(announced()).toBe("Picked up b, position 2 of 5.")
    expect(getComputedStyle(b).zIndex, "raised while lifted").toBe("2")
    await commands.realKey("press", "ArrowDown")
    await frames(3)
    expect(m.values()).toEqual(["a", "c", "b", "d", "e"])
    expect(announced()).toBe("b, position 3 of 5.")
    await commands.realKey("press", "ArrowDown")
    await frames(3)
    expect(m.values()).toEqual(["a", "c", "d", "b", "e"])
    expect(document.activeElement, "focus stays on the item").toBe(b)
    await frames(20)
    expect(new DOMMatrix(getComputedStyle(b).transform).a, "whileDrag's lift").toBeCloseTo(1.05, 2)
    await commands.realKey("press", "Space")
    await frames(2)
    expect(announced()).toBe("Dropped b at position 4 of 5.")
    await frames(60)
    expect(new DOMMatrix(getComputedStyle(b).transform).a, "back from the lift").toBeCloseTo(1, 3)
    expect(getComputedStyle(b).zIndex, "the raise drops once it lands").toBe("auto")
  })

  it("RK2: Escape cancels, restoring the order from the lift; Enter lifts and drops as Space does", async () => {
    const m = await mountList({ factories })
    const b = m.item("b")
    b.focus()
    await commands.realKey("press", "Space")
    for (let i = 0; i < 2; i++) {
      await commands.realKey("press", "ArrowDown")
      await frames(3)
    }
    expect(m.values()).toEqual(["a", "c", "d", "b", "e"])
    await commands.realKey("press", "Escape")
    await frames(2)
    expect(m.values()).toEqual(["a", "b", "c", "d", "e"])
    expect(announced()).toBe("Cancelled. b is back at position 2 of 5.")
    expect(document.activeElement).toBe(b)
    await commands.realKey("press", "Enter")
    await commands.realKey("press", "ArrowUp")
    await frames(3)
    await commands.realKey("press", "Enter")
    await frames(2)
    expect(m.values()).toEqual(["b", "a", "c", "d", "e"])
    expect(announced()).toBe("Dropped b at position 1 of 5.")
  })

  it("RK3: focus leaving the item drops it where it is", async () => {
    const m = await mountList({ factories })
    const b = m.item("b")
    b.focus()
    await commands.realKey("press", "Space")
    await commands.realKey("press", "ArrowDown")
    await frames(3)
    await commands.realKey("press", "Tab")
    await frames(3)
    expect(announced()).toBe("Dropped b at position 3 of 5.")
    expect(m.values()).toEqual(["a", "c", "b", "d", "e"])
  })

  it("RK4: keyboard false: no tab stop, no instructions, keys do nothing", async () => {
    const m = await mountList({ factories, keyboard: false })
    const b = m.item("b")
    expect(b.hasAttribute("tabindex")).toBe(false)
    expect(b.hasAttribute("aria-describedby")).toBe(false)
    b.tabIndex = 0
    b.focus()
    await commands.realKey("press", "Space")
    await commands.realKey("press", "ArrowDown")
    await frames(3)
    expect(m.values()).toEqual(["a", "b", "c", "d", "e"])
  })

  it("RK5: the app's ids before the instructions', its tabindex wins, and a group's own wording", async () => {
    const m = await mountList({
      factories,
      itemProps: (value) => ({ ...Bool.match(value === "a", { onTrue: () => ({ tabindex: -1 }), onFalse: () => ({}) }), "aria-describedby": `hint-${value}` }),
      instructions: "Space to grab.",
      announcements: { lift: ({ label, position }) => `Grabbed ${label} (${position}).` },
    })
    expect(m.item("a").getAttribute("tabindex")).toBe("-1")
    const b = m.item("b")
    expect(b.getAttribute("tabindex")).toBe("0")
    const [own, instructions] = (b.getAttribute("aria-describedby") ?? "").split(" ")
    expect(own).toBe("hint-b")
    expect(document.getElementById(instructions!)?.textContent).toBe("Space to grab.")
    b.focus()
    await commands.realKey("press", "Space")
    await frames(2)
    expect(announced()).toBe("Grabbed b (2).")
    await commands.realKey("press", "Space")
  })
})

it("RK6: keyboard false: list.move still announces", async () => {
  const m = await mountList({ factories: true, keyboard: false })
  m.move("c", 0)
  await frames(2)
  expect(m.values()).toEqual(["c", "a", "b", "d", "e"])
  expect(announced()).toBe("Moved c to position 1 of 5.")
})
