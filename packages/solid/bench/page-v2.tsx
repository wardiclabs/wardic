/**
 * `bench:solid --v2`'s page (#209): `page.tsx`'s `wardic` page on the Solid 2 binding,
 * `@wardic/solid/unstable/v2`, the same N `wardic.div`s and the same rounds, built with Solid 2's
 * compile. The runner pairs it with `page.tsx` on the same head. `?kind=retained` (#318) and
 * `?kind=retained-reorder` (#379) are `page.tsx`'s, on this binding: wards with `whileHover` and
 * `whileTap`, and `Reorder.Item`s in one `Reorder.Group`, for the runner's heap readings.
 * `?kind=layout` (#385) is `page.tsx`'s too: #383's tree of 1,331 `layout` wards and its four scenes,
 * each scene's landing the promise this binding's `animateLayout` returns.
 */
import { DomLive } from "@wardic/dom"
import { type AnimateLayout, Reorder, useAnimateLayout, wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import { render } from "@solidjs/web"
import { createSignal, flush, For, Show } from "solid-js"

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
const when = (cond: boolean, text: string): string => {
  if (cond) return text
  return ""
}

// `?kind=layout` times each frame's rAF callbacks (#385), as `page.tsx` does.
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
const pages = { wardic: Wardic, retained: Retained, "retained-reorder": RetainedReorder, layout: Layout } as const
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
/** A task's synchronous JS, a Solid 2 update applied within it: its write, then `flush()`. */
const timed = (f: () => void): number => {
  gc()
  const t0 = performance.now()
  f()
  flush()
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

const round = async () => {
  setTarget({ o: 1, c: WHITE })
  flush()
  await afterPaint()
  const first = nextFrame()
  const mount = timed(() => setShown(true))
  if (boxes().length !== n) throw new Error(`bench:solid: mounted ${boxes().length} of ${n}`)
  const firstFrame = await first
  await frames(7)
  if (!boxes().some((el) => Number(el.style.opacity) > 0 && Number(el.style.opacity) < 1)) {
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
  await frames(6)
  return { mount, firstFrame, retarget, restRetarget, unmount }
}

/** The layout page's scenes (#385), in each round's order: `page.tsx`'s. */
const SCENES = ["page", "list", "item", "scaled"] as const
type Scene = (typeof SCENES)[number]
interface LayoutScene {
  readonly measure: number
  readonly frame: number
  readonly frames: number
}
type LayoutRound = Readonly<Record<Scene, LayoutScene>>

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
  flush()
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
  let landing: Promise<unknown> = Promise.resolve()
  timing = true
  const measure = timed(() => {
    landing = run(switches[which])
  })
  await landing
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
;(globalThis as unknown as { __wardicRetained: unknown }).__wardicRetained = {
  mount: async () => {
    setShown(true)
    flush()
    await until(() => boxes().length === n && boxes().every((el) => el.style.opacity === "1"))
    await frames(10)
  },
  unmount: async () => {
    setShown(false)
    flush()
    if (boxes().length !== 0) throw new Error("bench:solid: still mounted")
    await frames(10)
  },
}

;(globalThis as unknown as { __wardicBenchSolid: unknown }).__wardicBenchSolid = async (rounds: number) => {
  await frames(5)
  if (kind === "layout") {
    await mountLayout()
    const layout: Array<LayoutRound> = []
    for (let i = 0; i < rounds; i++) layout.push(await layoutRound())
    return layout
  }
  const out: Array<Awaited<ReturnType<typeof round>>> = []
  for (let i = 0; i < rounds; i++) out.push(await round())
  return out
}
