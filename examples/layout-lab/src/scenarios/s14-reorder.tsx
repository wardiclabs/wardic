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
 * The card select (#136, ADR-0012 *Amendment (#136)*) puts the list (and its scroll
 * container) on a card that a transform moves, which no box should carry:
 *
 * - **draggable card**: a `drag="x"` `wardic.div` (not `layout`). Drag it by its edge
 *   between reorders; in the y list, drag an item diagonally and the card takes x while
 *   the item takes y (ADR-0019, *Amendment (#29)*).
 * - **card C moves by CSS**: C (while nothing is held) toggles a stylesheet rule's
 *   `translate` on the card, 48px across the list's axis (a row moves down, a list or
 *   grid right). Nothing tells Wardic.
 *
 * Before #136 the next pass read every item where the card had carried it and FLIPed it
 * from where the card used to be: the items flew in by the card's move (`uninvolved
 * still` fails), and in a diagonal drag the dragged item drifted off its card. On a
 * card, the drag lines read boxes relative to the card instead of the stage.
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
import { batch, createSignal, For, type JSX, Match, onCleanup, onMount, Show, Switch } from "solid-js"
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

/** The items' Layout mode (#42): `true` scales an item whose slot changes size; `position` takes the new size at once. */
type ItemLayout = "true" | "position"

const ITEM_LAYOUTS: ReadonlyArray<Option<ItemLayout>> = [
  { value: "true", label: "true" },
  { value: "position", label: "position (#42)" },
]

/**
 * With **variable sizes** (#42), an item's size by its index in the order: a list's heights, a
 * row's or grid's widths. An item a reorder moves to another index changes size with it.
 */
const VARIABLE_HEIGHTS = [36, 56, 36, 48, 56, 36]
const VARIABLE_WIDTHS = [64, 112, 64, 88, 112, 64]

/** What the list sits on (#136): the stage, a card dragged by Wardic, or a card a stylesheet rule moves. */
type Card = "none" | "drag" | "css"

const CARDS: ReadonlyArray<Option<Card>> = [
  { value: "none", label: "none" },
  { value: "drag", label: "draggable card (#136)" },
  { value: "css", label: "card C moves by CSS (#136)" },
]

const VALUES = ["a", "b", "c", "d", "e", "f"]

/** The group's axis for a layout (what the group detects). */
const axisOf = (layout: Layout): "x" | "y" | "xy" =>
  layout === "xy" ? "xy" : layout === "y" || layout === "column-reverse" ? "y" : "x"

const ROOT_STYLE: JSX.CSSProperties = { display: "flex", "flex-direction": "column", "align-items": "flex-start", gap: "8px" }
const STAGE_STYLE: JSX.CSSProperties = { "--stage-w": "460px", "--stage-h": "300px" }

/** The group: a flex list of 8px gaps, 16px in from the stage (or the container); flush on a card. */
const groupStyle = (layout: Layout, carded: boolean): JSX.CSSProperties => ({
  position: "relative",
  display: "flex",
  gap: "8px",
  margin: carded ? "0" : "16px",
  padding: "0",
  ...(layout === "rtl" ? { direction: "rtl" } : {}),
  ...(layout === "y" ? { "flex-direction": "column", width: "180px" } : {}),
  ...(layout === "column-reverse" ? { "flex-direction": "column-reverse", width: "180px" } : {}),
  ...(layout === "x" || layout === "rtl" ? { "flex-direction": "row", width: "max-content" } : {}),
  ...(layout === "row-reverse" ? { "flex-direction": "row-reverse", width: "max-content" } : {}),
  ...(layout === "xy" ? { "flex-direction": "row", "flex-wrap": "wrap", width: "304px" } : {}),
})

/**
 * An item: 180x36 in a list, 64x40 in a row, 96x40 in the grid. Whole pixels (see the recorder).
 * With variable sizes (#42), its height in a list or its width otherwise is its index's.
 */
const itemStyle = (layout: Layout, touchAuto: boolean, variableAt: number | undefined): JSX.CSSProperties => {
  const column = layout === "y" || layout === "column-reverse"
  const width = column ? 180 : layout === "xy" ? 96 : 64
  const height = column ? 36 : 40
  return {
    width: `${variableAt !== undefined && !column ? VARIABLE_WIDTHS[variableAt % VARIABLE_WIDTHS.length] : width}px`,
    height: `${variableAt !== undefined && column ? VARIABLE_HEIGHTS[variableAt % VARIABLE_HEIGHTS.length] : height}px`,
    "flex-shrink": "0",
    cursor: "grab",
    "list-style": "none",
    ...(touchAuto ? { "touch-action": "auto" } : {}),
  }
}

/** The scroll container: smaller than its list on the list's axis, so it scrolls. In flow on a card. */
const containerStyle = (layout: Layout, carded: boolean): JSX.CSSProperties => {
  const column = layout === "y" || layout === "column-reverse"
  return {
    ...(carded ? {} : { position: "absolute", left: "16px", top: "16px" }),
    overflow: "auto",
    border: "1px dashed var(--lab-border)",
    // An rtl row's container is rtl too, as in an rtl app: its scroll starts at the row's start.
    ...(layout === "rtl" ? { direction: "rtl" } : {}),
    ...(column ? { width: "220px", height: "160px" } : layout === "xy" ? { width: "336px", height: "80px" } : { width: "260px", height: "80px" }),
  }
}

/**
 * The card: 8px in from the stage, an 18px strip on top to grab it by, 6px around the
 * list. Positioned, so the drag lines can read the items' boxes relative to it.
 */
const CARD_STYLE: JSX.CSSProperties = {
  position: "absolute",
  left: "8px",
  top: "8px",
  padding: "18px 6px 6px",
  border: "1px dashed var(--lab-muted)",
  "border-radius": "6px",
  "user-select": "none",
}
const CARD_LABEL_STYLE: JSX.CSSProperties = {
  position: "absolute",
  left: "6px",
  top: "2px",
  "font-size": "10px",
  color: "var(--lab-muted)",
}

/** The axis C moves the CSS card along: across the list, so it stays in the stage. */
const crossAxisOf = (layout: Layout): "x" | "y" => (layout === "x" || layout === "rtl" || layout === "row-reverse" ? "y" : "x")

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
  // #42: the items' Layout mode, and sizes that follow an item's index.
  const [itemLayout, setItemLayout] = createSignal<ItemLayout>("true")
  const [variable, setVariable] = createSignal(false)
  const [card, setCard] = createSignal<Card>("none")
  const [cardMoved, setCardMoved] = createSignal(false)
  const [order, setOrder] = createSignal<ReadonlyArray<string>>(VALUES)

  let stage: HTMLDivElement | undefined
  let group: HTMLElement | undefined
  let container: HTMLElement | undefined
  let cardEl: HTMLElement | undefined
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
    /** The items' Layout mode and variable sizes at the grab (#42). */
    readonly itemLayoutAtGrab: ItemLayout
    readonly variableAtGrab: boolean
    /** The Lift toggle's scale at the grab, for the card's lift line (#47); undefined with Lift off. */
    readonly liftAtGrab: number | undefined
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

  /** A new card choice starts it back where it rests. */
  const chooseCard = (next: Card): void => {
    batch(() => {
      setCardMoved(false)
      setCard(next)
    })
  }

  /** What the drag lines read boxes against: the card, when the list is on one. */
  const boxesFrame = (): HTMLElement | undefined => (card() === "none" ? stage : (cardEl ?? stage))

  const onKey = (e: KeyboardEvent): void => {
    if ((e.key === "s" || e.key === "S") && pressing()) scrollBy60()
    else if ((e.key === "c" || e.key === "C") && !pressing() && card() === "css") setCardMoved((m) => !m)
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
        itemLayoutAtGrab: itemLayout(),
        variableAtGrab: variable(),
        liftAtGrab: lift() ? LIFT.scale : undefined,
      }
    }
    const area = stage!
    area.addEventListener("pointerdown", pick, { capture: true, passive: true })
    const recorder = attachDragRecorder({
      stage: boxesFrame,
      item: () => pressed,
      pressArea: () => stage,
      children: () => ({}),
      reorderFrame,
      scroller: () => (inContainer() ? container : window),
      mode: () =>
        `${layout()}${inContainer() ? " · container" : ""}${layoutChild() ? " · child" : ""}${card() === "none" ? "" : ` · ${card()} card`}${itemLayout() === "position" ? " · position" : ""}${variable() ? " · variable" : ""}`,
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
            ...(press.liftAtGrab !== undefined ? { lift: press.liftAtGrab } : {}),
            ...(press.itemLayoutAtGrab === "position" ? { itemLayout: "position" as const } : {}),
            ...(press.variableAtGrab ? { variableSizes: true } : {}),
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
      layout={itemLayout() === "position" ? "position" : true}
      whileDrag={lift() ? LIFT : NO_LIFT}
      style={itemStyle(layout(), touchAuto(), variable() ? order().indexOf(value) : undefined)}
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
    <LayoutGroup layoutDependency={[layout(), layoutChild(), variable()]}>
      <Reorder.Group
        // eslint-disable-next-line solid/reactivity
        ref={(el: HTMLElement) => (group = el)}
        values={order()}
        onReorder={onReorder}
        style={groupStyle(layout(), card() !== "none")}
      >
        {viaMap() ? order().map((value) => item(value)) : <For each={order()}>{(value) => item(value)}</For>}
      </Reorder.Group>
    </LayoutGroup>
  )

  // The list, in its scroll container when that's on.
  const content = (): JSX.Element => (
    <Show when={inContainer()} fallback={list()}>
      {/* eslint-disable-next-line solid/reactivity */}
      <div ref={(el) => (container = el)} style={containerStyle(layout(), card() !== "none")}>
        {list()}
      </div>
    </Show>
  )

  return (
    <div data-scenario={ID} style={ROOT_STYLE}>
      <div class="stage" ref={stage} style={STAGE_STYLE}>
        <Switch fallback={content()}>
          <Match when={card() === "drag"}>
            {/* eslint-disable-next-line solid/reactivity */}
            <wardic.div ref={(el: HTMLElement) => (cardEl = el)} drag="x" dragMomentum={false} style={{ ...CARD_STYLE, cursor: "grab" }}>
              <span style={CARD_LABEL_STYLE}>card: drag it by this edge</span>
              {content()}
            </wardic.div>
          </Match>
          <Match when={card() === "css"}>
            <div
              // eslint-disable-next-line solid/reactivity
              ref={(el) => (cardEl = el)}
              class="lab-s14-card"
              data-moved={cardMoved() ? crossAxisOf(layout()) : undefined}
              style={CARD_STYLE}
            >
              <span style={CARD_LABEL_STYLE}>card: C moves it</span>
              {content()}
            </div>
          </Match>
        </Switch>
      </div>
      <div style={CONTROLS_STYLE}>
        <Select label="layout" name="reorder-layout" options={LAYOUTS} value={layout()} onChange={setLayout} />
        <Checkbox label="in a scroll container" name="reorder-container" checked={inContainer()} onChange={setInContainer} />
        <Checkbox label="lift (whileDrag scale)" name="reorder-lift" checked={lift()} onChange={setLift} />
        <Checkbox label="items via .map (breaks it)" name="reorder-map" checked={viaMap()} onChange={setViaMap} />
        <Checkbox label="touch-action: auto on items (breaks touch)" name="reorder-touch" checked={touchAuto()} onChange={setTouchAuto} />
        <Checkbox label="a layout child in each item (#28)" name="reorder-child" checked={layoutChild()} onChange={setLayoutChild} />
        <Select label="item layout" name="reorder-item-layout" options={ITEM_LAYOUTS} value={itemLayout()} onChange={setItemLayout} />
        <Checkbox label="variable sizes (#42)" name="reorder-variable" checked={variable()} onChange={setVariable} />
        <Select label="card" name="reorder-card" options={CARDS} value={card()} onChange={chooseCard} />
      </div>
      <p style={NOTE_STYLE}>
        Drag an item past one neighbour, past several, and flick it. While you hold it: S scrolls the container (or the
        page) 60px; hold it near an edge to Auto-scroll. M moves the first item to the end in code. On a card (#136),
        move the card (drag its edge, or C), then reorder: nothing should fly in from where the card was.
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
    "Drag an item to reorder the list, in any layout, in a scroll container or on the page, optionally on a card a transform moves. While held, S scrolls 60px; near an edge it Auto-scrolls. M moves the first item to the end in code; C moves the CSS card.",
  prediction: "safe",
  rationale:
    "The group runs Motion's Crossover on each drag sample, with the neighbour on the side of the motion (so rtl " +
    "and reversed lists reorder), and waits for the item's next Measure pass after each reorder. The dragged item is " +
    "a layout drag (ADR-0016) raised while dragged; a scroll mid-drag moves the held pointer and is folded out of " +
    "every box, so nothing else in the list moves; the release FLIPs to the new slot. A card's transform is held " +
    "at its identity while a moved item is measured (ADR-0012, Amendment (#136)), so the card carries the list " +
    "and no item flies from where the card was.",
  dragExpect: {
    underPointerMaxPx: 1,
    framesBehindMax: 0,
    // A reorder's pass seeds the displaced items: one on a single axis, up to the other five on a grid's line move.
    // Per item: with the layout-child toggle each item is two nodes, and the check scales by the run's nodesPerItem.
    maxSeededPerPass: 5,
    releaseHeldMax: 0,
    endsOnSlotMaxPx: 0.5,
    gestureEndsMaxPx: 1,
  },
  // #42: with the items' layout `position`, each item paints at its slot's size on every frame.
  reorderExpect: { oneStep: true, uninvolvedMaxPx: 1, raised: true, noStretchMaxPx: 0.5 },
  View,
}
