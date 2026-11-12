// The scene for the Batch Reorder group's browser tests on Solid 1 (#712, ADR-0072): `Reorder.BatchGroup`
// of `Reorder.BatchItem`s, on the geometry `reorder-harness.tsx`'s `Reorder.Group` lists have (a column of
// 200x50 items, a row of 80x50 items, a grid of 80x50 items three to a row, each 10 px apart), at the same
// place on the page, so one drag path drives both.
import type * as ReorderController from "@wardic/dom/ReorderController"
import { render } from "@solidjs/testing-library"
import type * as CoreReorder from "@wardic/core/Reorder"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, Reorder, type WardicBatchExit, type WardicBatchGesture, type WardicBatchTransition, type WardicBatchValues, WardicProvider } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import { type Accessor, createSignal, For, type JSX } from "solid-js"
import { itemCss, LAYOUTS, type Layout, type Scene, settle, VALUES } from "./reorder-harness.tsx"

export interface BatchSceneOptions {
  readonly layout?: Layout
  readonly n?: number
  readonly whileDrag?: WardicBatchGesture | ((item: string, i: number) => WardicBatchValues)
  readonly transition?: WardicBatchTransition
  /** Inside a plain `overflow: auto` container this tall. */
  readonly container?: number
  /** The keyboard reorder, read reactively: on when left out. */
  readonly keyboard?: Accessor<boolean>
  readonly whileHover?: WardicBatchGesture | ((item: string, i: number) => WardicBatchValues)
  readonly whileTap?: WardicBatchGesture | ((item: string, i: number) => WardicBatchValues)
  /** Each item's exit, its `<For>` under an `<AnimatePresence>`. */
  readonly exit?: WardicBatchExit
  /** The group's `direction` prop. */
  readonly direction?: "ltr" | "rtl"
  /** The group's `direction` prop, read reactively (it wins over `direction`). */
  readonly directionOf?: Accessor<"ltr" | "rtl" | undefined>
  /** The group inside an ancestor with `dir="rtl"`, and no prop. */
  readonly rtl?: boolean
  /** A grid with no `columns`, its width this, in px, read reactively (Q36). */
  readonly fromWidth?: Accessor<number>
  readonly announcements?: Partial<CoreReorder.Announcements<string>>
  /** Items with no `style` of their own: each takes the group's alone (Q47). */
  readonly plain?: boolean
  /** Where each item starts (#706's Q20: a key but `x` and `y` moves to its identity as it enters). */
  readonly initial?: WardicBatchValues | ((item: string, i: number) => WardicBatchValues)
}

/** The group's place on the page: `reorder-harness.tsx`'s. */
const AT: JSX.CSSProperties = { position: "absolute", left: "40px", top: "40px", margin: "0", padding: "0" }

/** An item's look: the Reorder scene's, its size the group's. */
const lookOf = (o: BatchSceneOptions): JSX.CSSProperties => {
  const { width: _width, height: _height, ...look } = itemCss({ layout: o.layout ?? "y" })
  return look
}

