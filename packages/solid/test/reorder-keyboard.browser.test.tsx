// The keyboard reorder (#43, ADR-0037), with real key presses (Playwright's keyboard through the
// `realKey` command) on a `<Reorder.Group>` of `<For>`-keyed `<Reorder.Item>`s on DomLive, whose
// Announcer speaks into the page's live region (read here as its text).
//
// - KB1: Space lifts, the arrows move one place per press, Space drops: `values`, the announcements,
//   focus kept on the item, the raise and `whileDrag` while lifted; the item reads the web's default
//   instructions (core's keys, and focus mode).
// - KB2: Escape cancels, restoring the order from the lift; Enter lifts and drops as Space does.
// - KB3: the keys it uses don't scroll the page; not lifted, the arrows keep scrolling it.
// - KB4: a key the app took (its own `preventDefault`) is left alone, and so is one from inside the
//   item (a text field).
// - KB5: an interruption drops the item where it is: focus leaving it, a press on it, the app
//   changing `values`.
// - KB6: `keyboard={false}`: no tab stop, no instructions, keys do nothing; `move()` still announces.
// - KB7: items are tab stops with the instructions in `aria-describedby`, after the app's own ids;
//   an app's `tabIndex` wins; a group's own wording and instructions replace the defaults.
// - KB8: a held arrow moves one place per repeat and announces only the last place.
// - KB9: in a scroll container, End moves the item to the last place and scrolls it into view.
// - KB10: keys during a pointer drag are left alone.
// - KB11: a group unmounted while a held arrow's last place waits to be spoken never speaks it: the
//   group's Scope ends its controller (#132's PR 3).
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import * as DomAnnouncer from "@wardic/dom/DomAnnouncer"
import * as ReorderController from "@wardic/dom/ReorderController"
import type * as CoreReorder from "@wardic/core/Reorder"
import { createReorderGroup, createReorderItem, Reorder, WardicProvider } from "@wardic/solid"
import { type Accessor, createSignal, For, Show } from "solid-js"
import { afterEach, expect, it } from "vitest"
import { commands } from "vitest/browser"
import "./browser-commands.ts"
import { raf } from "./browser-helpers.ts"

afterEach(async () => {
  cleanup()
  await commands.realMouse("move", 5, 5)
})

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

/** The page's live region's text: the last announcement. */
const announced = (): string => document.querySelector(`[${DomAnnouncer.ATTRIBUTE}]`)?.textContent ?? ""

interface MountOptions {
  readonly initial?: ReadonlyArray<string>
  readonly keyboard?: boolean
  readonly announcements?: Partial<CoreReorder.Announcements<string>>
  readonly instructions?: string
  /** Each item's own props: its `tabIndex`, `aria-describedby`, `onKeyDown`. */
  readonly itemProps?: (value: string) => Record<string, unknown>
  /** A text field inside each item. */
  readonly field?: boolean
  /** The list in a scroll container this tall, px. */
  readonly container?: number
  /** A page this tall, px, so it scrolls. */
  readonly page?: number
  /** Whether the group is mounted, under a provider that stays. */
  readonly shown?: Accessor<boolean>
}

