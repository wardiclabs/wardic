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
 */
import { DomLive } from "@wardic/dom"
import { type AnimateLayout, Reorder, useAnimateLayout, wardic, WardicProvider } from "@wardic/solid"
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
  ".item.shifted{left:24px}.badge{display:block;width:50%;height:4px;border-radius:2px;background:#222}"
document.head.append(style)

/** `text` when `cond` holds, else nothing. */
const when = (cond: boolean, text: string): string => Bool.match(cond, { onTrue: () => text, onFalse: () => "" })

// `?kind=layout` times each frame's rAF callbacks (#385): Wardic's Clock and gate read
// `requestAnimationFrame` when their Layer builds, at the first mount, so they get this one. Each
// frame's callbacks are summed by its timestamp while a scene runs. The page's own waits use `realRaf`.
let timing = false
const frameJs = new Map<number, number>()
if (kind === "layout") {
  window.requestAnimationFrame = (callback: FrameRequestCallback): number =>
    realRaf((time) => {
      const t0 = performance.now()
      try {
        callback(time)
      } finally {
        if (timing) frameJs.set(time, (frameJs.get(time) ?? 0) + performance.now() - t0)
      }
    })
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
// `?kind=layout` (#385): #383's tree, its scenes' four switches, and the hook its scenes call.
const LISTS = Array.from({ length: 10 }, (_, i) => i)
const ITEMS = Array.from({ length: 99 }, (_, i) => i)
const [padded, setPadded] = createSignal(false)
const [reversed, setReversed] = createSignal(false)
const [shifted, setShifted] = createSignal(false)
const [wide, setWide] = createSignal(false)
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
                <wardic.li class={itemClass(list, item)} layout>
                  <Show when={item % 3 === 0}>
                    <wardic.span class="badge" layout />
                  </Show>
                </wardic.li>
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
const pages = { plain: Plain, wardic: Wardic, live: Live, "live-plain": LivePlain, retained: Retained, "retained-reorder": RetainedReorder, layout: Layout } as const
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
const at = (t: Target): boolean => boxes().every((el) => el.style.opacity === String(t.o) && el.style.backgroundColor === t.c)
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
  if (kind === "wardic" && !boxes().some((el) => Number(el.style.opacity) > 0 && Number(el.style.opacity) < 1)) {
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

/** The layout page's scenes (#385), in each round's order. */
export const SCENES = ["page", "list", "item", "scaled"] as const
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

/** One scene, from a task after a paint: its `animateLayout` call, then its frames until it lands. */
const scene = async (which: Scene): Promise<LayoutScene> => {
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
  const one = Bool.match(kind.startsWith("live"), { onTrue: () => liveRound, onFalse: () => round })
  for (let i = 0; i < rounds; i++) out.push(await one())
  return out
}
