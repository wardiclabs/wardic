// #881, probe 2 (Q8's 8k; ADR-0073, decision 21): when `onSettled` runs under `<Loading>` and
// `<Reveal>`, for a component that reads async data in its JSX (the DOM's shape) and for one that
// renders nothing and reads it only in a computation, as a scene hook will (the scene's shape).
//
// - Does `onSettled` in a component under `<Loading>` wait for its async reads and assets?
// - Does `<Reveal>` hold siblings' `onSettled` back, in reveal order?
import { DomLive } from "@wardic/dom"
import { ward, WardicProvider } from "@wardic/solid"
import { createEffect, createMemo, Loading, onSettled, Reveal } from "solid-js"
import { describe, expect, it } from "vitest"
import { mount } from "../../packages/solid/test/mount.tsx"

const later = <A,>(ms: number, value: A): Promise<A> => new Promise((resolve) => setTimeout(() => resolve(value), ms))

/** A log of what happened when, in ms since `start`. */
const clock = () => {
  const start = performance.now()
  const log: Array<string> = []
  return { log, at: (what: string): void => void log.push(`${Math.round(performance.now() - start)}ms ${what}`) }
}

/** Each frame, what `host` shows in its `[data-region]`s, logged when it changes. */
const regions = (host: HTMLElement, at: (what: string) => void, ms: number): Promise<void> =>
  new Promise((resolve) => {
    const start = performance.now()
    let last = ""
    const frame = (): void => {
      const now = [...host.querySelectorAll("[data-region]")].map((r) => `${(r as HTMLElement).dataset.region}:${r.textContent}`).join(" ")
      if (now !== last) at(`regions ${now}`)
      last = now
      if (performance.now() - start < ms) requestAnimationFrame(frame)
      else resolve()
    }
    requestAnimationFrame(frame)
  })

