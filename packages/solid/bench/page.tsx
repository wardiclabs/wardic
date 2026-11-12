/**
 * `bench:solid`'s page (#87, ADR-0040, decision 6): N elements, each with a numeric leg (`opacity`)
 * and a string leg (`background-color`), all following one signal's target. `?kind=wardic` is N
 * `wardic.div`s on `DomLive`; `?kind=plain` is the control: N plain `div`s whose style binds the
 * same signal, the same code on both sides of a comparison (Solid's own share).
 *
 * Per round, each timed as the synchronous JS of one task started after a paint:
 * - **mount:** `setShown(true)`, N elements' setup and 2N Leg starts.
 * - **firstFrame:** the frame after it, from its first rAF callback to just after its paint: the
 *   Legs' first step, the gate's first commits with each element's Starting-style switch in the
 *   binding's `batch` (#209, `--v2`), and rendering. Reported by `--v2` only.
 * - **retarget:** one signal Retargeting all N mid-flight, 2N interrupts and 2N starts.
 * - **restRetarget:** the same once every Leg has settled. It waits 90 frames, not until the
 *   colours read their target: a colour rounds to its target while its spring's tail still runs,
 *   which made #76's "at rest" a mid-flight one.
 * - **unmount:** `setShown(false)` mid-flight, 2N interrupts.
 *
 * A full GC runs before each task starts its clock (ADR-0040, *Amendment (#69)*), so a scavenge never
 * lands inside one: the runner starts Chromium with `--expose-gc`. What a side allocates is held by
 * the runner's bytes gate instead.
 *
 * `?kind=retained` (#318): N `wardic.div`s with `whileHover` and `whileTap`, so each starts its hover
 * and press recognizers at mount, animated to rest. It runs no rounds: the runner mounts and unmounts
 * it through `__wardicRetained` and reads the heap kept per element between, after forced GCs.
 * `?kind=retained-reorder` (#379) is the same for N `Reorder.Item`s in one `Reorder.Group`: each a
 * draggable layout node with its drag track and its keyboard, blur and press input, animated to rest.
 *
 * `?kind=live` and `?kind=live-plain` (`--live`, #130): N `wardic.div`s whose `opacity` is a Live
 * value (one signal, in `style`), against N plain `div`s whose style binds the same signal. Per round:
 * the mount, then 60 frames each moving the signal from a task after a paint: **set**, that task's
 * JS (the followers' writes into the gate, or Solid's style writes), and **frame**, from the next
 * frame's first rAF callback to just after its paint (the gate's commit, then rendering), then the
 * unmount.
 *
 * `?kind=layout` (#385): the projection engine's page, #383's tree of 1,331 `layout` wards (a root,
 * 10 lists of 99 items, a badge in every third item), mounted once. Per round, four scenes, each one
 * `animateLayout` run to its landing: **page** (the root's padding: everything moves), **list** (one
 * list reversed), **item** (one item's `left`) and **scaled** (the root's width doubled: every node
 * scales, and its radius and shadow are scale-corrected, #27's `scaled`). Each scene's **measure** is
 * the `animateLayout` call, its Measure pass synchronous inside it (ADR-0038); its **frame** is the
 * median of its frames' rAF callbacks, summed per frame until it lands (the coordinator's step and
 * the gate's flush), timed by a `requestAnimationFrame` this page wraps before Wardic's Clock reads
 * it. Its **frames** are how many there were.
 *
 * `--features` (#460 Q3): the `wardic` page's elements and rounds, each with one feature on both its
 * legs, its values new at every target, for what an element using it costs:
 * - `?kind=keyframes` (#457): Keyframes of three stops, the first `null` (from the Snapshot), a
 *   middle stop of the target's own, so every Retarget replays every key;
 * - `?kind=auto`: Measured pairs (#430), `height` from 0 to `auto`, then `50%` mid-flight and `auto`
 *   at rest, each measured, in a container of a fixed height (the same element, no content added);
 * - `?kind=transition-end` (#428): a `transitionEnd` of `pointer-events` with each target, set once
 *   its legs land.
 *
 * `--batch` (#665): N absolutely placed divs on a grid, sprung on `x` and `y` to swapped cells and back,
 * each change timed as a task (after a GC) and each frame's rAF callbacks summed, as the layout page's
 * are. `?kind=batch` moves them as one `createBatch`, `?kind=batch-animate` with `createAnimate`, a call
 * per element: the per-element path the Batch replaces (`.tmp/564-canvas/dom/` on `probe/564-canvas`).
 *
 * `--batch-frames`: the same grid's frames, head against base, where members are written without moving.
 * `?kind=batch` moves every member at once; `?kind=batch-stagger` staggers the moves across half a second
 * whatever N is, so most members wait out a delay through the frames measured; `?kind=batch-paused` moves the
 * grid from code, `animate(grid, …)`, and pauses partway, its frames timed while every member holds still.
 *
 * `--reorder-batch` (#712): N items in a column or a grid of 40 columns (`?layout=`), `?kind=reorder-batch`
 * a `Reorder.BatchGroup` and `?kind=reorder-group` a `Reorder.Group` of `Reorder.Item`s at the same places.
 * Per round: the mount to its first paint, then a drag the page drives, a pointer event at the start of
 * each frame, the item held moved five places in 30 moves, each move's frame timed to just after its
 * paint, then checked: the order has it five places on, and its element landed there.
 */
