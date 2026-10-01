/**
 * Scenario 14: `<Reorder>` (issue #44, ADR-0020), driven by hand.
 *
 * A `Reorder.Group` of six text items keyed with `<For>`, built only from the public
 * API. The mode picks the layout: a `y` list, an `x` row, an `xy` grid, an rtl row, or
 * a `row-reverse` / `column-reverse` one (where motion/react 13.4.6 never reorders).
 * "In a scroll container" puts the list in a plain `overflow: auto` box (not
 * `layoutScroll`); without it the list sits on the page, which scrolls. "Lift" adds
 * `whileDrag: { scale: 1.05 }`.
 *
 * While an item is held:
 *
 * - **S** scrolls the container (or the page) 60px: the item stays under the pointer
 *   (a scroll moves a Held pointer, D14) and nothing else moves in the list (the
 *   fold, D15).
 * - Holding it within 50px of the container's (or the window's) edge Auto-scrolls it
 *   (D16); the card reports how far.
 *
 * **M** (any time) moves the first item to the end in code: the app sets `values`
 * itself, as `move()` does through `onReorder`, and the items animate there.
 *
 * "A layout child in each item" wraps each item's text in a `layout` `<p>` (#28's
 * nested case, deferred in ADR-0020): a displaced item's pass then seeds its child
 * too, so the drag lines' seeded bound doubles (the run's `nodesPerItem`); watch the
 * children ride their items, and a retarget for #28's glued-child jump.
 *
 * Two toggles break it on purpose: "items via .map" renders the items without
 * `<For>`, so each reorder remounts them (the console shows one warning, and the
 * reorder doesn't animate); "touch-action: auto on items" overrides the drag default
 * (#36), so a touch drag gets taken for a scroll and cancelled (it ends where it was,
 * not at the viewport's corner, since the cancel fix).
 *
 * The card's drag lines judge the dragged item as in scenarios 11-13; its reorder
 * lines (`lab/reorder-run.ts`) check the reorders, that uninvolved items don't fly,
 * that the item paints on top, and report Auto-scroll.
 *
 * @module
 */
import { LayoutGroup, Reorder, wardic } from "@wardic/solid"
import { createSignal, For, type JSX, onCleanup, onMount, Show } from "solid-js"
import type { Box, Point } from "../lab/drag-run.ts"
import type { ReorderEvent, ReorderFrame } from "../lab/reorder-run.ts"
import { Checkbox, CONTROLS_STYLE, NOTE_STYLE, type Option, Select } from "./controls.tsx"
import { attachDragRecorder } from "./drag-recorder.ts"
import type { ScenarioDef } from "./types.ts"

/** The scenario id, also the View root's `data-scenario` value. */
const ID = "reorder"

type Layout = "y" | "x" | "xy" | "rtl" | "row-reverse" | "column-reverse"

const LAYOUTS: ReadonlyArray<Option<Layout>> = [
  { value: "y", label: "y list" },
  { value: "x", label: "x row" },
  { value: "xy", label: "xy grid" },
  { value: "rtl", label: "rtl row" },
  { value: "row-reverse", label: "row-reverse" },
  { value: "column-reverse", label: "column-reverse" },
]

const VALUES = ["a", "b", "c", "d", "e", "f"]

/** The group's axis for a layout (what the group detects). */
const axisOf = (layout: Layout): "x" | "y" | "xy" =>
  layout === "xy" ? "xy" : layout === "y" || layout === "column-reverse" ? "y" : "x"

const ROOT_STYLE: JSX.CSSProperties = { display: "flex", "flex-direction": "column", "align-items": "flex-start", gap: "8px" }
const STAGE_STYLE: JSX.CSSProperties = { "--stage-w": "460px", "--stage-h": "300px" }

/** The group: a flex list of 8px gaps, 16px in from the stage (or the container). */
const groupStyle = (layout: Layout): JSX.CSSProperties => ({
  position: "relative",
  display: "flex",
  gap: "8px",
  margin: "16px",
  padding: "0",
  ...(layout === "rtl" ? { direction: "rtl" } : {}),
  ...(layout === "y" ? { "flex-direction": "column", width: "180px" } : {}),
  ...(layout === "column-reverse" ? { "flex-direction": "column-reverse", width: "180px" } : {}),
  ...(layout === "x" || layout === "rtl" ? { "flex-direction": "row", width: "max-content" } : {}),
  ...(layout === "row-reverse" ? { "flex-direction": "row-reverse", width: "max-content" } : {}),
  ...(layout === "xy" ? { "flex-direction": "row", "flex-wrap": "wrap", width: "304px" } : {}),
})

