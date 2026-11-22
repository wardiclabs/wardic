// #881, probe 1 (Q8's 8c; ADR-0073, decision 21): a ward whose `animate` reads a pending async memo,
// in the scene's shape. The ward is made in a component that renders nothing, under `<Loading>`, and
// given a Subject outside the region, as `ward(mesh, …)` will be: `ward(config)(el)` on an element
// the region doesn't hold. The DOM's own shape is async-config.browser.test.tsx's AC1–AC3.
//
// Hoped for: it holds the object still while the memo is pending, then flies once it resolves.
// To rule out: it throws, reads `undefined`, or retargets twice.
import { DomLive } from "@wardic/dom"
import { ward, WardicProvider } from "@wardic/solid"
import { createMemo, createSignal, Errored, flush, Loading } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { mount } from "../../packages/solid/test/mount.tsx"

const TWEEN = { type: "tween", duration: 0.3 } as const

const later = <A,>(ms: number, value: A): Promise<A> => new Promise((resolve) => setTimeout(() => resolve(value), ms))

interface Seen {
  readonly at: number
  readonly x: number
  readonly transform: string
  readonly fallback: boolean
}

/** `el`'s x on every painted frame for `ms`, and whether `host` shows the fallback. */
const watch = (el: HTMLElement, host: HTMLElement, start: number, ms: number): Promise<ReadonlyArray<Seen>> =>
  new Promise((resolve) => {
    const seen: Array<Seen> = []
    const frame = (): void => {
      const at = performance.now() - start
      const transform = el.style.transform
      const m = new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)"))
      seen.push({ at: Math.round(at), x: Math.round(m.m41 * 10) / 10, transform, fallback: host.querySelector("[data-fallback]") !== null })
      if (at < ms) requestAnimationFrame(frame)
      else resolve(seen)
    }
    requestAnimationFrame(frame)
  })

/** Every error the page reports while the probe runs. */
const errors: Array<string> = []
const onError = (event: ErrorEvent): void => void errors.push(`error: ${event.message}`)
const onRejection = (event: PromiseRejectionEvent): void => void errors.push(`rejection: ${String(event.reason)}`)
window.addEventListener("error", onError)
window.addEventListener("unhandledrejection", onRejection)
const consoleError = console.error
console.error = (...args: ReadonlyArray<unknown>) => {
  errors.push(`console.error: ${args.map(String).join(" ").slice(0, 300)}`)
  consoleError(...args)
}
afterEach(() => void errors.splice(0))

/** The frames, compressed: each run of one x and fallback state, with when it started. */
const runs = (seen: ReadonlyArray<Seen>): string =>
  seen
    .filter((s, i) => i === 0 || s.x !== seen[i - 1]!.x || s.fallback !== seen[i - 1]!.fallback)
    .map((s) => `${s.at}ms x=${s.x}${s.fallback ? " [fallback]" : ""}`)
    .join(" | ")

/** Whether x ever moves away from where it's going: toward `away` past `from`, a second retarget. */
const backtracks = (seen: ReadonlyArray<Seen>): boolean => {
  const xs = seen.map((s) => s.x)
  let dir = 0
  for (let i = 1; i < xs.length; i++) {
    const d = Math.sign(xs[i]! - xs[i - 1]!)
    if (d === 0) continue
    if (dir !== 0 && d !== dir) return true
    dir = d
  }
  return false
}

/** The Subject, outside every region the render holds. */
const subject = (): HTMLElement => {
  const el = document.createElement("div")
  el.dataset.subject = ""
  el.style.cssText = "width:40px;height:40px;background:teal"
  document.body.append(el)
  return el
}