import { DomLive } from "@wardic/dom"
import {
  type AnimateLayout,
  createAnimate,
  createBatch,
  Reorder,
  stagger,
  useAnimateLayout,
  wardic,
  type WardicAnimate,
  type WardicPlaybackControls,
  WardicProvider,
} from "@wardic/solid"
import { createSignal, For, Show } from "solid-js"
import { render } from "solid-js/web"
import * as Bool from "effect/Boolean"

const realRaf = window.requestAnimationFrame.bind(window)
const WHITE = "rgb(255, 255, 255)"
const BLUE = "rgb(0, 0, 255)"
const RED = "rgb(255, 0, 0)"

interface Target {
  readonly o: number
  readonly c: string
}

/** A feature page's values for a target (`--features`): its middle Keyframes stops, its `height`, its `transitionEnd`. */
interface Extras {
  readonly mo: number
  readonly mc: string
  readonly h: string
  readonly pe: "auto" | "none"
}
const EXTRAS: Readonly<Record<string, Extras>> = {
  [WHITE]: { mo: 0.6, mc: "rgb(255, 255, 0)", h: "auto", pe: "auto" },
  [BLUE]: { mo: 0.9, mc: "rgb(0, 255, 0)", h: "50%", pe: "none" },
  [RED]: { mo: 0.7, mc: "rgb(255, 0, 255)", h: "auto", pe: "auto" },
}
const extras = (t: Target): Extras => EXTRAS[t.c]!

const params = new URLSearchParams(location.search)
const n = Number(params.get("n") ?? "1000")
const kind = params.get("kind") ?? "wardic"
const [shown, setShown] = createSignal(false)
const [target, setTarget] = createSignal<Target>({ o: 1, c: WHITE })
const [live, setLive] = createSignal(0.5)
const items = Array.from({ length: n }, (_, i) => i)

const style = document.createElement("style")
style.textContent =
  ".b{display:inline-block;width:8px;height:8px}" +
  // The layout page's tree: widths in percent, so doubling the root's scales every node.
  ".root{width:400px}.root.wide{width:800px}.root.padded{padding:16px}" +
  ".list{display:flex;flex-wrap:wrap;width:100%;margin:0;padding:0;list-style:none}" +
  ".item{position:relative;width:9%;height:8px;margin:1px;border-radius:2px;box-shadow:0 1px 1px rgb(0 0 0 / 0.2);background:#888}" +
  ".item.shifted{left:24px}.badge{display:block;width:50%;height:4px;border-radius:2px;background:#222}" +
  // The `auto` page: a container `50%` resolves against (12px; `auto` is 0, the elements being empty).
  ".fp{height:24px;overflow:hidden}" +
  // The batch pages' grid (#665): every div placed by its transform alone.
  ".g{position:relative;height:1200px}.g .b{position:absolute;left:0;top:0}" +
  // The reorder pages' lists (#712): `Reorder.Group`'s laid out by CSS grid at the Batch group's places.
  ".rl{margin:0;padding:0;list-style:none}.ri{background:#888}" +
  ".rg{display:grid;gap:4px;grid-template-columns:120px;grid-auto-rows:16px}.rg.grid{grid-template-columns:repeat(40,16px)}"
document.head.append(style)

/** `text` when `cond` holds, else nothing. */
const when = (cond: boolean, text: string): string => Bool.match(cond, { onTrue: () => text, onFalse: () => "" })