/** An item: 180x36 in a list, 64x40 in a row, 96x40 in the grid. Whole pixels (see the recorder). */
const itemStyle = (layout: Layout, touchAuto: boolean): JSX.CSSProperties => {
  const column = layout === "y" || layout === "column-reverse"
  return {
    width: column ? "180px" : layout === "xy" ? "96px" : "64px",
    height: column ? "36px" : "40px",
    "flex-shrink": "0",
    cursor: "grab",
    "list-style": "none",
    ...(touchAuto ? { "touch-action": "auto" } : {}),
  }
}

/** The scroll container: smaller than its list on the list's axis, so it scrolls. */
const containerStyle = (layout: Layout): JSX.CSSProperties => {
  const column = layout === "y" || layout === "column-reverse"
  return {
    position: "absolute",
    left: "16px",
    top: "16px",
    overflow: "auto",
    border: "1px dashed var(--lab-border)",
    // An rtl row's container is rtl too, as in an rtl app: its scroll starts at the row's start.
    ...(layout === "rtl" ? { direction: "rtl" } : {}),
    ...(column ? { width: "220px", height: "160px" } : layout === "xy" ? { width: "336px", height: "80px" } : { width: "260px", height: "80px" }),
  }
}

const LIFT = { scale: 1.05 } as const
const NO_LIFT = {} as const
/** The layout child: no margins, so the item looks the same with or without it. */
const CHILD_STYLE: JSX.CSSProperties = { margin: "0" }

/** A painted box relative to `of`'s box. */
const relativeBox = (el: Element, of: DOMRect): Box => {
  const r = el.getBoundingClientRect()
  return { x: r.left - of.left, y: r.top - of.top, width: r.width, height: r.height }
}