/** Mount `values` (default the layout's count) as a `Reorder.BatchGroup` of `Reorder.BatchItem`s keyed by `<For>`. */
export const mountBatchReorder = async (o: BatchSceneOptions = {}): Promise<Scene> => {
  const layout = o.layout ?? "y"
  const l = LAYOUTS[layout]
  const [order, setOrder] = createSignal<ReadonlyArray<string>>(VALUES.slice(0, o.n ?? l.n))
  const [groupEl, setGroupEl] = createSignal<HTMLElement>()
  const [scroller, setScroller] = createSignal<HTMLElement>()
  const reorders: Array<ReadonlyArray<string>> = []
  const reorderTimes: Array<number> = []
  const ends: Array<ReorderController.End<string>> = []
  const holds: Array<string> = []
  const onReorder = (values: Array<string>): void => {
    reorders.push(values)
    reorderTimes.push(performance.now())
    setOrder(values)
  }
  const items = (): JSX.Element => (
    <For each={order()}>
      {(value) => (
        <Reorder.BatchItem value={value} data-value={value} {...Bool.match(o.plain === true, { onTrue: () => ({}), onFalse: () => ({ style: lookOf(o) }) })}>
          {value}
        </Reorder.BatchItem>
      )}
    </For>
  )
  const group = (): JSX.Element => (
    <Reorder.BatchGroup
      ref={(el: HTMLElement) => setGroupEl(el)}
      values={order()}
      onReorder={onReorder}
      onReorderEnd={(end: ReorderController.End<string>) => {
        ends.push(end)
        holds.push(`reorder ${end.value} ${end.from}→${end.to}`)
      }}
      onHoldStart={(start: ReorderController.HoldStart<string>) => holds.push(`start ${start.value} ${start.from}`)}
      onHoldEnd={(end: ReorderController.HoldEnd<string>) => holds.push(`end ${end.value} ${end.from}→${end.to} ${end.how}`)}
      axis={layout}
      itemSize={{ width: l.w, height: l.h }}
      gap={10}
      {...Bool.match(Bool.and(layout === "xy", Predicate.isUndefined(o.fromWidth)), { onTrue: () => ({ columns: 3 }), onFalse: () => ({}) })}
      {...UndefinedOr.match(o.whileDrag, { onUndefined: () => ({}), onDefined: (whileDrag) => ({ whileDrag }) })}
      {...UndefinedOr.match(o.transition, { onUndefined: () => ({}), onDefined: (transition) => ({ transition }) })}
      {...UndefinedOr.match(o.initial, { onUndefined: () => ({}), onDefined: (initial) => ({ initial }) })}
      keyboard={UndefinedOr.match(o.keyboard, { onUndefined: () => undefined, onDefined: (keyboard) => keyboard() })}
      {...UndefinedOr.match(o.whileHover, { onUndefined: () => ({}), onDefined: (whileHover) => ({ whileHover }) })}
      {...UndefinedOr.match(o.whileTap, { onUndefined: () => ({}), onDefined: (whileTap) => ({ whileTap }) })}
      {...UndefinedOr.match(o.exit, { onUndefined: () => ({}), onDefined: (exit) => ({ exit }) })}
      {...UndefinedOr.match(o.direction, { onUndefined: () => ({}), onDefined: (direction) => ({ direction }) })}
      {...UndefinedOr.match(o.directionOf, { onUndefined: () => ({}), onDefined: (directionOf) => ({ get direction() { return directionOf() } }) })}
      {...UndefinedOr.match(o.announcements, { onUndefined: () => ({}), onDefined: (announcements) => ({ announcements }) })}
      style={{
        ...UndefinedOr.match(o.container, { onUndefined: () => AT, onDefined: () => ({ margin: "0", padding: "0" }) }),
        ...UndefinedOr.match(o.fromWidth, { onUndefined: () => ({}), onDefined: (width) => ({ width: `${width()}px` }) }),
      }}
    >
      {Bool.match(Predicate.isUndefined(o.exit), {
        onTrue: () => items(),
        onFalse: () => <AnimatePresence>{items()}</AnimatePresence>,
      })}
    </Reorder.BatchGroup>
  )
  render(() => (
    <WardicProvider env={DomLive}>
      {UndefinedOr.match(o.container, {
        onDefined: (height) => (
          <div
            ref={(el: HTMLElement) => setScroller(el)}
            style={{ position: "absolute", left: "40px", top: "40px", width: "230px", height: `${height}px`, overflow: "auto" }}
          >
            {group()}
          </div>
        ),
        onUndefined: () => Bool.match(o.rtl === true, { onTrue: () => <div dir="rtl">{group()}</div>, onFalse: group }),
      })}
    </WardicProvider>
  ))
  await settle()
  return {
    order,
    setOrder,
    reorders,
    reorderTimes,
    ends,
    holds,
    item: (value) => document.querySelector<HTMLElement>(`[data-value="${value}"]`)!,
    group: () => groupEl()!,
    scroller: scroller(),
  }
}
