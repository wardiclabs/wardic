// Shared scene and real-input helpers for the `<Reorder>` browser tests (ADR-0020):
// reorder.browser.test.tsx, reorder-headless.browser.test.tsx and
// reorder-engine.browser.test.tsx.
//
// The lists are the evidence runs' (.tmp/reorder/probe-common.js): a column of 200x50
// items (a 60 px pitch), a row of 80x50 items (a 90 px pitch) and a wrapped grid of
// 80x50 items, three to a row, each 10 px apart. Frames are read post-paint: every rAF
// posts a MessageChannel message, whose handler runs after that frame's rendering
// update (the layout lab's method).
import { cleanup, render } from "@solidjs/testing-library"
import type { ReorderAxis } from "@wardic/core"
import { DomLive } from "@wardic/dom"
import { Reorder, type WardicValues, WardicProvider } from "@wardic/solid"
import { type Accessor, createSignal, For, type JSX } from "solid-js"
import { commands } from "vitest/browser"
import "./browser-commands.ts"
import { afterPaint, raf } from "./browser-helpers.ts"

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

/** Move the real mouse from `from` to `to` in `steps` moves, `ms` apart (each move also waits for its ack). */
export const glide = async (from: Pt, to: Pt, steps: number, ms = 20): Promise<void> => {
  for (let k = 1; k <= steps; k++) {
    await mouse.move({ x: from.x + ((to.x - from.x) * k) / steps, y: from.y + ((to.y - from.y) * k) / steps })
    if (ms > 0) await wait(ms)
  }
}

export const add = (p: Pt, dx: number, dy: number): Pt => ({ x: p.x + dx, y: p.y + dy })

/** For `afterEach`: release a held button, park the mouse, clear any selection, unmount, scroll home. */
export const resetScene = async (): Promise<void> => {
  if (held) await mouse.up({ x: 5, y: 5 })
  await mouse.move({ x: 5, y: 5 })
  window.getSelection()?.removeAllRanges()
  cleanup()
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

/** The values in DOM order. */
export const domOrder = (root: ParentNode = document): ReadonlyArray<string> =>
  [...root.querySelectorAll<HTMLElement>("[data-value]")].map((el) => el.dataset.value!)

export const VALUES = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t"]

export type Layout = "y" | "x" | "xy"

export const LAYOUTS: Record<Layout, { readonly n: number; readonly w: number; readonly h: number; readonly group: JSX.CSSProperties }> = {
  y: { n: 5, w: 200, h: 50, group: { "flex-direction": "column", width: "200px" } },
  x: { n: 5, w: 80, h: 50, group: { "flex-direction": "row" } },
  xy: { n: 6, w: 80, h: 50, group: { "flex-direction": "row", "flex-wrap": "wrap", width: "280px" } },
}

export interface SceneOptions {
  readonly layout?: Layout
  readonly n?: number
  /** The group's `axis` prop, read reactively; absent = detected. */
  readonly axis?: Accessor<ReorderAxis | undefined>
  readonly rtl?: boolean
  /** `row-reverse` / `column-reverse`. */
  readonly reverse?: boolean
  /** Centred in the viewport, so a width change moves it sideways (#39). */
  readonly centred?: boolean
  /** Inside a plain `overflow: auto` container (not `layoutScroll`) this tall. */
  readonly container?: number
  /** A 3000 px tall page. */
  readonly tall?: boolean
  /** Items hold text a drag can select. */
  readonly text?: boolean
  readonly groupAs?: "ul" | "ol" | "div" | "section"
  readonly itemAs?: "li" | "div" | "article"
  /** Extra group style, read reactively (the user's, over the scene's). */
  readonly groupStyle?: Accessor<JSX.CSSProperties>
  readonly whileDrag?: WardicValues
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
  readonly scroller: HTMLElement | undefined
}

export const groupCss = (o: SceneOptions): JSX.CSSProperties => {
  const layout = o.layout ?? "y"
  const inContainer = o.container !== undefined
  return {
    ...(o.rtl === true ? { direction: "rtl" } : {}),
    position: inContainer ? "relative" : "absolute",
    left: inContainer ? "0px" : o.centred === true ? "calc(50% - 100px)" : "40px",
    top: inContainer ? "0px" : "40px",
    display: "flex",
    gap: "10px",
    margin: "0",
    padding: "0",
    ...LAYOUTS[layout].group,
    ...(inContainer && layout !== "y" ? { width: "max-content" } : {}),
    ...(o.reverse === true ? { "flex-direction": layout === "y" ? "column-reverse" : "row-reverse" } : {}),
  }
}

export const itemCss = (o: SceneOptions): JSX.CSSProperties => {
  const l = LAYOUTS[o.layout ?? "y"]
  return {
    width: `${l.w}px`,
    height: `${l.h}px`,
    "box-sizing": "border-box",
    border: "1px solid #333",
    background: "#9cf",
    "list-style": "none",
    "font-family": "monospace",
    ...(o.text === true ? { "font-size": "20px", "white-space": "nowrap", overflow: "hidden" } : {}),
  }
}

/** Mount `values` (default the layout's count) as a `Reorder.Group` of `Reorder.Item`s keyed by `<For>`. */
export const mountReorder = async (o: SceneOptions = {}): Promise<Scene> => {
  const [order, setOrder] = createSignal<ReadonlyArray<string>>(VALUES.slice(0, o.n ?? LAYOUTS[o.layout ?? "y"].n))
  const [scroller, setScroller] = createSignal<HTMLElement>()
  const [groupEl, setGroupEl] = createSignal<HTMLElement>()
  const reorders: Array<ReadonlyArray<string>> = []
  const reorderTimes: Array<number> = []
  const onReorder = (values: Array<string>): void => {
    reorders.push(values)
    reorderTimes.push(performance.now())
    setOrder(values)
  }
  const group = (): JSX.Element => (
    <Reorder.Group
      ref={(el: HTMLElement) => setGroupEl(el)}
      values={order()}
      onReorder={onReorder}
      axis={o.axis?.()}
      {...(o.groupAs !== undefined ? { as: o.groupAs } : {})}
      style={{ ...groupCss(o), ...o.groupStyle?.() }}
    >
      <For each={order()}>
        {(value) => (
          <Reorder.Item
            value={value}
            data-value={value}
            {...(o.itemAs !== undefined ? { as: o.itemAs } : {})}
            {...(o.whileDrag !== undefined ? { whileDrag: o.whileDrag } : {})}
            style={itemCss(o)}
          >
            {o.text === true ? `item ${value} text` : value}
          </Reorder.Item>
        )}
      </For>
    </Reorder.Group>
  )
  render(() => (
    <WardicProvider env={DomLive}>
      {o.container !== undefined ? (
        <div
          ref={(el: HTMLElement) => setScroller(el)}
          style={{ position: "absolute", left: "40px", top: "40px", width: "230px", height: `${o.container}px`, overflow: "auto" }}
        >
          {group()}
        </div>
      ) : o.tall === true ? (
        <div style={{ height: "3000px" }}>{group()}</div>
      ) : (
        group()
      )}
    </WardicProvider>
  ))
  await settle()
  return {
    order,
    setOrder,
    reorders,
    reorderTimes,
    item: (value) => document.querySelector<HTMLElement>(`[data-value="${value}"]`)!,
    group: () => groupEl()!,
    scroller: scroller(),
  }
}
