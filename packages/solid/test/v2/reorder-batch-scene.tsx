// The scene for the Batch Reorder group's browser tests on Solid 2 (#712, ADR-0072): `Reorder.BatchGroup` of
// `Reorder.BatchItem`s on the geometry `reorder-scene.tsx`'s `Reorder.Group` lists have (a column of 200x50
// items, a row of 80x50 items, a grid of 80x50 items three to a row, each 10 px apart), at the same place on
// the page, so one drag path drives both. Not a test file itself.
import type * as CoreReorder from "@wardic/core/Reorder"
import { DomLive } from "@wardic/dom"
import { Reorder, type ReorderBatchGroup, type WardicBatchGesture, type WardicBatchTransition, type WardicBatchValues, WardicProvider } from "@wardic/solid/unstable/v2"
import type { JSX } from "@solidjs/web"
import * as Bool from "effect/Boolean"
import * as UndefinedOr from "effect/UndefinedOr"
import { type Accessor, createSignal, flush, For } from "solid-js"
import { mount } from "./mount.tsx"
import { type Layout, resetScene, settle, VALUES } from "./reorder-scene.tsx"

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
}

export interface BatchScene {
  readonly order: Accessor<ReadonlyArray<string>>
  readonly setOrder: (values: ReadonlyArray<string>) => void
  /** Every `onReorder` call's values, in order. */
  readonly reorders: ReadonlyArray<ReadonlyArray<string>>
  readonly item: (value: string) => HTMLElement
  readonly group: () => HTMLElement
  readonly scroller: HTMLElement | undefined
  /** The group `groupRef` was given. */
  readonly list: () => ReorderBatchGroup<string>
}

const SIZES: Record<Layout, { readonly n: number; readonly w: number; readonly h: number }> = {
  y: { n: 5, w: 200, h: 50 },
  x: { n: 5, w: 80, h: 50 },
  xy: { n: 6, w: 80, h: 50 },
}

/** The group's place on the page: `reorder-scene.tsx`'s. */
const AT: JSX.CSSProperties = { position: "absolute", left: "40px", top: "40px", margin: "0", padding: "0" }

/** An item's look: the Reorder scene's, its size the group's. */
const LOOK: JSX.CSSProperties = { "box-sizing": "border-box", border: "1px solid #333", background: "#9cf", "list-style": "none" }

const optional = <K extends string, A>(key: K, value: A | undefined): Partial<Record<K, A>> =>
  UndefinedOr.match(value, { onUndefined: () => ({}), onDefined: (v) => ({ [key]: v }) as Record<K, A> })

// The Batch scene mounted last, unmounted by `resetBatchScene` (and by `mount`'s own `afterEach`).
let unmountBatch: () => void = () => {}

/** Release the mouse, park it, and unmount the scenes: the Batch's and the Reorder one's. */
export const resetBatchScene = async (): Promise<void> => {
  unmountBatch()
  await resetScene()
}

/** Mount `values` (default the layout's count) as a `Reorder.BatchGroup` of `Reorder.BatchItem`s keyed by `<For>`. */
export const mountBatchReorder = async (o: BatchSceneOptions = {}): Promise<BatchScene> => {
  const layout = o.layout ?? "y"
  const size = SIZES[layout]
  const [order, setOrder] = createSignal<ReadonlyArray<string>>(VALUES.slice(0, o.n ?? size.n))
  let groupEl!: HTMLElement
  let scroller: HTMLElement | undefined
  let list!: ReorderBatchGroup<string>
  const reorders: Array<ReadonlyArray<string>> = []
  const onReorder = (values: Array<string>): void => {
    reorders.push(values)
    setOrder(values)
  }
  const group = (): JSX.Element => (
    <Reorder.BatchGroup
      ref={(el: HTMLElement) => (groupEl = el)}
      groupRef={(made: ReorderBatchGroup<string>) => (list = made)}
      values={order()}
      onReorder={onReorder}
      axis={layout as CoreReorder.Axis}
      itemSize={{ width: size.w, height: size.h }}
      gap={10}
      {...Bool.match(layout === "xy", { onTrue: () => ({ columns: 3 }), onFalse: () => ({}) })}
      {...optional("whileDrag", o.whileDrag)}
      {...optional("transition", o.transition)}
      {...optional("whileHover", o.whileHover)}
      {...optional("whileTap", o.whileTap)}
      keyboard={UndefinedOr.match(o.keyboard, { onUndefined: () => undefined, onDefined: (keyboard) => keyboard() })}
      style={UndefinedOr.match(o.container, { onUndefined: () => AT, onDefined: () => ({ margin: "0", padding: "0" }) })}
    >
      <For each={order()}>
        {(value) => (
          <Reorder.BatchItem value={value} data-value={value} style={LOOK}>
            {value}
          </Reorder.BatchItem>
        )}
      </For>
    </Reorder.BatchGroup>
  )
  const { unmount } = mount(() => (
    <WardicProvider env={DomLive}>
      {UndefinedOr.match(o.container, {
        onDefined: (height) => (
          <div
            ref={(el: HTMLElement) => (scroller = el)}
            style={{ position: "absolute", left: "40px", top: "40px", width: "230px", height: `${height}px`, overflow: "auto" }}
          >
            {group()}
          </div>
        ),
        onUndefined: group,
      })}
    </WardicProvider>
  ))
  unmountBatch = unmount
  await settle()
  return {
    order,
    setOrder: (values) => {
      setOrder(values)
      flush()
    },
    reorders,
    item: (value) => document.querySelector<HTMLElement>(`[data-value="${value}"]`)!,
    group: () => groupEl,
    scroller,
    list: () => list,
  }
}
