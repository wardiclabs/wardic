/**
 * The timing every page of `bench:motion` shares (#325, #519, #615): Wardic on each Solid against Motion's React build.
 * Per round, as `bench:solid`'s page: a mount, a Retarget mid-flight, one at rest, an unmount, each
 * the synchronous JS of one task started after a paint, a full GC before it. And, since Motion starts
 * its animations at its next frame where Wardic starts them in the task: the frame after each task,
 * and the median frame while every element animates, each from its frame's first rAF callback (this
 * page's, requested ahead of any library's) to just after its paint (a `MessageChannel` message).
 */
const realRaf = window.requestAnimationFrame.bind(window)

export interface Round {
  readonly mount: number
  readonly mountGap: number
  readonly mountFrame: number
  readonly mountFrame2: number
  readonly flight: number
  readonly retarget: number
  readonly retargetGap: number
  readonly retargetFrame: number
  readonly retargetFrame2: number
  readonly restRetarget: number
  readonly restRetargetGap: number
  readonly restRetargetFrame: number
  readonly restRetargetFrame2: number
  readonly unmount: number
  readonly unmountGap: number
  readonly unmountFrame: number
}

export interface Driver {
  readonly show: (shown: boolean) => void
  readonly target: (o: number, c: string) => void
  readonly count: () => number
  /** Whether every element shows `o` and `c` (read through computed style). */
  readonly at: (o: number, c: string) => boolean
}

const WHITE = "rgb(255, 255, 255)"
const BLUE = "rgb(0, 0, 255)"
const RED = "rgb(255, 0, 0)"

// Each frame's cost: this page keeps a rAF chain going, so its callback is each frame's first.
let frameStart = 0
const costs: Array<number> = []
let recording = false
const chain = (): void => {
  frameStart = performance.now()
  const started = frameStart
  const channel = new MessageChannel()
  channel.port1.onmessage = () => {
    channel.port1.close()
    if (recording) costs.push(performance.now() - started)
  }
  channel.port2.postMessage(undefined)
  realRaf(chain)
}

const frames = (k: number): Promise<void> =>
  new Promise((resolve) => {
    let i = 0
    const f = (): void => {
      if (++i >= k) resolve()
      else realRaf(f)
    }
    realRaf(f)
  })
/** Resolve just after the next frame paints. */
const painted = (): Promise<void> =>
  new Promise((resolve) => {
    realRaf(() => {
      const channel = new MessageChannel()
      channel.port1.onmessage = () => {
        channel.port1.close()
        resolve()
      }
      channel.port2.postMessage(undefined)
    })
  })
/**
 * `f`'s synchronous JS, a full GC before it; and `gap`, the time from its end to a message posted
 * then: the tasks it queued meanwhile (React's scheduler posts its passive effects so), before any
 * frame.
 */
const timed = (f: () => void): { readonly task: number; readonly gap: Promise<number> } => {
  ;(globalThis as { gc?: () => void }).gc?.()
  const t0 = performance.now()
  f()
  const t1 = performance.now()
  // The frames after it are recorded from now, whatever runs first.
  costs.length = 0
  recording = true
  const gap = new Promise<number>((resolve) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      channel.port1.close()
      resolve(performance.now() - t1)
    }
    channel.port2.postMessage(undefined)
  })
  return { task: t1 - t0, gap }
}
/** The cost of the next `k` frames, from the one after now. */
const nextFrames = async (k: number): Promise<ReadonlyArray<number>> => {
  recording = true
  while (costs.length < Math.min(k, 2)) await painted()
  while (costs.length < k) await painted()
  recording = false
  return costs.slice(0, k)
}
const median = (xs: ReadonlyArray<number>): number => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]!
}
const until = async (done: () => boolean, timeoutMs = 15000): Promise<void> => {
  const end = performance.now() + timeoutMs
  while (!done()) {
    if (performance.now() > end) throw new Error("timed out")
    await frames(1)
  }
}

export const install = (n: number, driver: Driver): void => {
  const round = async (): Promise<Round> => {
    driver.target(1, WHITE)
    await painted()
    const mounted = timed(() => driver.show(true))
    const mount = mounted.task
    const mountGap = await mounted.gap
    if (driver.count() !== n) throw new Error(`mounted ${driver.count()} of ${n}`)
    const [mountFrame, mountFrame2, ...flying] = await nextFrames(10)
    await painted()
    const retargeted = timed(() => driver.target(0.5, BLUE))
    const retarget = retargeted.task
    const retargetGap = await retargeted.gap
    const [retargetFrame, retargetFrame2] = await nextFrames(2)
    await until(() => driver.at(0.5, BLUE))
    await frames(90)
    await painted()
    const restRetargeted = timed(() => driver.target(0.2, RED))
    const restRetarget = restRetargeted.task
    const restRetargetGap = await restRetargeted.gap
    const [restRetargetFrame, restRetargetFrame2] = await nextFrames(2)
    await frames(5)
    await painted()
    const unmounted = timed(() => driver.show(false))
    const unmount = unmounted.task
    const unmountGap = await unmounted.gap
    if (driver.count() !== 0) throw new Error("still mounted")
    const [unmountFrame] = await nextFrames(2)
    await frames(6)
    return { mountGap, retargetGap, restRetargetGap, unmountGap, mount, mountFrame: mountFrame!, mountFrame2: mountFrame2!, flight: median(flying), retarget, retargetFrame: retargetFrame!, retargetFrame2: retargetFrame2!, restRetarget, restRetargetFrame: restRetargetFrame!, restRetargetFrame2: restRetargetFrame2!, unmount, unmountFrame: unmountFrame! }
  }
  ;(globalThis as unknown as { __probe: unknown }).__probe = {
    run: async (rounds: number): Promise<ReadonlyArray<Round>> => {
      realRaf(chain)
      await frames(5)
      const out: Array<Round> = []
      for (let i = 0; i < rounds; i++) out.push(await round())
      return out
    },
  }
}

/** The page's elements' shared style. */
export const addStyle = (): HTMLElement => {
  const style = document.createElement("style")
  style.textContent = ".b{display:inline-block;width:8px;height:8px}"
  document.head.append(style)
  const host = document.createElement("div")
  document.body.append(host)
  return host
}

/** Whether every `.b` in `host` shows `o` and `c`, computed. */
export const atIn = (host: HTMLElement, o: number, c: string): boolean =>
  [...host.querySelectorAll<HTMLElement>(".b")].every((el) => {
    const s = getComputedStyle(el)
    return Math.abs(Number(s.opacity) - o) < 0.001 && s.backgroundColor === c
  })