// `?kind=layout` times each frame's rAF callbacks (#385): Wardic's Clock and gate read
// `requestAnimationFrame` when their Layer builds, at the first mount, so they get this one. Each
// frame's callbacks are summed by its timestamp while a scene runs. The page's own waits use `realRaf`.
let timing = false
const frameJs = new Map<number, number>()
// The own-size scene (#504) counts the ResizeObserver's deliveries too, each with the microtasks it
// queues (the Measure pass a delivery schedules runs in one), under the frame they follow. The other
// scenes count the rAF callbacks alone, as they always have.
let timingObserver = false
let currentFrame = 0
const addFrameJs = (frame: number, ms: number): void => {
  if (timing) frameJs.set(frame, (frameJs.get(frame) ?? 0) + ms)
}
if (Bool.or(kind === "layout", kind.startsWith("batch"))) {
  window.requestAnimationFrame = (callback: FrameRequestCallback): number =>
    realRaf((time) => {
      currentFrame = time
      const t0 = performance.now()
      try {
        callback(time)
      } finally {
        addFrameJs(time, performance.now() - t0)
      }
    })
  const RealObserver = window.ResizeObserver
  window.ResizeObserver = class extends RealObserver {
    constructor(callback: ResizeObserverCallback) {
      super((entries, observer) => {
        const frame = currentFrame
        const t0 = performance.now()
        try {
          callback(entries, observer)
        } finally {
          if (timingObserver) queueMicrotask(() => addFrameJs(frame, performance.now() - t0))
        }
      })
    }
  }
}
const host = document.createElement("div")
document.body.append(host)
const Wardic = () => (
  <WardicProvider env={DomLive}>
    <Show when={shown()}>
      <For each={items}>
        {() => (
          <wardic.div
            class="b"
            initial={{ opacity: 0, "background-color": "rgb(0, 0, 0)" }}
            animate={{ opacity: target().o, "background-color": target().c }}
          />
        )}
      </For>
    </Show>
  </WardicProvider>
)
const Keyframes = () => (
  <WardicProvider env={DomLive}>
    <Show when={shown()}>
      <For each={items}>
        {() => (
          <wardic.div
            class="b"
            initial={{ opacity: 0, "background-color": "rgb(0, 0, 0)" }}
            animate={{ opacity: [null, extras(target()).mo, target().o], "background-color": [null, extras(target()).mc, target().c] }}
          />
        )}
      </For>
    </Show>
  </WardicProvider>
)
const Auto = () => (
  <WardicProvider env={DomLive}>
    <Show when={shown()}>
      <div class="fp">
        <For each={items}>
          {() => (
            <wardic.div
              class="b"
              initial={{ opacity: 0, "background-color": "rgb(0, 0, 0)", height: 0 }}
              animate={{ opacity: target().o, "background-color": target().c, height: extras(target()).h }}
            />
          )}
        </For>
      </div>
    </Show>
  </WardicProvider>
)
const TransitionEnd = () => (
  <WardicProvider env={DomLive}>
    <Show when={shown()}>
      <For each={items}>
        {() => (
          <wardic.div
            class="b"
            initial={{ opacity: 0, "background-color": "rgb(0, 0, 0)" }}
            animate={{ opacity: target().o, "background-color": target().c, transitionEnd: { "pointer-events": extras(target()).pe } }}
          />
        )}
      </For>
    </Show>
  </WardicProvider>
)
const Plain = () => (
  <Show when={shown()}>
    <For each={items}>{() => <div class="b" style={{ opacity: String(target().o), "background-color": target().c }} />}</For>
  </Show>
)
const Live = () => (
  <WardicProvider env={DomLive}>
    <Show when={shown()}>
      <For each={items}>{() => <wardic.div class="b" style={{ opacity: live, "background-color": BLUE }} />}</For>
    </Show>
  </WardicProvider>
)
const LivePlain = () => (
  <Show when={shown()}>
    <For each={items}>{() => <div class="b" style={{ opacity: String(live()), "background-color": BLUE }} />}</For>
  </Show>
)
const Retained = () => (
  <WardicProvider env={DomLive}>
    <Show when={shown()}>
      <For each={items}>
        {() => <wardic.div class="b" initial={{ opacity: 0 }} animate={{ opacity: 1 }} whileHover={{ opacity: 0.9 }} whileTap={{ opacity: 0.8 }} />}
      </For>
    </Show>
  </WardicProvider>
)
const RetainedReorder = () => (
  <WardicProvider env={DomLive}>
    <Show when={shown()}>
      <Reorder.Group values={items} onReorder={() => undefined}>
        <For each={items}>{(item) => <Reorder.Item value={item} class="b" initial={{ opacity: 0 }} animate={{ opacity: 1 }} />}</For>
      </Reorder.Group>
    </Show>
  </WardicProvider>
)
// `--batch` (#665): each div's cell in a phase, the cells swapped end for end at each change.
const [phase, setPhase] = createSignal(0)
const COLUMNS = 40
const cellOf = (i: number, p: number): number => Bool.match(p === 0, { onTrue: () => i, onFalse: () => n - 1 - i })
const xOfCell = (cell: number): number => (cell % COLUMNS) * 10
const yOfCell = (cell: number): number => Math.floor(cell / COLUMNS) * 10
const BATCH_SPRING = { type: "spring", stiffness: 210, damping: 20 } as const
// `?kind=batch-gestures` (#665's PR 5, Q61's S5): the same Batch with `whileHover` and `whileTap`, which
// listen from one source, so its mount, changes and frames cost what the plain Batch's do. Their values
// are on its own keys: a key of theirs it doesn't have would join them, a third key to step and draw.
const GESTURES = { whileHover: { y: -4 }, whileTap: { x: 0 } } as const
// `?kind=batch-stagger` (`--batch-frames`): its moves staggered across half a second whatever N is, so most
// members wait out a delay through the 20 frames measured.
const STAGGER_SPREAD = 0.5
const STAGGERED = { ...BATCH_SPRING, delay: stagger(STAGGER_SPREAD / n) }
// `?kind=batch-paused` (`--batch-frames`): the grid moved to phase `p` from code, with the call's controls.
let animateGrid: ((p: number) => WardicPlaybackControls) | undefined
const BatchGrid = () => {
  const gestures = Bool.match(kind === "batch-gestures", { onTrue: () => GESTURES, onFalse: () => ({}) })
  const transition = Bool.match(kind === "batch-stagger", { onTrue: () => STAGGERED, onFalse: () => BATCH_SPRING })
  const grid = createBatch({ count: n, initial: false, animate: (i) => ({ x: xOfCell(cellOf(i, phase())), y: yOfCell(cellOf(i, phase())) }), transition, ...gestures })
  if (kind === "batch-paused") {
    const [, animate] = createAnimate()
    animateGrid = (p) => animate(grid, { x: (i) => xOfCell(cellOf(i, p)), y: (i) => yOfCell(cellOf(i, p)) }, BATCH_SPRING)
  }
  return <For each={items}>{(i) => <div class="b" {...grid.at(i)} />}</For>
}
const BatchPage = () => (
  <WardicProvider env={DomLive}>
    <Show when={shown()}>
      <div class="g">
        <BatchGrid />
      </div>
    </Show>
  </WardicProvider>
)
// `?kind=batch-animate`: the same moves, an `animate` call per element.
let animateEach: WardicAnimate | undefined
const AnimateGrid = () => {
  const [scope, animate] = createAnimate()
  animateEach = animate
  return (
    <div class="g" ref={scope}>
      <For each={items}>{() => <div class="b" />}</For>
    </div>
  )
}
const AnimatePage = () => (
  <WardicProvider env={DomLive}>
    <Show when={shown()}>
      <AnimateGrid />
    </Show>
  </WardicProvider>
)
/** A change to phase `p`: the Batch's, by its signal; the per-element page's, a call per element. */
const moveTo = (p: number, transition: { readonly duration: number } | typeof BATCH_SPRING): void => {
  if (Bool.some([kind === "batch", kind === "batch-gestures", kind === "batch-stagger"])) {
    setPhase(p)
    return
  }
  const animate = animateEach as WardicAnimate
  boxes().forEach((el, i) => {
    animate(el, { x: xOfCell(cellOf(i, p)), y: yOfCell(cellOf(i, p)) }, transition)
  })
}

