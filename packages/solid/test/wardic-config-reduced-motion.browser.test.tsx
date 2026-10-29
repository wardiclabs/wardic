// `WardicConfig`'s `reducedMotion` on Solid 1 (#434's PR 2, Motion's `MotionConfig` `reducedMotion`):
// the elements below it honour the user's `prefers-reduced-motion` by their nearest config's setting,
// over the provider's. Under it, `x` (a positional key) snaps; a box beside, outside the config, runs on
// the provider's. Every sample is read just after a paint, so a snap shows as a jump with nothing
// between.
//
// - WR1: a config's "always" snaps x under a provider's "never"; outside it, x animates.
// - WR2: a config's "never" animates x under a provider's "always", and under the user's preference.
// - WR3: a config's "user" follows the preference under a provider's "never".
// - WR4: a config with no `reducedMotion` passes its parent's on; an inner one replaces it.
// - WR5: an exit honours the leaving element's config, not its presence's: under "always" its move
//   snaps, so it lands and goes at once.
// - WR6: a layout animation under a config's "always" lands at once; outside, it animates.
// - WR7: `createAnimate`'s `animate()` honours its scope's config, as Motion's `useAnimate` does.
// - WR8: a config's setting is read when each animation starts: a change applies from the next one.
import { cleanup, render } from "@solidjs/testing-library"
import type * as ReducedMotion from "@wardic/core/ReducedMotion"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, createAnimate, type WardicAnimate, wardic, WardicConfig, WardicProvider, type WardicTransition } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import { createSignal, type JSX, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { commands } from "vitest/browser"
import "./browser-commands.ts"
import { leftOf, raf } from "./browser-helpers.ts"

afterEach(async () => {
  cleanup()
  await commands.emulateReducedMotion(false)
})

const TWEEN: WardicTransition = { type: "tween", duration: 0.4, ease: "linear" }
const boxAt = (top: number): JSX.CSSProperties => ({ position: "absolute", left: "0px", top: `${top}px`, width: "40px", height: "40px" })

/** Each element's left edge just after each of the next `n` paints. */
const paints = (els: ReadonlyArray<HTMLElement>, n: number): Promise<ReadonlyArray<ReadonlyArray<number>>> =>
  new Promise((resolve) => {
    const out: Array<Array<number>> = els.map(() => [])
    const channel = new MessageChannel()
    const post = (): void => channel.port2.postMessage(undefined)
    channel.port1.onmessage = () => {
      els.forEach((el, i) => out[i]!.push(leftOf(el)))
      if (out[0]!.length < n) {
        requestAnimationFrame(post)
        return
      }
      channel.port1.close()
      resolve(out)
    }
    requestAnimationFrame(post)
  })

/** Whether `lefts` went from `a` to `b` with no paint 5 px clear of both. */
const snapped = (lefts: ReadonlyArray<number>, a: number, b: number): boolean =>
  Bool.and(lefts.every((left) => Bool.or(left < a + 5, left > b - 5)), Math.abs(lefts.at(-1)! - b) < 0.5)
/** Whether some paint of `lefts` is 5 px clear of both `a` and `b`. */
const animated = (lefts: ReadonlyArray<number>, a: number, b: number): boolean => lefts.some((left) => left > a + 5 && left < b - 5)

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

/** Boxes moving x 0 → 200 when `go` is called: `inside` under a WardicConfig of `config`, `outside` beside it. */
const mountPair = async (provider: ReducedMotion.Config | undefined, config: ReducedMotion.Config | undefined) => {
  const [on, setOn] = createSignal(false)
  const to = () => Bool.match(on(), { onTrue: () => ({ x: 200 }), onFalse: () => ({ x: 0 }) })
  const { container } = render(() => (
    <WardicProvider env={DomLive} reducedMotion={provider}>
      <div style={{ position: "relative", width: "600px", height: "120px" }}>
        <WardicConfig reducedMotion={config}>
          <wardic.div data-k="inside" style={boxAt(0)} initial={{ x: 0 }} animate={to()} transition={TWEEN} />
        </WardicConfig>
        <wardic.div data-k="outside" style={boxAt(60)} initial={{ x: 0 }} animate={to()} transition={TWEEN} />
      </div>
    </WardicProvider>
  ))
  const q = (k: string): HTMLElement => container.querySelector<HTMLElement>(`[data-k="${k}"]`)!
  await frames(3)
  const base = leftOf(q("inside"))
  return {
    base,
    go: async (): Promise<{ readonly inside: ReadonlyArray<number>; readonly outside: ReadonlyArray<number> }> => {
      setOn(true)
      const [inside, outside] = await paints([q("inside"), q("outside")], 10)
      return { inside: inside!, outside: outside! }
    },
  }
}

describe("WardicConfig's reducedMotion on Solid 1 (#434)", () => {
  it("WR1: a config's \"always\" snaps x under a provider's \"never\"; outside it, x animates", async () => {
    const m = await mountPair("never", "always")
    const { inside, outside } = await m.go()
    expect(snapped(inside, m.base, m.base + 200), "inside snaps").toBe(true)
    expect(animated(outside, m.base, m.base + 200), "outside animates").toBe(true)
  })

  it("WR2: a config's \"never\" animates x under a provider's \"always\", and under the user's preference", async () => {
    const always = await mountPair("always", "never")
    const a = await always.go()
    expect(animated(a.inside, always.base, always.base + 200), "inside animates").toBe(true)
    expect(snapped(a.outside, always.base, always.base + 200), "outside snaps").toBe(true)
    cleanup()
    await commands.emulateReducedMotion(true)
    const user = await mountPair(undefined, "never")
    const u = await user.go()
    expect(animated(u.inside, user.base, user.base + 200), "inside animates whatever the preference").toBe(true)
    expect(snapped(u.outside, user.base, user.base + 200), "outside follows the preference").toBe(true)
  })

  it("WR3: a config's \"user\" follows the preference under a provider's \"never\"", async () => {
    await commands.emulateReducedMotion(true)
    const m = await mountPair("never", "user")
    const { inside, outside } = await m.go()
    expect(snapped(inside, m.base, m.base + 200), "inside follows the preference").toBe(true)
    expect(animated(outside, m.base, m.base + 200), "outside animates").toBe(true)
  })

  it("WR4: a config with no reducedMotion passes its parent's on; an inner one replaces it", async () => {
    const [on, setOn] = createSignal(false)
    const to = () => Bool.match(on(), { onTrue: () => ({ x: 200 }), onFalse: () => ({ x: 0 }) })
    const { container } = render(() => (
      <WardicProvider env={DomLive} reducedMotion="never">
        <div style={{ position: "relative", width: "600px", height: "120px" }}>
          <WardicConfig reducedMotion="always">
            <WardicConfig transition={TWEEN}>
              <wardic.div data-k="passed" style={boxAt(0)} initial={{ x: 0 }} animate={to()} />
            </WardicConfig>
            <WardicConfig reducedMotion="never">
              <wardic.div data-k="replaced" style={boxAt(60)} initial={{ x: 0 }} animate={to()} transition={TWEEN} />
            </WardicConfig>
          </WardicConfig>
        </div>
      </WardicProvider>
    ))
    const q = (k: string): HTMLElement => container.querySelector<HTMLElement>(`[data-k="${k}"]`)!
    await frames(3)
    const base = leftOf(q("passed"))
    setOn(true)
    const [passed, replaced] = await paints([q("passed"), q("replaced")], 10)
    expect(snapped(passed!, base, base + 200), "the outer \"always\", passed on").toBe(true)
    expect(animated(replaced!, base, base + 200), "the inner \"never\"").toBe(true)
  })

  it("WR5: an exit honours the leaving element's config, not its presence's", async () => {
    const [shown, setShown] = createSignal(true)
    const { container } = render(() => (
      <WardicProvider env={DomLive} reducedMotion="never">
        <div style={{ position: "relative", width: "600px", height: "120px" }}>
          <AnimatePresence>
            <Show when={shown()}>
              <WardicConfig reducedMotion="always">
                <wardic.div data-k="inside" style={boxAt(0)} initial={{ x: 0 }} animate={{ x: 0 }} exit={{ x: 200, transition: TWEEN }} />
              </WardicConfig>
              <wardic.div data-k="outside" style={boxAt(60)} initial={{ x: 0 }} animate={{ x: 0 }} exit={{ x: 200, transition: TWEEN }} />
            </Show>
          </AnimatePresence>
        </div>
      </WardicProvider>
    ))
    const inside = container.querySelector<HTMLElement>('[data-k="inside"]')!
    const outside = container.querySelector<HTMLElement>('[data-k="outside"]')!
    await frames(3)
    const base = leftOf(inside)
    setShown(false)
    const [o] = await paints([outside], 6)
    // Its exit's move snaps, so it lands at once and the presence removes it.
    expect(inside.isConnected, "its config's \"always\": its exit landed at once").toBe(false)
    expect(animated(o!, base, base + 200), "beside it, the provider's \"never\"").toBe(true)
    expect(outside.isConnected, "still leaving").toBe(true)
  })

  it("WR6: a layout animation under a config's \"always\" lands at once; outside, it animates", async () => {
    const [moved, setMoved] = createSignal(false)
    const left = () => Bool.match(moved(), { onTrue: () => "200px", onFalse: () => "0px" })
    const { container } = render(() => (
      <WardicProvider env={DomLive} reducedMotion="never">
        <div style={{ position: "relative", width: "600px", height: "120px" }}>
          <WardicConfig reducedMotion="always">
            <wardic.div data-k="inside" layout layoutDependency={moved()} transition={{ layout: TWEEN }} style={{ ...boxAt(0), left: left() }} />
          </WardicConfig>
          <wardic.div data-k="outside" layout layoutDependency={moved()} transition={{ layout: TWEEN }} style={{ ...boxAt(60), left: left() }} />
        </div>
      </WardicProvider>
    ))
    const inside = container.querySelector<HTMLElement>('[data-k="inside"]')!
    const outside = container.querySelector<HTMLElement>('[data-k="outside"]')!
    await frames(5)
    const base = leftOf(inside)
    setMoved(true)
    const [i, o] = await paints([inside, outside], 10)
    expect(snapped(i!, base, base + 200), "it lands at once").toBe(true)
    expect(animated(o!, base, base + 200), "beside it, the layout animation runs").toBe(true)
  })

  it("WR7: createAnimate's animate() honours its scope's config", async () => {
    let animate!: WardicAnimate
    const Scene = (): JSX.Element => {
      const [scope, made] = createAnimate()
      animate = made
      return <div ref={scope}><div data-k="p" style={boxAt(0)} /></div>
    }
    const { container } = render(() => (
      <WardicProvider env={DomLive} reducedMotion="never">
        <div style={{ position: "relative", width: "600px", height: "120px" }}>
          <WardicConfig reducedMotion="always">
            <Scene />
          </WardicConfig>
        </div>
      </WardicProvider>
    ))
    const p = container.querySelector<HTMLElement>('[data-k="p"]')!
    await frames(3)
    const base = leftOf(p)
    void animate(p, { x: 200 }, TWEEN)
    const [lefts] = await paints([p], 10)
    expect(snapped(lefts!, base, base + 200)).toBe(true)
  })

  it("WR8: a config's setting is read when each animation starts: a change applies from the next one", async () => {
    const [setting, setSetting] = createSignal<ReducedMotion.Config>("never")
    const [x, setX] = createSignal(0)
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <div style={{ position: "relative", width: "600px", height: "120px" }}>
          <WardicConfig reducedMotion={setting()}>
            <wardic.div data-k="box" style={boxAt(0)} initial={{ x: 0 }} animate={{ x: x() }} transition={TWEEN} />
          </WardicConfig>
        </div>
      </WardicProvider>
    ))
    const box = container.querySelector<HTMLElement>('[data-k="box"]')!
    await frames(3)
    const base = leftOf(box)
    setX(200)
    const [first] = await paints([box], 40)
    expect(animated(first!, base, base + 200), "\"never\": it animates").toBe(true)
    setSetting("always")
    setX(0)
    const [second] = await paints([box], 10)
    expect(second!.every((left) => Bool.or(Math.abs(left - base) < 0.5, Math.abs(left - base - 200) < 0.5)), "\"always\": the next one snaps").toBe(true)
    expect(second!.at(-1)!, "back at once").toBeCloseTo(base, 0)
  })
})
