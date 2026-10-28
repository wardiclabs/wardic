// Keyframes in targets (#429, ADR-0058), on Solid 1: Motion's rules for a key given a list of stops.
// Solid 2's are KW1–KW4; the server's, AR22; the Handoff's, AH14.
//
// - KS1: Keyframes play through their stops on a tween, and land on the last.
// - KS2: with no transition defined, three stops run on Motion's 0.8 s tween; two run on the key's own
//   default, a transform's spring from the first stop.
// - KS3: `times` places a stop: the peak at a fifth of the run.
// - KS4: a first `null` stop starts where the key is; an explicit one is jumped to.
// - KS5: a spring given three stops is Motion's error: the leg fails, reported, the key lands on its
//   last stop, and the Retarget isn't told complete.
// - KS6: equal Keyframes a re-render makes don't play again; a variant change to equal ones does, as
//   does a list's change that moves the same name's to another layer.
// - KS11: new stops with the same last one play again; a list's later name setting a key to one value
//   ends an earlier name's Keyframes for it.
// - KS7: a hover over Keyframes ending plays them again from their first stop: a pulse resumes.
// - KS8: `initial={false}` starts at `animate`'s last stop and plays nothing, told nothing; an
//   `initial` with Keyframes starts at its first stop.
// - KS9: under reduced motion, a positional key's Keyframes snap to their last stop.
// - KS10: an exit's Keyframes play through their stops; an exit list's later name setting the key to
//   one value ends an earlier name's Keyframes for it.
import { render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, wardic, type WardicAnimationDefinition, WardicProvider } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import { createSignal, type JSX, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { BOX, hover, leave, opacityOf, scaleOf } from "./base-values-harness.ts"
import { raf, until } from "./browser-helpers.ts"
import { resetScene, settle, wait } from "./reorder-harness.tsx"

afterEach(resetScene)

const LINEAR = { type: "tween", ease: "linear" } as const

const show = (ui: () => JSX.Element, env: Parameters<typeof WardicProvider>[0]["env"] = DomLive): void => {
  render(() => <WardicProvider env={env}>{ui()}</WardicProvider>)
}

const xOf = (el: Element): number => new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)")).m41

/** `read(el)` each frame for `ms`, with each frame's time since the first. */
const sample = async (el: Element, read: (el: Element) => number, ms: number): Promise<ReadonlyArray<{ readonly t: number; readonly v: number }>> => {
  const out: Array<{ t: number; v: number }> = []
  const t0 = performance.now()
  while (performance.now() - t0 < ms) {
    await raf()
    out.push({ t: performance.now() - t0, v: read(el) })
  }
  return out
}

const values = (frames: ReadonlyArray<{ readonly v: number }>): ReadonlyArray<number> => frames.map((f) => f.v)
const max = (xs: ReadonlyArray<number>): number => Math.max(...xs)
const min = (xs: ReadonlyArray<number>): number => Math.min(...xs)

/** A log of the callbacks, each with its definition and time. */
const recorder = () => {
  const calls: Array<{ readonly what: string; readonly at: number }> = []
  return {
    calls,
    names: () => calls.map((c) => c.what),
    start: (definition: WardicAnimationDefinition) => calls.push({ what: `start ${JSON.stringify(definition)}`, at: performance.now() }),
    complete: (definition: WardicAnimationDefinition) => calls.push({ what: `complete ${JSON.stringify(definition)}`, at: performance.now() }),
  }
}