// `--reorder-batch` (#712, ADR-0072 decision 11): N items in a column (`?layout=column`) or a grid of 40
// columns (`?layout=grid`), reordered by a drag. `?kind=reorder-batch` is a `Reorder.BatchGroup`,
// `?kind=reorder-group` a `Reorder.Group` of `Reorder.Item`s with its `axis` given, laid out by CSS grid at
// the same size and gap: the same places, and the same spring.
const reorderGrid = params.get("layout") === "grid"
const REORDER_COLUMNS = 40
const REORDER_GAP = 4
const REORDER_SIZE = Bool.match(reorderGrid, { onTrue: () => ({ width: 16, height: 16 }), onFalse: () => ({ width: 120, height: 16 }) })
const REORDER_AXIS = Bool.match(reorderGrid, { onTrue: () => "xy" as const, onFalse: () => "y" as const })
const REORDER_SPRING = { type: "spring", stiffness: 400, damping: 40 } as const
const [order, setOrder] = createSignal<ReadonlyArray<number>>(items)
const reorderValues = (values: Array<number>): void => {
  setOrder(values)
}
const ReorderBatchPage = () => (
  <WardicProvider env={DomLive}>
    <Show when={shown()}>
      <Reorder.BatchGroup
        class="rl"
        values={order()}
        onReorder={reorderValues}
        axis={REORDER_AXIS}
        itemSize={REORDER_SIZE}
        gap={REORDER_GAP}
        columns={REORDER_COLUMNS}
        transition={REORDER_SPRING}
      >
        <For each={order()}>{(value) => <Reorder.BatchItem class="ri" value={value} />}</For>
      </Reorder.BatchGroup>
    </Show>
  </WardicProvider>
)
const ReorderGroupPage = () => (
  <WardicProvider env={DomLive}>
    <Show when={shown()}>
      <Reorder.Group class={`rl rg${when(reorderGrid, " grid")}`} values={order()} onReorder={reorderValues} axis={REORDER_AXIS}>
        <For each={order()}>{(value) => <Reorder.Item class="ri" value={value} transition={REORDER_SPRING} />}</For>
      </Reorder.Group>
    </Show>
  </WardicProvider>
)

