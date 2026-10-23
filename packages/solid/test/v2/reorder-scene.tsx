// The `<Reorder>` scene and real-input helpers for the Solid 2 binding's Reorder tests (#209 PR 3b),
// as the Solid 1 binding's `reorder-harness.tsx` has them: a column of 200x50 items (a 60 px pitch),
// a row of 80x50 items (a 90 px pitch) and a wrapped grid of 80x50 items, three to a row, each 10 px
// apart. The scene renders through `Reorder.Group` / `Reorder.Item`, or through `reorderGroup` /
// `reorderItem` on a plain `ul` / `li` (`factories`). Not a test file itself.
import type * as CoreReorder from "@wardic/core/Reorder"
import { DomLive } from "@wardic/dom"
import { Reorder, type ReorderGroup, reorderGroup, reorderItem, type WardicValues, WardicProvider } from "@wardic/solid/unstable/v2"
import type { JSX } from "@solidjs/web"
import * as Bool from "effect/Boolean"
import * as UndefinedOr from "effect/UndefinedOr"
import { type Accessor, createSignal, flush, For } from "solid-js"
import { commands } from "vitest/browser"
import "../browser-commands.ts"
import { afterPaint, raf } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

export interface Pt {
  readonly x: number
  readonly y: number
}

export const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await raf()
  await afterPaint()
}

// Whether the button is held, so a test that fails mid-press still releases it.
let held = false
export const mouse = {
  move: (p: Pt): Promise<void> => commands.realMouse("move", p.x, p.y),
  down: async (p: Pt): Promise<void> => {
    await commands.realMouse("down", p.x, p.y)
    held = true
  },
  up: async (p: Pt): Promise<void> => {
    await commands.realMouse("up", p.x, p.y)
    held = false
  },
}

export const glide = async (from: Pt, to: Pt, steps: number, ms = 20): Promise<void> => {
  for (let k = 1; k <= steps; k++) {
    await mouse.move({ x: from.x + ((to.x - from.x) * k) / steps, y: from.y + ((to.y - from.y) * k) / steps })
    if (ms > 0) await wait(ms)
  }
}

export const add = (p: Pt, dx: number, dy: number): Pt => ({ x: p.x + dx, y: p.y + dy })

// The scene mounted last, unmounted by `resetScene` (and by `mount`'s own `afterEach`).
let unmountScene: () => void = () => {}

/** Release the mouse, park it, clear a selection, and unmount the scene. */
export const resetScene = async (): Promise<void> => {
  if (held) await mouse.up({ x: 5, y: 5 })
  await mouse.move({ x: 5, y: 5 })
  window.getSelection()?.removeAllRanges()
  unmountScene()
  window.scrollTo(0, 0)
}

export const centreOf = (el: Element): Pt => {
  const b = el.getBoundingClientRect()
  return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
}

/** Where `el`'s top-left corner is relative to the grab point `g`. */
export const grabOffsetOf = (el: Element, g: Pt): Pt => {
  const b = el.getBoundingClientRect()
  return { x: b.left - g.x, y: b.top - g.y }
}

/** How far (px, the larger axis) `el` paints from where the pointer at `pointer` holds it. */
export const offPointer = (el: Element, pointer: Pt, grabOffset: Pt): number => {
  const b = el.getBoundingClientRect()
  return Math.max(Math.abs(b.left - pointer.x - grabOffset.x), Math.abs(b.top - pointer.y - grabOffset.y))
}

/** A painted frame: when its rAF ran, and what `read` returned just after its paint. */
export interface Frame<T> {
  readonly frameAt: number
  readonly v: T
}

/** Read `read` just after every painted frame until `stop()`. */
export const sampleFrames = <T,>(read: () => T): { readonly stop: () => ReadonlyArray<Frame<T>> } => {
  const frames: Array<Frame<T>> = []
  const channel = new MessageChannel()
  let on = true
  let frameAt = 0
  const post = (): void => {
    frameAt = performance.now()
    channel.port2.postMessage(undefined)
  }
  channel.port1.onmessage = () => {
    frames.push({ frameAt, v: read() })
    if (on) requestAnimationFrame(post)
  }
  requestAnimationFrame(post)
  return {
    stop: () => {
      on = false
      channel.port1.close()
      return frames
    },
  }
}

export const VALUES = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]

export type Layout = "y" | "x" | "xy"

const LAYOUTS: Record<Layout, { readonly n: number; readonly w: number; readonly h: number; readonly group: JSX.CSSProperties }> = {
  y: { n: 5, w: 200, h: 50, group: { "flex-direction": "column", width: "200px" } },
  x: { n: 5, w: 80, h: 50, group: { "flex-direction": "row" } },
  xy: { n: 6, w: 80, h: 50, group: { "flex-direction": "row", "flex-wrap": "wrap", width: "280px" } },
}