describe("#881 probe 2: onSettled under <Loading> and <Reveal>", () => {
  it("P2a: the DOM's shape, data read in JSX: onSettled after the data?", async () => {
    const { log, at } = clock()
    const Model = (props: { readonly name: string; readonly ms: number }) => {
      const data = createMemo(() => later(props.ms, props.name).then((v) => (at(`${props.name} resolved`), v)))
      onSettled(() => at(`${props.name} onSettled`))
      return <span>{data()}</span>
    }
    const { host } = mount(() => (
      <div data-region="a">
        <Loading fallback="…">
          <Model name="a" ms={300} />
        </Loading>
      </div>
    ))
    await regions(host, at, 600)
    console.log("P2a", JSON.stringify(log))
    expect(log.length).toBeGreaterThan(0)
  })

  it("P2b: the scene's shape, data read only in a ward's config, rendering nothing: onSettled after the data?", async () => {
    const { log, at } = clock()
    const el = document.createElement("div")
    document.body.append(el)
    const Model = (props: { readonly name: string; readonly ms: number }) => {
      const data = createMemo(() => later(props.ms, 100).then((v) => (at(`${props.name} resolved`), v)))
      ward({ animate: () => ({ x: data() }) })(el)
      onSettled(() => at(`${props.name} onSettled`))
      return null
    }
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <div data-region="a">
          <Loading fallback="…">
            <Model name="a" ms={300} />
          </Loading>
        </div>
      </WardicProvider>
    ))
    await regions(host, at, 600)
    console.log("P2b", JSON.stringify(log))
    el.remove()
  })

  it("P2c: the scene's shape, data read only in a createEffect's compute, rendering nothing: onSettled after the data?", async () => {
    const { log, at } = clock()
    const Model = (props: { readonly name: string; readonly ms: number }) => {
      const data = createMemo(() => later(props.ms, props.name).then((v) => (at(`${props.name} resolved`), v)))
      createEffect(
        () => data(),
        (v) => at(`${props.name} effect applied ${v}`),
      )
      onSettled(() => at(`${props.name} onSettled`))
      return null
    }
    const { host } = mount(() => (
      <div data-region="a">
        <Loading fallback="…">
          <Model name="a" ms={300} />
        </Loading>
      </div>
    ))
    await regions(host, at, 600)
    console.log("P2c", JSON.stringify(log))
  })

  it("P2d: <Reveal>, the DOM's shape: a slow (300 ms) then b fast (100 ms): b's onSettled held until a reveals?", async () => {
    const { log, at } = clock()
    const Model = (props: { readonly name: string; readonly ms: number }) => {
      const data = createMemo(() => later(props.ms, props.name).then((v) => (at(`${props.name} resolved`), v)))
      onSettled(() => at(`${props.name} onSettled`))
      return <span>{data()}</span>
    }
    const { host } = mount(() => (
      <Reveal>
        <div data-region="a">
          <Loading fallback="…">
            <Model name="a" ms={300} />
          </Loading>
        </div>
        <div data-region="b">
          <Loading fallback="…">
            <Model name="b" ms={100} />
          </Loading>
        </div>
      </Reveal>
    ))
    await regions(host, at, 700)
    console.log("P2d", JSON.stringify(log))
  })

  it("P2e: <Reveal>, the scene's shape: two Models rendering nothing, reading only in a compute", async () => {
    const { log, at } = clock()
    const Model = (props: { readonly name: string; readonly ms: number }) => {
      const data = createMemo(() => later(props.ms, props.name).then((v) => (at(`${props.name} resolved`), v)))
      createEffect(
        () => data(),
        (v) => at(`${props.name} effect applied ${v}`),
      )
      onSettled(() => at(`${props.name} onSettled`))
      return null
    }
    const { host } = mount(() => (
      <Reveal>
        <div data-region="a">
          <Loading fallback="…">
            <Model name="a" ms={300} />
          </Loading>
        </div>
        <div data-region="b">
          <Loading fallback="…">
            <Model name="b" ms={100} />
          </Loading>
        </div>
      </Reveal>
    ))
    await regions(host, at, 700)
    console.log("P2e", JSON.stringify(log))
  })

  it("P2f: <Reveal>, the scene's shape with a ward: two Models rendering nothing, their data in a ward's config", async () => {
    const { log, at } = clock()
    const els = [document.createElement("div"), document.createElement("div")]
    for (const el of els) document.body.append(el)
    const Model = (props: { readonly name: string; readonly ms: number; readonly el: HTMLElement }) => {
      const data = createMemo(() => later(props.ms, 100).then((v) => (at(`${props.name} resolved`), v)))
      ward({ animate: () => ({ x: data() }) })(props.el)
      onSettled(() => at(`${props.name} onSettled`))
      return null
    }
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <Reveal>
          <div data-region="a">
            <Loading fallback="…">
              <Model name="a" ms={300} el={els[0]!} />
            </Loading>
          </div>
          <div data-region="b">
            <Loading fallback="…">
              <Model name="b" ms={100} el={els[1]!} />
            </Loading>
          </div>
        </Reveal>
      </WardicProvider>
    ))
    const moved = [false, false]
    const start = performance.now()
    const frame = (): void => {
      els.forEach((el, i) => {
        if (!moved[i] && el.style.transform !== "") {
          moved[i] = true
          at(`${i === 0 ? "a" : "b"} first written: ${el.style.transform}`)
        }
      })
      if (performance.now() - start < 700) requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
    await regions(host, at, 700)
    console.log("P2f", JSON.stringify(log))
    for (const el of els) el.remove()
  })

  it("P2g: rendering an expression that reads the data and draws nothing: does that join the boundary and <Reveal>?", async () => {
    const { log, at } = clock()
    const Model = (props: { readonly name: string; readonly ms: number }) => {
      const data = createMemo(() => later(props.ms, props.name).then((v) => (at(`${props.name} resolved`), v)))
      createEffect(
        () => data(),
        (v) => at(`${props.name} effect applied ${v}`),
      )
      onSettled(() => at(`${props.name} onSettled`))
      return <>{(() => (data(), undefined)) as unknown as undefined}</>
    }
    const { host } = mount(() => (
      <Reveal>
        <div data-region="a">
          <Loading fallback="…">
            <Model name="a" ms={300} />
          </Loading>
        </div>
        <div data-region="b">
          <Loading fallback="…">
            <Model name="b" ms={100} />
          </Loading>
        </div>
      </Reveal>
    ))
    await regions(host, at, 700)
    console.log("P2g", JSON.stringify(log))
  })
})