const View: ScenarioDef["View"] = (props) => {
  const [layout, setLayout] = createSignal<Layout>("y")
  const [inContainer, setInContainer] = createSignal(false)
  const [lift, setLift] = createSignal(false)
  const [viaMap, setViaMap] = createSignal(false)
  const [touchAuto, setTouchAuto] = createSignal(false)
  const [layoutChild, setLayoutChild] = createSignal(false)
  const [order, setOrder] = createSignal<ReadonlyArray<string>>(VALUES)

  let stage: HTMLDivElement | undefined
  let group: HTMLElement | undefined
  let container: HTMLElement | undefined
  /** The item the current press is on, picked by the group's capture-phase pointerdown. */
  let pressed: HTMLElement | undefined
  let noteLayoutChange = (): void => {}
  let pressing = (): boolean => false
  let currentFrame = (): number => 0

  /** One press's reorder data, gathered from its pointerdown until the recorder records its run. */
  interface PressData {
    readonly dragged: string
    readonly reorders: Array<ReorderEvent>
    readonly orderAtGrab: ReadonlyArray<string>
    readonly scrollAtGrab: Point
    scrolledByHand: Point
    readonly layoutAtGrab: Layout
    readonly childAtGrab: boolean
  }
  // The press being recorded, and the one before it while a new press cuts its run short:
  // the recorder records that run from its own pointerdown, after `pick` (capture) began
  // the new press, so the run takes its own press's data, not the new one's.
  let current: PressData | undefined
  let cutShort: PressData | undefined

  const scrollNow = (): Point =>
    inContainer() && container !== undefined
      ? { x: container.scrollLeft, y: container.scrollTop }
      : { x: window.scrollX, y: window.scrollY }

  const onReorder = (values: Array<string>): void => {
    current?.reorders.push({ t: performance.now(), frame: currentFrame(), order: [...values] })
    setOrder(values)
  }

  /** S: scroll the container (or the page) 60px along the list's axis. */
  const scrollBy60 = (): void => {
    const before = scrollNow()
    noteLayoutChange()
    const onX = axisOf(layout()) === "x"
    if (inContainer() && container !== undefined) container.scrollBy(onX ? 60 : 0, onX ? 0 : 60)
    else window.scrollBy(0, 60)
    const after = scrollNow()
    if (current !== undefined) current.scrolledByHand = { x: current.scrolledByHand.x + after.x - before.x, y: current.scrolledByHand.y + after.y - before.y }
  }

  const onKey = (e: KeyboardEvent): void => {
    if ((e.key === "s" || e.key === "S") && pressing()) scrollBy60()
    else if ((e.key === "m" || e.key === "M") && !pressing()) {
      const values = [...order()]
      const [first] = values.splice(0, 1)
      if (first !== undefined) setOrder([...values, first])
    }
  }

  const reorderFrame = (pointer: Point): ReorderFrame => {
    const items: Record<string, Box> = {}
    const slots: Record<string, Box> = {}
    if (group === undefined) return { items, slots, hit: null, pointerInDragged: false }
    const g = group.getBoundingClientRect()
    for (const el of group.querySelectorAll<HTMLElement>("[data-value]")) {
      const v = el.dataset.value!
      items[v] = relativeBox(el, g)
      slots[v] = { x: el.offsetLeft, y: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight }
    }
    // The items at the pointer, topmost first. The dragged item among them is there to be
    // hit (not clipped by the container there), so a sibling above it is occluding it.
    const atPointer = document
      .elementsFromPoint(pointer.x, pointer.y)
      .map((el) => el.closest<HTMLElement>("[data-value]"))
      .filter((el): el is HTMLElement => el !== null && group!.contains(el))
    const hit = atPointer[0]?.dataset.value ?? null
    const pointerInDragged = pressed !== undefined && atPointer.includes(pressed)
    return { items, slots, hit, pointerInDragged }
  }

  onMount(() => {
    // Picks the pressed item before the recorder's own pointerdown (bubbling) on the group.
    const pick = (e: PointerEvent): void => {
      // A second pointer during a press is ignored, as the recorder ignores it.
      if (pressing()) return
      const el = (e.target as Element | null)?.closest<HTMLElement>("[data-value]")
      // A press off the items records nothing (the recorder finds no item).
      pressed = el ?? undefined
      if (pressed === undefined) return
      if (current !== undefined) cutShort = current
      current = {
        dragged: pressed.dataset.value ?? "",
        reorders: [],
        orderAtGrab: order(),
        scrollAtGrab: scrollNow(),
        scrolledByHand: { x: 0, y: 0 },
        layoutAtGrab: layout(),
        childAtGrab: layoutChild(),
      }
    }
    const area = stage!
    area.addEventListener("pointerdown", pick, { capture: true, passive: true })
    const recorder = attachDragRecorder({
      stage: () => stage,
      item: () => pressed,
      pressArea: () => stage,
      children: () => ({}),
      reorderFrame,
      scroller: () => (inContainer() ? container : window),
      mode: () => `${layout()}${inContainer() ? " · container" : ""}${layoutChild() ? " · child" : ""}`,
      record: (input) => {
        const press = cutShort ?? current
        if (press === undefined) return
        if (press === cutShort) cutShort = undefined
        else current = undefined
        const axis = axisOf(press.layoutAtGrab)
        props.ctx.recordDragRun({
          ...input,
          ...(axis === "xy" ? {} : { lock: axis }),
          reorder: {
            layout: press.layoutAtGrab,
            axis,
            dragged: press.dragged,
            orderAtGrab: press.orderAtGrab,
            reorders: press.reorders,
            scrollAtGrab: press.scrollAtGrab,
            scrollAtEnd: scrollNow(),
            scrolledByHand: press.scrolledByHand,
            nodesPerItem: press.childAtGrab ? 2 : 1,
          },
        })
      },
    })
    noteLayoutChange = recorder.noteLayoutChange
    pressing = recorder.pressing
    currentFrame = recorder.currentFrame
    window.addEventListener("keydown", onKey)
    onCleanup(() => {
      recorder.detach()
      area.removeEventListener("pointerdown", pick, true)
      window.removeEventListener("keydown", onKey)
    })
  })

  const item = (value: string): JSX.Element => (
    <Reorder.Item
      value={value}
      class="box"
      data-value={value}
      data-action="drag"
      whileDrag={lift() ? LIFT : NO_LIFT}
      style={itemStyle(layout(), touchAuto())}
    >
      <Show when={layoutChild()} fallback={<>item {value}</>}>
        <wardic.p layout style={CHILD_STYLE}>
          item {value}
        </wardic.p>
      </Show>
    </Reorder.Item>
  )

  // The layout select and the layout child change the items' boxes with no size change
  // the engine's ResizeObserver could see (x / rtl / row-reverse, y / column-reverse share
  // an item size), so they are the list's layout dependency: a switch FLIPs the items to
  // their new places, as Motion's re-render would, and the next reorder reads fresh boxes.
  const list = (): JSX.Element => (
    <LayoutGroup layoutDependency={[layout(), layoutChild()]}>
      <Reorder.Group
        // eslint-disable-next-line solid/reactivity
        ref={(el: HTMLElement) => (group = el)}
        values={order()}
        onReorder={onReorder}
        style={groupStyle(layout())}
      >
        {viaMap() ? order().map((value) => item(value)) : <For each={order()}>{(value) => item(value)}</For>}
      </Reorder.Group>
    </LayoutGroup>
  )

  return (
    <div data-scenario={ID} style={ROOT_STYLE}>
      <div class="stage" ref={stage} style={STAGE_STYLE}>
        <Show when={inContainer()} fallback={list()}>
          {/* eslint-disable-next-line solid/reactivity */}
          <div ref={(el) => (container = el)} style={containerStyle(layout())}>
            {list()}
          </div>
        </Show>
      </div>
      <div style={CONTROLS_STYLE}>
        <Select label="layout" name="reorder-layout" options={LAYOUTS} value={layout()} onChange={setLayout} />
        <Checkbox label="in a scroll container" name="reorder-container" checked={inContainer()} onChange={setInContainer} />
        <Checkbox label="lift (whileDrag scale)" name="reorder-lift" checked={lift()} onChange={setLift} />
        <Checkbox label="items via .map (breaks it)" name="reorder-map" checked={viaMap()} onChange={setViaMap} />
        <Checkbox label="touch-action: auto on items (breaks touch)" name="reorder-touch" checked={touchAuto()} onChange={setTouchAuto} />
        <Checkbox label="a layout child in each item (#28)" name="reorder-child" checked={layoutChild()} onChange={setLayoutChild} />
      </div>
      <p style={NOTE_STYLE}>
        Drag an item past one neighbour, past several, and flick it. While you hold it: S scrolls the container (or the
        page) 60px; hold it near an edge to Auto-scroll. M moves the first item to the end in code.
      </p>
    </div>
  )
}