/** A column of items (a to e by default), keyed with `<For>`; each scales to 1.05 while dragged or lifted. */
const mount = async (options: MountOptions = {}) => {
  const [values, setValues] = createSignal<ReadonlyArray<string>>(options.initial ?? ["a", "b", "c", "d", "e"])
  const list = () => (
    <Reorder.Group
      values={values()}
      onReorder={setValues}
      {...(options.keyboard !== undefined ? { keyboard: options.keyboard } : {})}
      {...(options.announcements !== undefined ? { announcements: options.announcements } : {})}
      {...(options.instructions !== undefined ? { instructions: options.instructions } : {})}
      style={{ position: "relative", "list-style": "none", margin: "0", padding: "0", width: "200px" }}
    >
      <For each={values()}>
        {(value) => (
          <Reorder.Item
            value={value}
            data-value={value}
            whileDrag={{ scale: 1.05 }}
            {...(options.itemProps?.(value) ?? {})}
            style={{ height: "40px", "margin-bottom": "8px", background: "#9cf" }}
          >
            {value}
            {options.field === true ? <input data-field={value} /> : null}
          </Reorder.Item>
        )}
      </For>
    </Reorder.Group>
  )
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <div style={{ height: options.page === undefined ? "auto" : `${options.page}px`, padding: "8px" }}>
        {options.container === undefined ? (
          <Show when={options.shown?.() ?? true}>{list()}</Show>
        ) : (
          <div data-scroller style={{ height: `${options.container}px`, overflow: "auto", position: "relative" }}>
            {list()}
          </div>
        )}
      </div>
    </WardicProvider>
  ))
  await frames(4)
  const item = (value: string): HTMLElement => container.querySelector<HTMLElement>(`[data-value="${value}"]`)!
  return { values, setValues, item, container }
}

/** Every text the live region shows from now on, in order. */
const recordAnnouncements = (): { readonly texts: Array<string>; readonly stop: () => void } => {
  const region = document.querySelector(`[${DomAnnouncer.ATTRIBUTE}]`)
  const texts: Array<string> = []
  const observer = new MutationObserver(() => texts.push((region?.textContent ?? "").replace(/\u00A0$/, "")))
  if (region !== null) observer.observe(region, { childList: true, characterData: true, subtree: true })
  return { texts, stop: () => observer.disconnect() }
}

it("KB1: Space lifts, the arrows move one place per press, Space drops; focus stays, and the item is raised and lifted", async () => {
  const m = await mount()
  const b = m.item("b")
  expect(document.getElementById(b.getAttribute("aria-describedby") ?? "")?.textContent, "the web's default instructions").toBe(ReorderController.DEFAULT_INSTRUCTIONS)
  expect(ReorderController.DEFAULT_INSTRUCTIONS).toBe(
    "Press Space or Enter to pick up. Use the arrow keys to move, Space or Enter to drop, Escape to cancel. Some screen readers need focus mode for these keys.",
  )
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
  expect(announced()).toBe("b, position 4 of 5.")
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

it("KB2: Escape cancels, restoring the order from the lift; Enter lifts and drops as Space does", async () => {
  const m = await mount()
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
  await frames(2)
  expect(announced()).toBe("Picked up b, position 2 of 5.")
  await commands.realKey("press", "ArrowUp")
  await frames(3)
  await commands.realKey("press", "Enter")
  await frames(2)
  expect(m.values()).toEqual(["b", "a", "c", "d", "e"])
  expect(announced()).toBe("Dropped b at position 1 of 5.")
})

it("KB3: Space and the arrows don't scroll the page while they reorder; not lifted, the arrows keep scrolling it", async () => {
  const m = await mount({ page: 3000 })
  const c = m.item("c")
  c.focus({ preventScroll: true })
  window.scrollTo(0, 0)
  await commands.realKey("press", "ArrowDown")
  // Chrome eases an arrow's page scroll: let it finish before going back to the top.
  await frames(40)
  expect(window.scrollY, "not lifted: the arrow scrolls the page").toBeGreaterThan(0)
  window.scrollTo(0, 0)
  await frames(2)
  await commands.realKey("press", "Space")
  await commands.realKey("press", "ArrowDown")
  await frames(4)
  expect(m.values()).toEqual(["a", "b", "d", "c", "e"])
  expect(window.scrollY, "lifted: Space and the arrow scroll nothing").toBe(0)
  await commands.realKey("press", "Space")
  window.scrollTo(0, 0)
})

it("KB4: a key the app took is left alone, and so is one from a text field inside the item", async () => {
  const m = await mount({
    itemProps: () => ({
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key === "Enter") e.preventDefault()
      },
    }),
    field: true,
  })
  const b = m.item("b")
  b.focus()
  await commands.realKey("press", "Enter")
  await frames(2)
  expect(announced(), "the app took Enter").not.toContain("Picked up")
  const field = b.querySelector<HTMLInputElement>("input")!
  field.focus()
  await commands.realKey("press", "Space")
  await commands.realKey("press", "ArrowDown")
  await frames(3)
  expect(field.value, "Space typed into the field").toBe(" ")
  expect(m.values(), "nothing moved").toEqual(["a", "b", "c", "d", "e"])
  expect(announced()).not.toContain("Picked up")
})