// `?kind=layout` (#385): #383's tree, its scenes' four switches, and the hook its scenes call.
const LISTS = Array.from({ length: 10 }, (_, i) => i)
const ITEMS = Array.from({ length: 99 }, (_, i) => i)
const [padded, setPadded] = createSignal(false)
const [reversed, setReversed] = createSignal(false)
const [shifted, setShifted] = createSignal(false)
const [wide, setWide] = createSignal(false)
// The own-size scene's item (#504): list 0's first, a badge in it, its width drawn by its own legs.
// In percent, as `.item`'s is, so every other scene lays it out as before.
const [grown, setGrown] = createSignal(false)
const OWN_SIZE = { type: "tween", ease: "linear", duration: 0.5 } as const
const ownWidth = (): string => Bool.match(grown(), { onTrue: () => "20%", onFalse: () => "9%" })
let animateLayout: AnimateLayout | undefined
const orderOf = (list: number): ReadonlyArray<number> => {
  if (list === 0 && reversed()) return [...ITEMS].reverse()
  return ITEMS
}
const rootClass = (): string => `root${when(wide(), " wide")}${when(padded(), " padded")}`
const itemClass = (list: number, item: number): string => `item${when(list === 5 && item === 0 && shifted(), " shifted")}`
const LayoutTree = () => {
  animateLayout = useAnimateLayout()
  return (
    <wardic.div class={rootClass()} layout>
      <For each={LISTS}>
        {(list) => (
          <wardic.ul class="list" layout>
            <For each={orderOf(list)}>
              {(item) => (
                <Show
                  when={list === 0 && item === 0}
                  fallback={
                    <wardic.li class={itemClass(list, item)} layout>
                      <Show when={item % 3 === 0}>
                        <wardic.span class="badge" layout />
                      </Show>
                    </wardic.li>
                  }
                >
                  <wardic.li class={itemClass(list, item)} data-own-size layout animate={{ width: ownWidth() }} transition={OWN_SIZE}>
                    <wardic.span class="badge" layout />
                  </wardic.li>
                </Show>
              )}
            </For>
          </wardic.ul>
        )}
      </For>
    </wardic.div>
  )
}
const Layout = () => (
  <WardicProvider env={DomLive}>
    <Show when={shown()}>
      <LayoutTree />
    </Show>
  </WardicProvider>
)
const pages = {
  plain: Plain,
  wardic: Wardic,
  keyframes: Keyframes,
  auto: Auto,
  "transition-end": TransitionEnd,
  live: Live,
  "live-plain": LivePlain,
  retained: Retained,
  "retained-reorder": RetainedReorder,
  layout: Layout,
  batch: BatchPage,
  "batch-gestures": BatchPage,
  "batch-stagger": BatchPage,
  "batch-paused": BatchPage,
  "batch-animate": AnimatePage,
  "reorder-batch": ReorderBatchPage,
  "reorder-group": ReorderGroupPage,
} as const
render(() => {
  const Page = pages[kind as keyof typeof pages]
  return <Page />
}, host)

const frames = (k: number): Promise<void> =>
  new Promise((resolve) => {
    let i = 0
    const f = (): void => {
      if (++i >= k) resolve()
      else realRaf(f)
    }
    realRaf(f)
  })
const afterPaint = (): Promise<void> => new Promise((resolve) => realRaf(() => setTimeout(resolve, 0)))
const exposedGc = (globalThis as { gc?: () => void }).gc
if (exposedGc === undefined) throw new Error("bench:solid: the page needs Chromium's --js-flags=--expose-gc")
const gc: () => void = exposedGc
const timed = (f: () => void): number => {
  gc()
  const t0 = performance.now()
  f()
  return performance.now() - t0
}
const boxes = (): ReadonlyArray<HTMLElement> => [...host.querySelectorAll<HTMLElement>(".b")]
/** A feature page's own landing, beside its legs' (`--features`): the height given, and the `transitionEnd` set. */
const LANDED: Readonly<Record<string, (el: HTMLElement, t: Target) => boolean>> = {
  auto: (el, t) => el.style.height === extras(t).h,
  "transition-end": (el, t) => el.style.pointerEvents === extras(t).pe,
}
const landed = LANDED[kind] ?? (() => true)
const at = (t: Target): boolean => boxes().every((el) => el.style.opacity === String(t.o) && el.style.backgroundColor === t.c && landed(el, t))
const until = async (done: () => boolean, timeoutMs = 10000): Promise<void> => {
  const end = performance.now() + timeoutMs
  while (!done()) {
    if (performance.now() > end) throw new Error("bench:solid: timed out")
    await frames(1)
  }
}

/** One round's tasks, in ms. */
export interface Round {
  readonly mount: number
  readonly firstFrame: number
  readonly retarget: number
  readonly restRetarget: number
  readonly unmount: number
}

const round = async (): Promise<Round> => {
  setTarget({ o: 1, c: WHITE })
  await afterPaint()
  // The frame's rAF first, then the mount, so the frame is timed from before the Clock's tick.
  const first = nextFrame()
  const mount = timed(() => setShown(true))
  if (boxes().length !== n) throw new Error(`bench:solid: mounted ${boxes().length} of ${n}`)
  const firstFrame = await first
  await frames(7)
  if (kind !== "plain" && !boxes().some((el) => Number(el.style.opacity) > 0 && Number(el.style.opacity) < 1)) {
    throw new Error("bench:solid: not mid-flight at the Retarget")
  }
  await afterPaint()
  const retarget = timed(() => setTarget({ o: 0.5, c: BLUE }))
  await until(() => at({ o: 0.5, c: BLUE }))
  await frames(90)
  await afterPaint()
  const restRetarget = timed(() => setTarget({ o: 0.2, c: RED }))
  await frames(5)
  await afterPaint()
  const unmount = timed(() => setShown(false))
  if (boxes().length !== 0) throw new Error("bench:solid: still mounted")
  // The loop drops its Clock subscription, and the Clock idles, before the next round's mount.
  await frames(6)
  return { mount, firstFrame, retarget, restRetarget, unmount }
}