/**
 * Scenario 14, `<Reorder>` (#44): reorders by hand in six layouts, in a plain scroll
 * container or on the page, with a scroll mid-drag (S), Auto-scroll at an edge, and an
 * app-side reorder (M). Expected to be safe.
 */
export const s14: ScenarioDef = {
  id: ID,
  index: 14,
  title: "Reorder",
  kind: "drag",
  mechanism:
    "Drag an item to reorder the list, in any layout, in a scroll container or on the page. While held, S scrolls 60px; near an edge it Auto-scrolls. M moves the first item to the end in code.",
  prediction: "safe",
  rationale:
    "The group runs Motion's Crossover on each drag sample, with the neighbour on the side of the motion (so rtl " +
    "and reversed lists reorder), and waits for the item's next Measure pass after each reorder. The dragged item is " +
    "a layout drag (ADR-0016) raised while dragged; a scroll mid-drag moves the held pointer and is folded out of " +
    "every box, so nothing else in the list moves; the release FLIPs to the new slot.",
  dragExpect: {
    underPointerMaxPx: 1,
    framesBehindMax: { default: 1, microtask: 0 },
    // A reorder's pass seeds the displaced items: one on a single axis, up to the other five on a grid's line move.
    // Per item: with the layout-child toggle each item is two nodes, and the check scales by the run's nodesPerItem.
    maxSeededPerPass: 5,
    releaseHeldMax: { default: 1, microtask: 0 },
    endsOnSlotMaxPx: 0.5,
    gestureEndsMaxPx: 1,
  },
  reorderExpect: { oneStep: true, uninvolvedMaxPx: 1, raised: true },
  View,
}
