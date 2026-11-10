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
 */
import { DomLive } from "@wardic/dom"
import { type AnimateLayout, createAnimate, createBatch, Reorder, useAnimateLayout, wardic, type WardicAnimate, WardicProvider } from "@wardic/solid"
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
  ".g{position:relative;height:1200px}.g .b{position:absolute;left:0;top:0}"
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
const BatchGrid = () => {
  const grid = createBatch({ count: n, initial: false, animate: (i) => ({ x: xOfCell(cellOf(i, phase())), y: yOfCell(cellOf(i, phase())) }), transition: BATCH_SPRING })
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
  if (kind === "batch") {
    setPhase(p)
    return
  }
  const animate = animateEach as WardicAnimate
  boxes().forEach((el, i) => {
    animate(el, { x: xOfCell(cellOf(i, p)), y: yOfCell(cellOf(i, p)) }, transition)
  })
}

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
  "batch-animate": AnimatePage,
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
  readonly retarget: number
  readonly frame: number
}

const batchRound = async (): Promise<BatchRound> => {
  setPhase(0)
  setShown(true)
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
  return { retarget: median(retargets), frame: median(frameTimes) }
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
  if (kind.startsWith("batch")) {
    const batchOut: Array<BatchRound> = []
    for (let i = 0; i < rounds; i++) batchOut.push(await batchRound())
    return batchOut as never
  }
  const one = Bool.match(kind.startsWith("live"), { onTrue: () => liveRound, onFalse: () => round })
  for (let i = 0; i < rounds; i++) out.push(await one())
  return out
}
