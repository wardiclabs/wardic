/**
 * `bench:solid --v2`'s page (#209): `page.tsx`'s `wardic` page on the Solid 2 binding,
 * `@wardic/solid/unstable/v2`, the same N `wardic.div`s and the same rounds, built with Solid 2's
 * compile. The runner pairs it with `page.tsx` on the same head. `?kind=retained` (#318) is `page.tsx`'s,
 * on this binding: wards with `whileHover` and `whileTap`, for the runner's heap readings.
 */
import { DomLive } from "@wardic/dom"
import { wardic, WardicProvider } from "@wardic/solid/unstable/v2"
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
style.textContent = ".b{display:inline-block;width:8px;height:8px}"
document.head.append(style)
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
const pages = { wardic: Wardic, retained: Retained } as const
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

/** `?kind=retained`'s mount, settled at rest, and its unmount, for the runner's heap readings (#318). */
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
  const out: Array<Awaited<ReturnType<typeof round>>> = []
  for (let i = 0; i < rounds; i++) out.push(await round())
  return out
}