/** One `--batch` round (#665), in ms: its two changes' tasks, and the median frame's rAF callbacks while they fly. */
export interface BatchRound {
  readonly mount: number
  readonly retarget: number
  readonly frame: number
}

const batchRound = async (): Promise<BatchRound> => {
  setPhase(0)
  // Timed without the collection `timed` runs first: one before the mount moved the change's time after it
  // (0.35 → 0.69 ms on Chromium, #665's PR 5), by where the mount's objects then lived.
  const mountStart = performance.now()
  setShown(true)
  const mount = performance.now() - mountStart
  if (boxes().length !== n) throw new Error(`bench:solid: mounted ${boxes().length} of ${n}`)
  await frames(2)
  // The per-element page starts each div at its first cell, as the Batch's start there.
  if (kind === "batch-animate") moveTo(0, { duration: 0 })
  await frames(10)
  const retargets: Array<number> = []
  const frameTimes: Array<number> = []
  for (const p of [1, 0]) {
    await afterPaint()
    frameJs.clear()
    timing = true
    retargets.push(timed(() => moveTo(p, BATCH_SPRING)))
    await frames(24)
    timing = false
    // The frames in flight: the first 20 after the change.
    frameTimes.push(...[...frameJs.values()].slice(0, 20))
    await frames(90)
  }
  // Back at its first cell, the first div is at the origin.
  const first = boxes()[0]!
  if (first.style.transform !== "none") throw new Error(`bench:solid: the first div landed at ${first.style.transform}`)
  setShown(false)
  await frames(6)
  return { mount, retarget: median(retargets), frame: median(frameTimes) }
}

/**
 * One `?kind=batch-paused` round (`--batch-frames`), in ms: two changes from code, `animate(grid, …)`, each
 * timed as a task, and the median frame's rAF callbacks while each is paused partway, every member still.
 */
const batchPausedRound = async (): Promise<BatchRound> => {
  setPhase(0)
  const mountStart = performance.now()
  setShown(true)
  const mount = performance.now() - mountStart
  if (boxes().length !== n) throw new Error(`bench:solid: mounted ${boxes().length} of ${n}`)
  await frames(12)
  const retargets: Array<number> = []
  const frameTimes: Array<number> = []
  for (const p of [1, 0]) {
    await afterPaint()
    let controls!: WardicPlaybackControls
    retargets.push(
      timed(() => {
        controls = animateGrid!(p)
      }),
    )
    // Under way, then paused: every member holds where it is.
    await frames(4)
    controls.pause()
    await afterPaint()
    frameJs.clear()
    timing = true
    await frames(24)
    timing = false
    frameTimes.push(...[...frameJs.values()].slice(0, 20))
    controls.complete()
    await frames(30)
  }
  // Completed back at its first cell, the first div is at the origin.
  const first = boxes()[0]!
  if (first.style.transform !== "none") throw new Error(`bench:solid: the first div landed at ${first.style.transform}`)
  setShown(false)
  await frames(6)
  return { mount, retarget: median(retargets), frame: median(frameTimes) }
}

/**
 * One `--reorder-batch` round (#712), in ms: the **mount** to its first paint (its task and the microtasks it
 * queues, then the frame after it, from its first rAF callback to just after its paint), and the drag's frames, each from its
 * first rAF callback (where the page moves the pointer) to just after its paint: their **frame** mean,
 * a crossover's Measure pass included, and the **longest**.
 */
export interface ReorderRound {
  readonly mount: number
  readonly frame: number
  readonly longest: number
}

/** The item held: the sixteenth in a column, row 10's eleventh in the grid, mid-viewport, clear of its edges. */
const HELD = Bool.match(reorderGrid, { onTrue: () => 10 * REORDER_COLUMNS + 10, onFalse: () => 15 })
/** How far the drag goes: five places, along the column or the row. */
const PLACES = 5
const DRAG_MOVES = 30
const reorderItems = (): ReadonlyArray<HTMLElement> => [...host.querySelectorAll<HTMLElement>(".ri")]
const pointerAt = (target: Element, type: string, x: number, y: number, buttons: number): void => {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: Bool.match(type === "pointermove", { onTrue: () => -1, onFalse: () => 0 }),
      buttons,
      clientX: x,
      clientY: y,
    }),
  )
}

/**
 * A drag of `target` by `(dx, dy)`, one pointer event at the start of each frame, as Chromium delivers a
 * real pointer's: down, `DRAG_MOVES` moves, up. Each move's frame is timed from that rAF callback, which
 * runs before Wardic's (requested first, it stays first), to just after its paint.
 */
