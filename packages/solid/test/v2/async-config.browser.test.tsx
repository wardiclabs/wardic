// A ward whose config reads an async value (#257 item 1, ADR-0045 *#257 item 1: an async config*), in
// a real browser. A key the ward reads as it goes holds its region as any pending read does, and the
// ward plays to it once it lands; a key setup fixes, still loading, is an error naming it.
//
// - AC1: `animate` from an async memo, the ward made in a component under `<Loading>`: the region
//   waits for the data, then the entrance plays from `initial` to the fetched target.
// - AC2: a refetch after it lands: the ward holds its last target, on the page, until the new one
//   lands, then animates there; a refetch mid-animation inside `<Loading>` doesn't remake the ward.
// - AC3: no boundary: the root waits for the data (Solid warns, as of any async read outside one),
//   then the entrance plays.
// - AC4: a pending `style`, `transition` or `while*` holds the region too.
// - AC5: a key setup fixes, still loading (`layout`, `drag`), is an error naming it, in `<Errored>`.
// - AC6: `initial={false}` with a pending `animate` is an error: the ward would start there.
// - AC7: an accessor that returns a promise is an error, showing the async memo to use.
// - AC8: a pending `animate` on a ward with `variants` names its own variants: its Variant child
//   follows the name once it lands.
// - AC9: under a variant parent, that ward still names its own: it takes no `initial` from the parent.
import { DomLive } from "@wardic/dom"
import { type Ward, ward, wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import type { JSX } from "@solidjs/web"
import * as Bool from "effect/Boolean"
import { createMemo, createSignal, Errored, flush, Loading } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"
import { swallow } from "./swallow.ts"

const BOX = { width: "40px", height: "40px" } as const
const TWEEN = { type: "tween", duration: 0.3 } as const

/** A value after `ms`. */
const later = <A,>(ms: number, value: A): Promise<A> => new Promise((resolve) => setTimeout(() => resolve(value), ms))

/** A painted frame: its time since `start`, and `[data-card]`'s x and opacity, `undefined` off the page. */
interface Seen {
  readonly at: number
  readonly x: number | undefined
  readonly opacity: number | undefined
}

/** Every painted frame for `ms`. */
const watch = (host: HTMLElement, start: number, ms: number): Promise<ReadonlyArray<Seen>> =>
  new Promise((resolve) => {
    const seen: Array<Seen> = []
    const frame = (): void => {
      const el = host.querySelector<HTMLElement>("[data-card]")
      const at = performance.now() - start
      seen.push(
        Bool.match(el === null, {
          onTrue: (): Seen => ({ at, x: undefined, opacity: undefined }),
          onFalse: (): Seen => {
            const computed = getComputedStyle(el!)
            const m = new DOMMatrix(computed.transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)"))
            return { at, x: m.m41, opacity: Number(computed.opacity) }
          },
        }),
      )
      if (at < ms) requestAnimationFrame(frame)
      else resolve(seen)
    }
    requestAnimationFrame(frame)
  })

/** The frames on the page: the first after `notBefore`, near the start, moving, then at `to`. */
const enteredFrom = (seen: ReadonlyArray<Seen>, notBefore: number, from: number, to: number): void => {
  const shown = seen.filter((s) => s.x !== undefined)
  expect(shown.length, "it reached the page").toBeGreaterThan(5)
  expect(shown[0]!.at, "not on the page before its data").toBeGreaterThanOrEqual(notBefore)
  expect(Math.abs(shown[0]!.x! - from), `its first frame near ${from}: ${shown[0]!.x}`).toBeLessThan(Math.abs(to - from) * 0.3)
  expect(shown.some((s) => Math.abs(s.x! - from) > 5 && Math.abs(s.x! - to) > 5), "it moved on the page").toBe(true)
  expect(shown.at(-1)!.x, "at rest on the fetched target").toBeCloseTo(to, 0)
}

/** `<Errored>` showing what it caught in `[data-err]`. */
const Catching = (props: { readonly children: JSX.Element }) => (
  <Errored fallback={(err) => <p data-err>{String((err() as Error).message)}</p>}>{props.children}</Errored>
)

describe("a ward's async config (#257 item 1)", () => {
  it("AC1: animate from an async memo under <Loading>: the region waits, then the entrance plays to it", async () => {
    let runs = 0
    const start = performance.now()
    const Card = (): JSX.Element => {
      runs++
      const x = createMemo(() => later(300, 100))
      const card = ward({ initial: { x: 0 }, animate: () => ({ x: x() }), transition: TWEEN })
      return <div {...card.with({ style: BOX })} data-card />
    }
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <Loading fallback={<p>loading</p>}>
          <Card />
        </Loading>
      </WardicProvider>
    ))
    const seen = await watch(host, start, 900)
    expect(runs, "made once: the setup read leaves nothing to re-render").toBe(1)
    enteredFrom(seen, 250, 0, 100)
  })

  it("AC2: a refetch holds the last target on the page, then animates; one mid-animation doesn't remake the ward", async () => {
    const [id, setId] = createSignal(1)
    let runs = 0
    let card!: Ward
    const Card = (): JSX.Element => {
      runs++
      const x = createMemo(() => later(200, id() * 100))
      card = ward({ initial: { x: 0 }, animate: () => ({ x: x() }), transition: TWEEN })
      return <div {...card.with({ style: BOX })} data-card />
    }
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <Loading fallback={<p>loading</p>}>
          <Card />
        </Loading>
      </WardicProvider>
    ))
    await watch(host, performance.now(), 700)
    const el = host.querySelector("[data-card]")
    let start = performance.now()
    setId(2)
    flush()
    let seen = await watch(host, start, 700)
    const before = seen.filter((s) => s.at < 150)
    expect(before.every((s) => s.x === 100), `held at 100 on the page: ${before.map((s) => s.x).join(" ")}`).toBe(true)
    expect(seen.some((s) => s.x! > 105 && s.x! < 195), "it moved").toBe(true)
    expect(seen.at(-1)!.x).toBeCloseTo(200, 0)
    // A refetch mid-animation: the same element, the same ward, the animation going on.
    start = performance.now()
    setId(3)
    flush()
    await new Promise((resolve) => setTimeout(resolve, 300))
    setId(4)
    flush()
    seen = await watch(host, start, 900)
    expect(host.querySelector("[data-card]"), "the same element").toBe(el)
    expect(runs, "the same ward").toBe(1)
    expect(seen.at(-1)!.x).toBeCloseTo(400, 0)
  })

  it("AC3: no boundary: the root waits for the data, then the entrance plays", async () => {
    const warning = swallow("ASYNC_OUTSIDE_LOADING_BOUNDARY")
    try {
      const start = performance.now()
      const Card = (): JSX.Element => {
        const x = createMemo(() => later(300, 100))
        const card = ward({ initial: { x: 0 }, animate: () => ({ x: x() }), transition: TWEEN })
        return <div {...card.with({ style: BOX })} data-card />
      }
      const { host } = mount(() => (
        <WardicProvider env={DomLive}>
          <Card />
        </WardicProvider>
      ))
      enteredFrom(await watch(host, start, 900), 250, 0, 100)
      expect(warning.seen(), "Solid warns of the read, as of any async read outside a boundary").toBeGreaterThan(0)
    } finally {
      warning.restore()
    }
  })

  it("AC4: a pending style, transition or while* holds the region too", async () => {
    const start = performance.now()
    const Card = (): JSX.Element => {
      const opacity = createMemo(() => later(300, 0.5))
      const duration = createMemo(() => later(300, 0.3))
      const hover = createMemo(() => later(300, { scale: 1.1 }))
      const card = ward({
        initial: { x: 0 },
        animate: { x: 100 },
        style: () => ({ opacity: opacity() }),
        transition: () => ({ type: "tween", duration: duration() }),
        whileHover: () => hover(),
      })
      return <div {...card.with({ style: BOX })} data-card />
    }
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <Loading fallback={<p>loading</p>}>
          <Card />
        </Loading>
      </WardicProvider>
    ))
    const seen = await watch(host, start, 900)
    enteredFrom(seen, 250, 0, 100)
    expect(seen.at(-1)!.opacity, "its fetched style").toBe(0.5)
  })

  it("AC5: a key setup fixes, still loading, is an error naming it", async () => {
    /** A card whose `key` reads a pending async memo. */
    const cardWith = (key: "layout" | "drag") => (): JSX.Element => {
      const value = createMemo(() => later(100, true as const))
      const card = ward({ animate: { x: 100 }, [key]: () => value() })
      return <div {...card.with({ style: BOX })} data-card />
    }
    for (const key of ["layout", "drag"] as const) {
      const Card = cardWith(key)
      const { host, unmount } = mount(() => (
        <WardicProvider env={DomLive}>
          <Catching>
            <Loading fallback={<p>loading</p>}>
              <Card />
            </Loading>
          </Catching>
        </WardicProvider>
      ))
      for (let i = 0; i < 4; i++) await raf()
      expect(host.querySelector("[data-err]")?.textContent).toBe(
        `ward(config): \`${key}\` was still loading when the ward was made. A ward reads it once, when it's made: give it a value, or make the ward once its data is in.`,
      )
      unmount()
    }
  })

  it("AC6: initial={false} with a pending animate is an error", async () => {
    const Card = (): JSX.Element => {
      const x = createMemo(() => later(100, 100))
      const card = ward({ initial: false, animate: () => ({ x: x() }) })
      return <div {...card.with({ style: BOX })} data-card />
    }
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <Catching>
          <Loading fallback={<p>loading</p>}>
            <Card />
          </Loading>
        </Catching>
      </WardicProvider>
    ))
    for (let i = 0; i < 4; i++) await raf()
    expect(host.querySelector("[data-err]")?.textContent).toContain("with `initial={false}` a ward starts there")
  })

  it("AC7: an accessor that returns a promise is an error, showing the async memo to use", async () => {
    const Card = (): JSX.Element => {
      const card = ward({ initial: { x: 0 }, animate: (() => later(100, { x: 100 })) as never })
      return <div {...card.with({ style: BOX })} data-card />
    }
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <Catching>
          <Card />
        </Catching>
      </WardicProvider>
    ))
    for (let i = 0; i < 4; i++) await raf()
    expect(host.querySelector("[data-err]")?.textContent).toContain("`animate`'s accessor returned a promise: give it an async memo instead, `animate: createMemo(() => …)`")
  })

  it("AC8: a pending animate on a ward with variants names its own: its Variant child follows the name", async () => {
    const start = performance.now()
    const Parent = (): JSX.Element => {
      const name = createMemo(() => later(300, "shown" as const))
      const list = ward({ initial: "hidden", animate: () => name(), variants: { hidden: {}, shown: {} }, transition: TWEEN })
      return (
        <div {...list}>
          <list.Provider>
            <wardic.div data-card variants={{ hidden: { x: 0 }, shown: { x: 100 } }} transition={TWEEN} style={BOX} />
          </list.Provider>
        </div>
      )
    }
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <Loading fallback={<p>loading</p>}>
          <Parent />
        </Loading>
      </WardicProvider>
    ))
    enteredFrom(await watch(host, start, 900), 250, 0, 100)
  })

  it("AC9: under a variant parent, a pending animate still names its own: it takes no initial from the parent", async () => {
    const start = performance.now()
    const Middle = (): JSX.Element => {
      const name = createMemo(() => later(300, "shown" as const))
      const card = ward({ animate: () => name(), variants: { hidden: { x: 50 }, shown: { x: 100 } }, transition: TWEEN })
      return <div {...card.with({ style: BOX })} data-card />
    }
    const Outer = (): JSX.Element => {
      const outer = ward({ initial: "hidden", animate: "hidden", variants: { hidden: {}, shown: {} } })
      return (
        <div {...outer}>
          <outer.Provider>
            <Middle />
          </outer.Provider>
        </div>
      )
    }
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <Loading fallback={<p>loading</p>}>
          <Outer />
        </Loading>
      </WardicProvider>
    ))
    // From its natural x, 0: not from 50, the "hidden" it would inherit as a Variant child.
    enteredFrom(await watch(host, start, 900), 250, 0, 100)
  })
})
