/**
 * `bench:solid`'s page (#87, ADR-0040, decision 6): N elements, each with a numeric leg (`opacity`)
 * and a string leg (`background-color`), all following one signal's target. `?kind=wardic` is N
 * `wardic.div`s on `DomLive`; `?kind=plain` is the control: N plain `div`s whose style binds the
 * same signal, the same code on both sides of a comparison (Solid's own share).
 *
 * Per round, each timed as the synchronous JS of one task started after a paint:
 * - **mount:** `setShown(true)`, N elements' setup and 2N Leg starts.
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
 * `?kind=live` and `?kind=live-plain` (`--live`, #130): N `wardic.div`s whose `opacity` is a Live
 * value (one signal, in `style`), against N plain `div`s whose style binds the same signal. Per round:
 * the mount, then 60 frames each moving the signal from a task after a paint: **set**, that task's
 * JS (the followers' writes into the gate, or Solid's style writes), and **frame**, from the next
 * frame's first rAF callback to just after its paint (the gate's commit, then rendering), then the
 * unmount.
 */
import { DomLive } from "@wardic/dom"
import { wardic, WardicProvider } from "@wardic/solid"
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
const pages = { plain: Plain, wardic: Wardic, live: Live, "live-plain": LivePlain } as const
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

/** One round's four tasks, in ms. */
export interface Round {
  readonly mount: number
  readonly retarget: number
  readonly restRetarget: number
  readonly unmount: number
}

const round = async (): Promise<Round> => {
  setTarget({ o: 1, c: WHITE })
  await afterPaint()
  const mount = timed(() => setShown(true))
  if (boxes().length !== n) throw new Error(`bench:solid: mounted ${boxes().length} of ${n}`)
  await frames(8)
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
  return { mount, retarget, restRetarget, unmount }
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

;(globalThis as unknown as { __wardicBenchSolid: unknown }).__wardicBenchSolid = async (rounds: number): Promise<ReadonlyArray<Round | LiveRound>> => {
  await frames(5)
  const out: Array<Round | LiveRound> = []
  const one = Bool.match(kind.startsWith("live"), { onTrue: () => liveRound, onFalse: () => round })
  for (let i = 0; i < rounds; i++) out.push(await one())
  return out
}