const dragFrames = (target: Element, x: number, y: number, dx: number, dy: number): Promise<ReadonlyArray<number>> =>
  new Promise((resolve) => {
    const out: Array<number> = []
    let step = 0
    const frame = (): void => {
      const start = performance.now()
      if (step === DRAG_MOVES + 1) {
        pointerAt(target, "pointerup", x + dx, y + dy, 0)
        resolve(out)
        return
      }
      realRaf(frame)
      if (step === 0) pointerAt(target, "pointerdown", x, y, 1)
      else {
        const along = step / DRAG_MOVES
        pointerAt(target, "pointermove", x + dx * along, y + dy * along, 1)
        const channel = new MessageChannel()
        channel.port1.onmessage = () => {
          channel.port1.close()
          out.push(performance.now() - start)
        }
        channel.port2.postMessage(undefined)
      }
      step++
    }
    realRaf(frame)
  })

/**
 * `mount`, timed to its first paint, in ms: from its start through the microtasks it queues (a group's first
 * read of its element among them), to the next task or the next frame, whichever runs first, so no idle wait
 * counts; then that frame, from its first rAF callback, requested before the mount's, to just after its paint.
 */
const mountToPaint = (mount: () => void): Promise<number> =>
  new Promise((resolve) => {
    let start = 0
    let settled = 0
    let frameStart = 0
    const next = new MessageChannel()
    next.port1.onmessage = () => {
      next.port1.close()
      if (settled === 0) settled = performance.now()
    }
    const painted = new MessageChannel()
    painted.port1.onmessage = () => {
      painted.port1.close()
      resolve(settled - start + (performance.now() - frameStart))
    }
    realRaf(() => {
      frameStart = performance.now()
      if (settled === 0) settled = frameStart
      painted.port2.postMessage(undefined)
    })
    gc()
    start = performance.now()
    next.port2.postMessage(undefined)
    mount()
  })

const reorderRound = async (): Promise<ReorderRound> => {
  setOrder(items)
  await afterPaint()
  const mount = await mountToPaint(() => setShown(true))
  if (reorderItems().length !== n) throw new Error(`bench:solid: mounted ${reorderItems().length} of ${n}`)
  await frames(30)
  const held = reorderItems()[HELD]!
  const from = held.getBoundingClientRect()
  const step = Bool.match(reorderGrid, { onTrue: () => ({ x: PLACES * 20, y: 0 }), onFalse: () => ({ x: 0, y: PLACES * 20 }) })
  const drag = await dragFrames(held, from.left + from.width / 2, from.top + from.height / 2, step.x, step.y)
  await frames(90)
  // The drag moved the item held five places, and it landed there.
  if (order()[HELD + PLACES] !== HELD) throw new Error(`bench:solid: the item held is at ${order().indexOf(HELD)}, not ${HELD + PLACES}`)
  const to = held.getBoundingClientRect()
  if (Math.hypot(to.left - from.left - step.x, to.top - from.top - step.y) > 0.5) {
    throw new Error(`bench:solid: the item held landed at ${to.left - from.left},${to.top - from.top}, not ${step.x},${step.y}`)
  }
  setShown(false)
  await frames(6)
  return { mount, frame: drag.reduce((sum, ms) => sum + ms, 0) / drag.length, longest: Math.max(...drag) }
}

/** One `--live` round's tasks, in ms: the mount and unmount, and the median set and frame. */
export interface LiveRound {
  readonly mount: number
  readonly set: number
  readonly frame: number
  readonly unmount: number
}

/** Resolve just after the next paint, with when that frame's first rAF callback ran. */
const nextFrame = (): Promise<number> =>
  new Promise((resolve) => {
    const channel = new MessageChannel()
    let start = 0
    channel.port1.onmessage = () => {
      channel.port1.close()
      resolve(performance.now() - start)
    }
    realRaf(() => {
      start = performance.now()
      channel.port2.postMessage(undefined)
    })
  })

const liveRound = async (): Promise<LiveRound> => {
  setLive(0.5)
  await afterPaint()
  const mount = timed(() => setShown(true))
  if (boxes().length !== n) throw new Error(`bench:solid: mounted ${boxes().length} of ${n}`)
  await frames(8)
  await afterPaint()
  const sets: Array<number> = []
  const frameTimes: Array<number> = []
  for (let i = 0; i < 60; i++) {
    const v = (30 + 2 * (i % 20)) / 100
    // This frame's rAF first, then the set, so the frame is timed from before the gate's commit.
    const frame = nextFrame()
    sets.push(timed(() => setLive(v)))
    frameTimes.push(await frame)
    if (Math.abs(Number(boxes()[0]!.style.opacity) - v) > 1e-6) throw new Error(`bench:solid: opacity ${boxes()[0]!.style.opacity}, not ${v}`)
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  await afterPaint()
  const unmount = timed(() => setShown(false))
  await frames(6)
  const mid = (xs: ReadonlyArray<number>): number => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)]!
  return { mount, set: mid(sets), frame: mid(frameTimes), unmount }
}

/**
 * The layout page's scenes (#385), in each round's order. `own-size` (#504): an item with a layout child
 * animates its own width, no layout change, its frames counted with the observer's deliveries.
 */