it("KB5: focus leaving the item, a press on it, or the app changing values drops it where it is", async () => {
  const m = await mount()
  const b = m.item("b")
  b.focus()
  await commands.realKey("press", "Space")
  await commands.realKey("press", "ArrowDown")
  await frames(3)
  // Tab: focus moves to the next item.
  await commands.realKey("press", "Tab")
  await frames(3)
  expect(announced()).toBe("Dropped b at position 3 of 5.")
  expect(m.values()).toEqual(["a", "c", "b", "d", "e"])

  // A press on the lifted item.
  b.focus()
  await commands.realKey("press", "Space")
  await frames(2)
  const box = b.getBoundingClientRect()
  await commands.realMouse("down", box.left + 20, box.top + 20)
  await frames(3)
  expect(announced()).toBe("Dropped b at position 3 of 5.")
  await commands.realMouse("up", box.left + 20, box.top + 20)
  await frames(3)

  // The app reorders others while it's lifted (b's node stays put, and keeps focus): dropped where it is.
  b.focus()
  await commands.realKey("press", "Space")
  await frames(2)
  m.setValues(["a", "c", "b", "e", "d"])
  await frames(3)
  expect(document.activeElement, "b kept focus").toBe(b)
  expect(announced()).toBe("Dropped b at position 3 of 5.")

  // The app moves it while it's lifted: dropped at its new place.
  await commands.realKey("press", "Space")
  await frames(2)
  m.setValues(["b", "a", "c", "e", "d"])
  await frames(3)
  expect(announced()).toBe("Dropped b at position 1 of 5.")
  await commands.realKey("press", "ArrowDown")
  await frames(3)
  expect(m.values(), "no longer lifted: the arrow moves nothing").toEqual(["b", "a", "c", "e", "d"])
})

it("KB6: keyboard={false}: no tab stop, no instructions, keys do nothing; move() still announces", async () => {
  const [values, setValues] = createSignal<ReadonlyArray<string>>(["a", "b", "c"])
  let move: ((value: string, toIndex: number) => void) | undefined
  const List = () => {
    const group = createReorderGroup(() => ({ values: values(), onReorder: setValues, keyboard: false }))
    move = group.move
    return (
      <ul {...group()}>
        <For each={values()}>
          {(value) => {
            const item = createReorderItem(group, { value })
            return (
              <li data-value={value} {...item()} style={{ height: "30px" }}>
                {value}
              </li>
            )
          }}
        </For>
      </ul>
    )
  }
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <List />
    </WardicProvider>
  ))
  await frames(4)
  const b = container.querySelector<HTMLElement>('[data-value="b"]')!
  expect(b.hasAttribute("tabindex")).toBe(false)
  expect(b.hasAttribute("aria-describedby")).toBe(false)
  b.tabIndex = 0
  b.focus()
  await commands.realKey("press", "Space")
  await commands.realKey("press", "ArrowDown")
  await frames(3)
  expect(values()).toEqual(["a", "b", "c"])
  move?.("c", 0)
  await frames(2)
  expect(values()).toEqual(["c", "a", "b"])
  expect(announced()).toBe("Moved c to position 1 of 3.")
})