export interface SceneOptions {
  readonly layout?: Layout
  /** The group's `axis`, read reactively; absent = detected. */
  readonly axis?: Accessor<CoreReorder.Axis | undefined>
  readonly groupAs?: "ul" | "ol" | "div" | "section"
  readonly itemAs?: "li" | "div" | "article"
  /** Extra group style, read reactively (the user's, over the scene's). */
  readonly groupStyle?: Accessor<JSX.CSSProperties>
  /** Extra item style, read reactively (the user's, over the scene's). */
  readonly itemStyle?: Accessor<JSX.CSSProperties>
  readonly whileDrag?: WardicValues
  /** Through `reorderGroup` / `reorderItem` on a plain `ul` / `li`, not the components. */
  readonly factories?: boolean
}

export interface Scene {
  readonly order: Accessor<ReadonlyArray<string>>
  readonly setOrder: (values: ReadonlyArray<string>) => void
  /** Every `onReorder` call's values, in order. */
  readonly reorders: ReadonlyArray<ReadonlyArray<string>>
  /** When each `onReorder` call ran (`performance.now()`). */
  readonly reorderTimes: ReadonlyArray<number>
  readonly item: (value: string) => HTMLElement
  readonly group: () => HTMLElement
  /** `list.move` (the factories' scene only). */
  readonly move: (value: string, toIndex: number) => void
  /** The group: `reorderGroup`'s, or the one `Reorder.Group` hands its `groupRef` (#257 item 3). */
  readonly list: () => ReorderGroup<string>
}

const groupCss = (o: SceneOptions): JSX.CSSProperties => ({
  position: "absolute",
  left: "40px",
  top: "40px",
  display: "flex",
  gap: "10px",
  margin: "0",
  padding: "0",
  ...LAYOUTS[o.layout ?? "y"].group,
})

const itemCss = (o: SceneOptions): JSX.CSSProperties => {
  const l = LAYOUTS[o.layout ?? "y"]
  return { width: `${l.w}px`, height: `${l.h}px`, "box-sizing": "border-box", border: "1px solid #333", background: "#9cf", "list-style": "none" }
}

const optional = <K extends string, A>(key: K, value: A | undefined): Partial<Record<K, A>> =>
  UndefinedOr.match(value, { onUndefined: () => ({}), onDefined: (v) => ({ [key]: v }) as Record<K, A> })

/** Mount the layout's values as a Reorder group of items keyed by `<For>`. */
export const mountReorder = async (o: SceneOptions = {}): Promise<Scene> => {
  const [order, setOrder] = createSignal<ReadonlyArray<string>>(VALUES.slice(0, LAYOUTS[o.layout ?? "y"].n))
  let groupEl!: HTMLElement
  let move: (value: string, toIndex: number) => void = () => {}
  let list!: ReorderGroup<string>
  const reorders: Array<ReadonlyArray<string>> = []
  const reorderTimes: Array<number> = []
  const onReorder = (values: Array<string>): void => {
    reorders.push(values)
    reorderTimes.push(performance.now())
    setOrder(values)
  }
  const components = (): JSX.Element => (
    <Reorder.Group
      ref={(el: HTMLElement) => (groupEl = el)}
      groupRef={(group: ReorderGroup<string>) => (list = group)}
      values={order()}
      onReorder={onReorder}
      axis={o.axis?.()}
      {...optional("as", o.groupAs)}
      style={{ ...groupCss(o), ...o.groupStyle?.() }}
    >
      <For each={order()}>
        {(value) => (
          <Reorder.Item value={value} data-value={value} {...optional("as", o.itemAs)} {...optional("whileDrag", o.whileDrag)} style={{ ...itemCss(o), ...o.itemStyle?.() }}>
            {value}
          </Reorder.Item>
        )}
      </For>
    </Reorder.Group>
  )
  const Factories = (): JSX.Element => {
    const group = reorderGroup({ values: order, onReorder, axis: () => o.axis?.(), style: () => ({ ...groupCss(o), ...o.groupStyle?.() }) })
    list = group
    move = group.move
    return (
      <ul {...group} ref={[group, (el: HTMLElement) => (groupEl = el)]}>
        <For each={order()}>
          {(value) => {
            const row = reorderItem(group, { value, style: () => ({ ...itemCss(o), ...o.itemStyle?.() }), ...optional("whileDrag", o.whileDrag) })
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
  const { unmount } = mount(() => (
    <WardicProvider env={DomLive}>{Bool.match(o.factories === true, { onTrue: () => <Factories />, onFalse: components })}</WardicProvider>
  ))
  unmountScene = unmount
  await settle()
  return {
    order,
    setOrder: (values) => {
      setOrder(values)
      flush()
    },
    reorders,
    reorderTimes,
    item: (value) => document.querySelector<HTMLElement>(`[data-value="${value}"]`)!,
    group: () => groupEl,
    move,
    list: () => list,
  }
}