export const SCENES = ["page", "list", "item", "scaled", "own-size"] as const
export type Scene = (typeof SCENES)[number]
/** One scene: its `animateLayout` call and its frames' median, in ms, and how many frames it took. */
export interface LayoutScene {
  readonly measure: number
  readonly frame: number
  readonly frames: number
}
export type LayoutRound = Readonly<Record<Scene, LayoutScene>>

const switches: Readonly<Record<Scene, () => void>> = {
  page: () => setPadded(!padded()),
  list: () => setReversed(!reversed()),
  item: () => setShifted(!shifted()),
  scaled: () => setWide(!wide()),
  "own-size": () => setGrown(!grown()),
}
const median = (xs: ReadonlyArray<number>): number => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)]!
const layoutNodes = (): number => host.querySelectorAll(".root, .list, .item, .badge").length

/** Mount the tree once, landed and idle, before the rounds (and before the runner's heap sampling). */
const mountLayout = async (): Promise<void> => {
  if (shown()) return
  setShown(true)
  if (layoutNodes() !== 1331) throw new Error(`bench:solid: the layout page has ${layoutNodes()} nodes, not 1,331`)
  await frames(10)
}
;(globalThis as unknown as { __wardicLayoutMount: () => Promise<void> }).__wardicLayoutMount = mountLayout

/** The own-size scene (#504): its width set, then its frames until it lands and the observer has delivered it. */
const ownSizeScene = async (): Promise<LayoutScene> => {
  const item = host.querySelector<HTMLElement>("[data-own-size]")
  if (item === null) throw new Error("bench:solid: the layout page has no own-size item")
  await afterPaint()
  frameJs.clear()
  timing = true
  timingObserver = true
  const measure = timed(switches["own-size"])
  const target = ownWidth()
  await until(() => item.style.width === target)
  await frames(3)
  timing = false
  timingObserver = false
  const times = [...frameJs.values()]
  if (times.length < 5) throw new Error(`bench:solid: the layout scene own-size ran ${times.length} frames`)
  return { measure, frame: median(times), frames: times.length }
}

/** One scene, from a task after a paint: its `animateLayout` call, then its frames until it lands. */
const scene = async (which: Scene): Promise<LayoutScene> => {
  if (which === "own-size") return ownSizeScene()
  const run = animateLayout
  if (run === undefined) throw new Error("bench:solid: the layout page isn't mounted")
  await afterPaint()
  frameJs.clear()
  let landed = false
  timing = true
  const measure = timed(() =>
    run(switches[which], {
      onSettled: () => {
        landed = true
      },
    }),
  )
  await until(() => landed)
  timing = false
  const times = [...frameJs.values()]
  if (times.length < 5) throw new Error(`bench:solid: the layout scene ${which} ran ${times.length} frames`)
  return { measure, frame: median(times), frames: times.length }
}

const layoutRound = async (): Promise<LayoutRound> => {
  const out: Partial<Record<Scene, LayoutScene>> = {}
  for (const which of SCENES) out[which] = await scene(which)
  return out as LayoutRound
}

/** `?kind=retained`'s and `?kind=retained-reorder`'s mount, settled at rest, and unmount, for the runner's heap readings (#318, #379). */
export interface RetainedPage {
  readonly mount: () => Promise<void>
  readonly unmount: () => Promise<void>
}
const retained: RetainedPage = {
  mount: async () => {
    setShown(true)
    await until(() => Bool.and(boxes().length === n, boxes().every((el) => el.style.opacity === "1")))
    await frames(10)
  },
  unmount: async () => {
    setShown(false)
    if (boxes().length !== 0) throw new Error("bench:solid: still mounted")
    await frames(10)
  },
}
;(globalThis as unknown as { __wardicRetained: RetainedPage }).__wardicRetained = retained

;(globalThis as unknown as { __wardicBenchSolid: unknown }).__wardicBenchSolid = async (rounds: number): Promise<ReadonlyArray<Round | LiveRound | LayoutRound>> => {
  await frames(5)
  const out: Array<Round | LiveRound | LayoutRound> = []
  if (kind === "layout") {
    await mountLayout()
    for (let i = 0; i < rounds; i++) out.push(await layoutRound())
    return out
  }
  if (kind.startsWith("reorder")) {
    const reorderOut: Array<ReorderRound> = []
    for (let i = 0; i < rounds; i++) reorderOut.push(await reorderRound())
    return reorderOut as never
  }
  if (kind.startsWith("batch")) {
    const batchOut: Array<BatchRound> = []
    const oneBatch = Bool.match(kind === "batch-paused", { onTrue: () => batchPausedRound, onFalse: () => batchRound })
    for (let i = 0; i < rounds; i++) batchOut.push(await oneBatch())
    return batchOut as never
  }
  const one = Bool.match(kind.startsWith("live"), { onTrue: () => liveRound, onFalse: () => round })
  for (let i = 0; i < rounds; i++) out.push(await one())
  return out
}