describe("#881 probe 1: a pending animate, the ward in a component that renders nothing", () => {
  it("P1a: first load under <Loading>: what the Subject does while the memo is pending, then after", async () => {
    const [i] = createSignal(1)
    const slots = createMemo(() => later(300, [0, 100, 200]))
    const el = subject()
    const Holder = () => {
      ward({ initial: { x: 0 }, animate: () => ({ x: slots()[i()]! }), transition: TWEEN })(el)
      return null
    }
    const start = performance.now()
    const { host } = mount(() => {
      return (
        <WardicProvider env={DomLive}>
          <Errored fallback={(e) => <p data-err>{String(e())}</p>}>
            <Loading fallback={<p data-fallback>loading</p>}>
              <Holder />
            </Loading>
          </Errored>
        </WardicProvider>
      )
    })
    const seen = await watch(el, host, start, 1000)
    console.log("P1a", runs(seen))
    console.log("P1a errors", JSON.stringify(errors), "err text", host.querySelector("[data-err]")?.textContent ?? "none")
    console.log("P1a backtracks", backtracks(seen))
    expect(seen.length).toBeGreaterThan(10)
    el.remove()
  })

  it("P1b: a refetch after it lands: does it hold at 100, then fly to 200 once, or move twice?", async () => {
    const [i, setI] = createSignal(1)
    const slots = createMemo(() => later(250, i() === 1 ? [0, 100, 200] : [0, 100, 200, 300]))
    const el = subject()
    const Holder = () => {
      ward({ initial: { x: 0 }, animate: () => ({ x: slots()[i()]! }), transition: TWEEN })(el)
      return null
    }
    const { host } = mount(() => {
      return (
        <WardicProvider env={DomLive}>
          <Loading fallback={<p data-fallback>loading</p>}>
            <Holder />
          </Loading>
        </WardicProvider>
      )
    })
    await watch(el, host, performance.now(), 800)
    const start = performance.now()
    setI(2)
    flush()
    const seen = await watch(el, host, start, 900)
    console.log("P1b", runs(seen))
    console.log("P1b errors", JSON.stringify(errors))
    console.log("P1b backtracks", backtracks(seen))
    expect(seen.length).toBeGreaterThan(10)
    el.remove()
  })

  it("P1c: the index changes and the list refetches: x reads slots()[i()] with i new and slots pending", async () => {
    const [i, setI] = createSignal(1)
    const [page, setPage] = createSignal(1)
    const slots = createMemo(() => later(250, page() === 1 ? [0, 100, 200] : [0, 150, 250, 350]))
    const el = subject()
    const Holder = () => {
      ward({ initial: { x: 0 }, animate: () => ({ x: slots()[i()]! }), transition: TWEEN })(el)
      return null
    }
    const { host } = mount(() => {
      return (
        <WardicProvider env={DomLive}>
          <Loading fallback={<p data-fallback>loading</p>}>
            <Holder />
          </Loading>
        </WardicProvider>
      )
    })
    await watch(el, host, performance.now(), 800)
    const start = performance.now()
    // The index moves at once; the list it indexes is refetched. The old list at the new index is 200.
    setI(2)
    setPage(2)
    flush()
    const seen = await watch(el, host, start, 900)
    console.log("P1c", runs(seen))
    console.log("P1c errors", JSON.stringify(errors))
    console.log("P1c backtracks", backtracks(seen), "(a stop at 200, the old list's, would be a retarget twice)")
    expect(seen.length).toBeGreaterThan(10)
    el.remove()
  })

  it("P1d: no boundary at all: the root waits, or the Subject moves?", async () => {
    const slots = createMemo(() => later(300, [0, 100]))
    const el = subject()
    const Holder = () => {
      ward({ initial: { x: 0 }, animate: () => ({ x: slots()[1]! }), transition: TWEEN })(el)
      return null
    }
    const start = performance.now()
    const { host } = mount(() => {
      return (
        <WardicProvider env={DomLive}>
          <Holder />
        </WardicProvider>
      )
    })
    const seen = await watch(el, host, start, 1000)
    console.log("P1d", runs(seen))
    console.log("P1d errors", JSON.stringify(errors.map((e) => e.slice(0, 160))))
    expect(seen.length).toBeGreaterThan(10)
    el.remove()
  })

  it("P1e: initial x 50 while pending, and what the region shows: the fallback, with and without a rendered sibling", async () => {
    const slots = createMemo(() => later(300, [0, 100]))
    const el = subject()
    const Holder = () => {
      ward({ initial: { x: 50 }, animate: () => ({ x: slots()[1]! }), transition: TWEEN })(el)
      return null
    }
    const Sibling = () => <p data-sibling>{String(slots()[1])}</p>
    const start = performance.now()
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <Loading fallback={<p data-fallback>loading</p>}>
          <Holder />
        </Loading>
      </WardicProvider>
    ))
    const shown: Array<string> = []
    setTimeout(() => shown.push(`at 100ms, alone: ${host.innerHTML}`), 100)
    const seen = await watch(el, host, start, 800)
    console.log("P1e alone", runs(seen))
    el.remove()
    const el2 = subject()
    const Holder2 = () => {
      ward({ initial: { x: 50 }, animate: () => ({ x: slots()[1]! }), transition: TWEEN })(el2)
      return null
    }
    const slots2 = createMemo(() => later(300, [0, 100]))
    const Sibling2 = () => <p data-sibling>{String(slots2()[1])}</p>
    void Sibling
    const start2 = performance.now()
    const second = mount(() => (
      <WardicProvider env={DomLive}>
        <Loading fallback={<p data-fallback>loading</p>}>
          <Holder2 />
          <Sibling2 />
        </Loading>
      </WardicProvider>
    ))
    setTimeout(() => shown.push(`at 100ms, with a sibling: ${second.host.innerHTML}`), 100)
    const seen2 = await watch(el2, second.host, start2, 800)
    console.log("P1e with a sibling", runs(seen2))
    console.log("P1e regions", JSON.stringify(shown))
    el2.remove()
  })
})