describe("Keyframes on Solid 1 (#429)", () => {
  it("KS1: Keyframes play through their stops on a tween, and land on the last", async () => {
    const log = recorder()
    let el!: HTMLElement
    show(() => (
      <wardic.div
        ref={(n: HTMLElement) => (el = n)}
        style={BOX}
        animate={{ x: [0, 100, 40] }}
        transition={{ ...LINEAR, duration: 0.6 }}
        onAnimationStart={log.start}
        onAnimationComplete={log.complete}
      />
    ))
    const frames = values(await sample(el, xOf, 900))
    const peak = frames.indexOf(max(frames))
    expect(max(frames), "through its middle stop").toBeGreaterThan(95)
    expect(min(frames.slice(0, peak)), "up from its first").toBeLessThan(20)
    expect(xOf(el), "on its last").toBe(40)
    expect(log.names()).toEqual(['start {"x":40}', 'complete {"x":40}'])
  })

  it("KS2: with no transition defined, three stops run Motion's 0.8 s tween; two, the key's own spring", async () => {
    const three = recorder()
    let a!: HTMLElement
    let b!: HTMLElement
    show(() => (
      <>
        <wardic.div ref={(n: HTMLElement) => (a = n)} style={BOX} animate={{ x: [0, 100, 40] }} onAnimationStart={three.start} onAnimationComplete={three.complete} />
        <wardic.div ref={(n: HTMLElement) => (b = n)} style={{ ...BOX, left: "260px" }} animate={{ x: [100, 0] }} />
      </>
    ))
    const frames = values(await sample(b, xOf, 1000))
    await until(() => three.calls.length === 2, 2000)
    const [started, completed] = three.calls
    expect(completed!.at - started!.at, "0.8 s, give or take a frame or two").toBeGreaterThan(750)
    expect(completed!.at - started!.at).toBeLessThan(900)
    expect(xOf(a)).toBe(40)
    expect(max(frames.slice(0, 2)), "the spring from its first stop").toBeGreaterThan(90)
    expect(min(frames), "an underdamped spring overshoots 0, as Motion's 500 / 25 does").toBeLessThan(-1)
  })

  it("KS3: times places a stop: the peak at a fifth of the run", async () => {
    const log = recorder()
    let el!: HTMLElement
    show(() => (
      <wardic.div
        ref={(n: HTMLElement) => (el = n)}
        style={BOX}
        animate={{ x: [0, 100, 0] }}
        transition={{ ...LINEAR, duration: 1, times: [0, 0.2, 1] }}
        onAnimationStart={log.start}
      />
    ))
    await until(() => log.calls.length === 1, 1000)
    const frames = await sample(el, xOf, 700)
    const peak = frames.reduce((best, f) => Bool.match(f.v > best.v, { onTrue: () => f, onFalse: () => best }))
    expect(peak.v).toBeGreaterThan(90)
    expect(peak.t, "about 200 ms in").toBeLessThan(320)
  })

  it("KS4: a first null stop starts where the key is; an explicit one is jumped to", async () => {
    let held!: HTMLElement
    let jumped!: HTMLElement
    show(() => (
      <>
        <wardic.div ref={(n: HTMLElement) => (held = n)} style={BOX} initial={{ x: 60 }} animate={{ x: [null, 100, 0] }} transition={{ ...LINEAR, duration: 0.6 }} />
        <wardic.div ref={(n: HTMLElement) => (jumped = n)} style={{ ...BOX, left: "260px" }} initial={{ x: 60 }} animate={{ x: [0, 100, 0] }} transition={{ ...LINEAR, duration: 0.6 }} />
      </>
    ))
    const frames = await Promise.all([sample(held, xOf, 120), sample(jumped, xOf, 120)])
    expect(min(values(frames[0])), "from 60, up").toBeGreaterThanOrEqual(59.9)
    expect(min(values(frames[1])), "from 0").toBeLessThan(20)
  })

  it("KS5: a spring given three stops is Motion's error: reported, landed on its last stop, not told complete", async () => {
    const logs: Array<{ readonly level: string; readonly message: string; readonly cause: string | undefined }> = []
    const env = Layer.merge(
      DomLive,
      Logger.layer([Logger.map(Logger.formatStructured, (s) => logs.push({ level: s.level, message: String(s.message), cause: s.cause }))]),
    )
    const log = recorder()
    let el!: HTMLElement
    show(
      () => (
        <wardic.div
          ref={(n: HTMLElement) => (el = n)}
          style={BOX}
          animate={{ x: [0, 100, 40] }}
          transition={{ type: "spring" }}
          onAnimationStart={log.start}
          onAnimationComplete={log.complete}
        />
      ),
      env,
    )
    await until(() => logs.some((l) => l.message === "wardic.spine: a leg failed"), 2000)
    await settle()
    const failed = logs.filter((l) => l.level === "ERROR" && l.message === "wardic.spine: a leg failed")
    expect(failed).toHaveLength(1)
    expect(failed[0]!.cause).toContain('"x" has 3 keyframes, and a spring takes two')
    expect(failed[0]!.cause).toContain('transition: { "x": { type: "tween" } }')
    expect(xOf(el), "on its last stop").toBe(40)
    await wait(300)
    expect(log.names(), "started, never complete").toEqual(['start {"x":40}'])
  })

  it("KS6: equal Keyframes a re-render makes don't play again; a variant change to equal ones does", async () => {
    const [o, setO] = createSignal(1)
    const [v, setV] = createSignal("a")
    const [list, setList] = createSignal<ReadonlyArray<string>>(["a", "b"])
    let kept!: HTMLElement
    let named!: HTMLElement
    let listed!: HTMLElement
    const pulse = { x: [0, 100, 0] }
    show(() => (
      <>
        <wardic.div ref={(n: HTMLElement) => (kept = n)} style={BOX} animate={{ x: [0, 100, 0], opacity: o() }} transition={{ ...LINEAR, duration: 0.3 }} />
        <wardic.div
          ref={(n: HTMLElement) => (named = n)}
          style={{ ...BOX, left: "260px" }}
          variants={{ a: pulse, b: { x: [0, 100, 0] } }}
          animate={v()}
          transition={{ ...LINEAR, duration: 0.3 }}
        />
        <wardic.div
          ref={(n: HTMLElement) => (listed = n)}
          style={{ ...BOX, left: "400px" }}
          variants={{ a: { x: [0, 100, 0] }, b: { x: [0, 100, 0] } }}
          animate={list()}
          transition={{ ...LINEAR, duration: 0.3 }}
        />
      </>
    ))
    await wait(500)
    await settle()
    setO(0.5)
    const rerendered = values(await sample(kept, xOf, 350))
    expect(max(rerendered), "x stays where it landed").toBeLessThan(1)
    expect(opacityOf(kept)).toBeLessThan(0.6)
    setV("b")
    const changed = values(await sample(named, xOf, 350))
    expect(max(changed), "a new variant name plays them again").toBeGreaterThan(50)
    setList(["b"])
    const relisted = values(await sample(listed, xOf, 350))
    expect(max(relisted), "a list's change plays them again: b drives x from another layer").toBeGreaterThan(50)
  })

  it("KS11: new stops with the same last one play again; a later name's one value ends an earlier name's Keyframes", async () => {
    const [stops, setStops] = createSignal<ReadonlyArray<number>>([0, 100, 0])
    let moved!: HTMLElement
    let plain!: HTMLElement
    show(() => (
      <>
        <wardic.div ref={(n: HTMLElement) => (moved = n)} style={BOX} animate={{ x: stops() }} transition={{ ...LINEAR, duration: 0.3 }} />
        <wardic.div
          ref={(n: HTMLElement) => (plain = n)}
          style={{ ...BOX, left: "260px" }}
          variants={{ a: { x: [0, 100, 50] }, b: { x: 50 } }}
          animate={["a", "b"]}
          transition={{ ...LINEAR, duration: 0.3 }}
        />
      </>
    ))
    const listed = values(await sample(plain, xOf, 450))
    expect(max(listed), "straight to b's 50, never through a's 100").toBeLessThanOrEqual(50.01)
    expect(xOf(plain)).toBe(50)
    await settle()
    setStops([0, 50, 0])
    const again = values(await sample(moved, xOf, 350))
    expect(max(again), "through the new middle stop").toBeGreaterThan(30)
    expect(max(again)).toBeLessThan(55)
  })

  it("KS7: a hover over Keyframes ending plays them again from their first stop: a pulse resumes", async () => {
    let el!: HTMLElement
    show(() => (
      <wardic.div
        ref={(n: HTMLElement) => (el = n)}
        style={BOX}
        animate={{ scale: [1, 1.5, 1], transition: { ...LINEAR, duration: 0.4, repeat: Infinity } }}
        whileHover={{ scale: 2 }}
      />
    ))
    expect(max(values(await sample(el, scaleOf, 500))), "the pulse").toBeGreaterThan(1.4)
    await hover(el)
    await until(() => Math.abs(scaleOf(el) - 2) < 0.01, 3000)
    expect(scaleOf(el)).toBeCloseTo(2, 1)
    await leave()
    const after = values(await sample(el, scaleOf, 900))
    expect(min(after.slice(0, 3)), "from its first stop, jumped to").toBeLessThan(1.15)
    expect(max(after.slice(3)), "and pulsing again").toBeGreaterThan(1.4)
  })

  it("KS8: initial={false} starts at animate's last stop and plays nothing; an initial's Keyframes start at its first", async () => {
    const log = recorder()
    let still!: HTMLElement
    let first!: HTMLElement
    show(() => (
      <>
        <wardic.div
          ref={(n: HTMLElement) => (still = n)}
          style={BOX}
          initial={false}
          animate={{ x: [0, 100, 40] }}
          transition={{ ...LINEAR, duration: 0.4 }}
          onAnimationStart={log.start}
          onAnimationComplete={log.complete}
        />
        <wardic.div ref={(n: HTMLElement) => (first = n)} style={{ ...BOX, left: "260px" }} initial={{ x: [30, 90] }} animate={{ x: 0 }} transition={{ ...LINEAR, duration: 0.4 }} />
      </>
    ))
    expect(xOf(still), "drawn at its last stop before any frame").toBe(40)
    const firstFrames = values(await sample(first, xOf, 100))
    const stillFrames = values(await sample(still, xOf, 400))
    expect(stillFrames.every((x) => x === 40), "nothing played").toBe(true)
    expect(log.names(), "nothing told").toEqual([])
    expect(max(firstFrames), "from 30, down").toBeLessThanOrEqual(30)
    expect(max(firstFrames)).toBeGreaterThan(20)
  })

  it("KS9: under reduced motion, a positional key's Keyframes snap to their last stop", async () => {
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive} reducedMotion="always">
        <wardic.div ref={(n: HTMLElement) => (el = n)} style={BOX} animate={{ x: [0, 100, 40] }} transition={{ ...LINEAR, duration: 0.6 }} />
      </WardicProvider>
    ))
    const frames = values(await sample(el, xOf, 300))
    expect(max(frames), "never through its middle stop").toBeLessThanOrEqual(40)
    expect(xOf(el)).toBe(40)
  })

  it("KS10: an exit's Keyframes play through their stops; a list's later name's one value ends them", async () => {
    const [shown, setShown] = createSignal(true)
    show(() => (
      <AnimatePresence>
        <Show when={shown()}>
          <wardic.div data-leaving style={BOX} exit={{ opacity: [1, 0.1, 0.9, 0] }} transition={{ ...LINEAR, duration: 0.6 }} />
          <wardic.div
            data-listed
            style={{ ...BOX, left: "260px" }}
            variants={{ dip: { opacity: [1, 0.1, 0.9, 0] }, gone: { opacity: 0 } }}
            exit={["dip", "gone"]}
            transition={{ ...LINEAR, duration: 0.6 }}
          />
        </Show>
      </AnimatePresence>
    ))
    await settle()
    const el = document.querySelector<HTMLElement>("[data-leaving]")!
    const listed = document.querySelector<HTMLElement>("[data-listed]")!
    setShown(false)
    const frames: Array<number> = []
    const listedFrames: Array<number> = []
    await until(() => {
      frames.push(opacityOf(el))
      listedFrames.push(opacityOf(listed))
      return Bool.and(!el.isConnected, !listed.isConnected)
    }, 2000)
    const dip = frames.findIndex((o) => o < 0.2)
    expect(dip, "down to its second stop").toBeGreaterThan(-1)
    expect(max(frames.slice(dip)), "then up to its third").toBeGreaterThan(0.8)
    expect(el.isConnected, "then gone").toBe(false)
    const rises = listedFrames.filter((o, i) => i > 0 && o > listedFrames[i - 1]! + 0.001)
    expect(rises, "gone's 0 ends dip's Keyframes: straight down, never back up").toEqual([])
  })
})