it("KB7: tab stops with the instructions after the app's own ids; the app's tabIndex wins; a group's own wording", async () => {
  const m = await mount({
    itemProps: (value) => ({ ...(value === "a" ? { tabIndex: -1 } : {}), "aria-describedby": `hint-${value}` }),
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

it("KB8: a held arrow moves one place per repeat and announces only the last place", async () => {
  const m = await mount({ initial: ["a", "b", "c", "d", "e", "f", "g"] })
  const a = m.item("a")
  a.focus()
  await commands.realKey("press", "Space")
  await frames(2)
  const record = recordAnnouncements()
  await commands.realKey("down", "ArrowDown")
  await frames(3)
  for (let i = 0; i < 3; i++) {
    // A repeat, as a held key's: one place each, once the last has been laid out.
    await commands.realKey("down", "ArrowDown")
    await frames(3)
  }
  await commands.realKey("up", "ArrowDown")
  await new Promise((r) => setTimeout(r, 300))
  record.stop()
  expect(m.values()).toEqual(["b", "c", "d", "e", "a", "f", "g"])
  // The first press is spoken at once, the repeats' only once they stop: the last place.
  expect(record.texts).toEqual(["a, position 2 of 7.", "a, position 5 of 7."])
  await commands.realKey("press", "Space")
})

it("KB9: in a scroll container, End moves the item to the last place and scrolls its new place into view", async () => {
  const values = Array.from({ length: 12 }, (_, i) => `item ${i + 1}`)
  const m = await mount({ initial: values, container: 150 })
  const scroller = m.container.querySelector<HTMLElement>("[data-scroller]")!
  const first = m.item("item 1")
  first.focus()
  scroller.scrollTop = 0
  await commands.realKey("press", "Space")
  await commands.realKey("press", "End")
  await frames(4)
  expect(m.values().at(-1)).toBe("item 1")
  expect(announced()).toBe("item 1, position 12 of 12.")
  expect(scroller.scrollTop, "the scroller moved to show it").toBeGreaterThan(0)
  // Dropped and landed (no longer scaled by its lift): it paints inside the scroller's visible box.
  await commands.realKey("press", "Space")
  await frames(40)
  const view = scroller.getBoundingClientRect()
  const box = first.getBoundingClientRect()
  expect(box.top).toBeGreaterThanOrEqual(view.top - 0.5)
  expect(box.bottom).toBeLessThanOrEqual(view.bottom + 0.5)
})

it("KB10: keys during a pointer drag are left alone", async () => {
  const m = await mount()
  const c = m.item("c")
  c.focus()
  const box = c.getBoundingClientRect()
  await commands.realMouse("down", box.left + 20, box.top + 20)
  for (let k = 1; k <= 4; k++) {
    await commands.realMouse("move", box.left + 20, box.top + 20 + 4 * k)
    await frames(1)
  }
  await commands.realKey("press", "Space")
  await frames(2)
  expect(announced()).not.toContain("Picked up")
  await commands.realMouse("up", box.left + 20, box.top + 36)
  await frames(30)
})

it("KB11: a group unmounted while a held arrow's last place waits to be spoken never speaks it", async () => {
  const [shown, setShown] = createSignal(true)
  const m = await mount({ initial: ["a", "b", "c", "d", "e"], shown })
  m.item("a").focus()
  await commands.realKey("press", "Space")
  await frames(2)
  await commands.realKey("down", "ArrowDown")
  await frames(3)
  const record = recordAnnouncements()
  // A repeat, as a held key's: its place waits to be spoken until the repeats stop.
  await commands.realKey("down", "ArrowDown")
  // Unmounted at once, well inside that wait: the group's Scope ends its controller (#132's PR 3).
  setShown(false)
  await new Promise((r) => setTimeout(r, 300))
  record.stop()
  await commands.realKey("up", "ArrowDown")
  expect(m.container.querySelector("[data-value]"), "the group is gone").toBeNull()
  expect(record.texts, "nothing spoken after the unmount").toEqual([])
})
