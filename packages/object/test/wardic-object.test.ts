/**
 * `@wardic/object` (#882, ADR-0073 *Amendment (#882)*): Motion's `animate` on plain objects, on frames
 * the test pumps as a host loop would (`frame(time)`, then a render that reads the object). Node, with
 * no DOM.
 *
 * A run asks for its first frame a microtask after `animate()` (the canvas note's P5), so each test lets
 * one pass before it pumps.
 */
import * as WardicObject from "@wardic/object/WardicObject"
import { describe, expect, it } from "@effect/vitest"
import { reportsDuring } from "./reports.ts"

const FRAME = 1000 / 60

/** A microtask: the one a run waits before it asks for its first frame. */
const tick = (): Promise<void> => Promise.resolve()

/** A host loop: `n` frames of 1/60 s from `start`, each read after `frame(time)` as a render would. */
const pump = <A>(wardic: WardicObject.WardicObject, n: number, read: () => A, start = { time: 0 }): Array<A> => {
  const drawn: Array<A> = []
  for (let i = 0; i < n; i++) {
    start.time += FRAME
    wardic.frame(start.time)
    drawn.push(read())
  }
  return drawn
}

describe("WardicObject: animate on plain objects, on pumped frames", () => {
  it("WO1: frame(time) writes this frame's value onto the object before it returns, and lands on the target", async () => {
    const wardic = WardicObject.make()
    const sprite = { x: 0 }
    const controls = wardic.animate(sprite, { x: 100 }, { type: "tween", duration: 0.25, ease: "linear" })
    await tick()
    const clock = { time: 0 }
    const drawn = pump(wardic, 20, () => sprite.x, clock)
    // Every render saw a value the frame computed: moving from the first frame, linear, then at 100.
    expect(drawn[0]!, `first frame: ${drawn.join(" ")}`).toBeGreaterThan(0)
    expect(drawn[3]! - drawn[2]!).toBeCloseTo(drawn[2]! - drawn[1]!, 5)
    expect(drawn.at(-1)).toBe(100)
    await controls
    expect(controls.state).toBe("finished")
    wardic.dispose()
  })

  it("WO2: wantsFrame is true while it runs and false once it's landed", async () => {
    const wardic = WardicObject.make()
    const ball = { y: 0 }
    expect(wardic.wantsFrame()).toBe(false)
    wardic.animate(ball, { y: 10 }, { type: "tween", duration: 0.1 })
    await tick()
    expect(wardic.wantsFrame()).toBe(true)
    const clock = { time: 0 }
    pump(wardic, 30, () => ball.y, clock)
    await tick()
    pump(wardic, 2, () => ball.y, clock)
    expect(ball.y).toBe(10)
    expect(wardic.wantsFrame()).toBe(false)
    wardic.dispose()
  })

  it("WO3: a later animate takes the key over from where it's drawn, keeping its velocity", async () => {
    const wardic = WardicObject.make()
    const sprite = { x: 0 }
    wardic.animate(sprite, { x: 100 }, { type: "spring", stiffness: 100, damping: 10 })
    await tick()
    const clock = { time: 0 }
    const before = pump(wardic, 6, () => sprite.x, clock)
    const speed = before[5]! - before[4]!
    wardic.animate(sprite, { x: 0 }, { type: "spring", stiffness: 100, damping: 10 })
    await tick()
    const after = pump(wardic, 3, () => sprite.x, clock)
    // Moving toward 100 at the takeover, it goes on that way before it turns back: its velocity kept.
    expect(speed).toBeGreaterThan(0)
    expect(after[0]!, `${before.join(" ")} | ${after.join(" ")}`).toBeGreaterThan(before[5]!)
    wardic.dispose()
  })

  it("WO4: a list's objects each animate, a function delay worked out for each (Motion's delay(i, n))", async () => {
    const wardic = WardicObject.make()
    const a = { y: 0 }
    const b = { y: 0 }
    wardic.animate([a, b], { y: 10 }, { type: "tween", duration: 0.1, ease: "linear", delay: (i) => i * 0.1 })
    await tick()
    const clock = { time: 0 }
    pump(wardic, 6, () => undefined, clock)
    expect(a.y).toBe(10)
    expect(b.y).toBe(0)
    pump(wardic, 8, () => undefined, clock)
    expect(b.y).toBe(10)
    wardic.dispose()
  })

  it("WO5: a sequence plays its Segments one after another, and its controls await the whole", async () => {
    const wardic = WardicObject.make()
    const a = { x: 0 }
    const b = { opacity: 1 }
    const controls = wardic.animate([
      [a, { x: 10 }, { type: "tween", duration: 0.1, ease: "linear" }],
      [b, { opacity: 0 }, { type: "tween", duration: 0.1, ease: "linear" }],
    ])
    await tick()
    const clock = { time: 0 }
    pump(wardic, 7, () => undefined, clock)
    expect(a.x).toBe(10)
    expect(b.opacity).toBeGreaterThan(0.5)
    pump(wardic, 8, () => undefined, clock)
    expect(b.opacity).toBe(0)
    await controls
    wardic.dispose()
  })

  it("WO6: afterWrites runs each frame after Wardic's writes, in the order added, until removed", async () => {
    const wardic = WardicObject.make()
    const camera = { x: 0 }
    const heard: Array<string> = []
    const removeA = wardic.afterWrites((time) => void heard.push(`a ${Math.round(time)} x=${camera.x}`))
    wardic.afterWrites(() => void heard.push("b"))
    wardic.animate(camera, { x: 30 }, { type: "tween", duration: 1 / 30, ease: "linear" })
    await tick()
    const clock = { time: 0 }
    pump(wardic, 2, () => undefined, clock)
    removeA()
    pump(wardic, 1, () => undefined, clock)
    // The first frame's effect sees the frame's write, not the value before it.
    expect(heard).toEqual(["a 17 x=15", "b", "a 33 x=30", "b", "b"])
    wardic.dispose()
  })

  it("WO7: a key the object lacks, one that isn't a number or a string, one it can't write, and a subject that isn't an object are errors naming them", () => {
    const wardic = WardicObject.make()
    class Sprite {
      x = 0
      tint = { r: 1 }
    }
    expect(() => wardic.animate({ x: 0 } as { x: number; y: number }, { y: 1 })).toThrow(/the object has no "y" to animate/)
    expect(() => wardic.animate(new Sprite() as unknown as { tint: number }, { tint: 0 })).toThrow(/a Sprite's "tint" is object, which can't be animated/)
    expect(() => wardic.animate(42 as unknown as object, {})).toThrow(/42 isn't an object to animate/)
    // A key it can't write (#968): read-only, or a getter with no setter, its own or inherited.
    const unwritable = /"(\w+)" can't be written \(it's read-only, or a getter with no setter\), so Wardic can't animate it/
    const frozen: { readonly x: number } = Object.freeze({ x: 0 })
    expect(() => wardic.animate(frozen, { x: 1 })).toThrow(/the object's "x" can't be written/)
    expect(() => wardic.animate(Object.defineProperty({}, "x", { value: 0, enumerable: true }) as { x: number }, { x: 1 })).toThrow(unwritable)
    expect(() => wardic.animate(new Float32Array(3) as unknown as { length: number }, { length: 5 })).toThrow(/a Float32Array's "length" can't be written/)
    expect(() => wardic.animate(new Float32Array(3) as unknown as { BYTES_PER_ELEMENT: number }, { BYTES_PER_ELEMENT: 8 })).toThrow(/"BYTES_PER_ELEMENT" can't be written/)
    class Gauge {
      get level() {
        return 0
      }
    }
    expect(() => wardic.animate(new Gauge(), { level: 1 })).toThrow(/a Gauge's "level" can't be written/)
    // An inherited writable one where the object takes no property of its own: frozen, sealed or not extensible.
    expect(() => wardic.animate(Object.freeze(Object.create({ y: 0 }) as { y: number }), { y: 1 })).toThrow(/the object's "y" can't be written/)
    expect(() => wardic.animate(Object.seal(Object.create({ y: 0 }) as { y: number }), { y: 1 })).toThrow(unwritable)
    expect(() => wardic.animate(Object.preventExtensions(Object.create({ y: 0 }) as { y: number }), { y: 1 })).toThrow(unwritable)
    // A later Segment's, at the call too.
    expect(() => wardic.animate([[{ y: 0 }, { y: 1 }], [Object.freeze({ x: 0 }), { x: 1 }]])).toThrow(/the object's "x" can't be written/)
    wardic.dispose()
  })

  it("WO24: a getter with a setter, a sealed object's key and an inherited writable one animate, as any key (#968)", async () => {
    const wardic = WardicObject.make()
    class Dial {
      #turn = 0
      get turn() {
        return this.#turn
      }
      set turn(turn: number) {
        this.#turn = turn
      }
    }
    const dial = new Dial()
    const sealed = Object.seal({ x: 0 })
    const inherited = Object.create({ y: 0 }) as { y: number }
    let held = 0
    const own = Object.defineProperty({}, "level", { get: () => held, set: (level: number) => void (held = level), enumerable: true }) as { level: number }
    const short = { type: "tween", duration: 0.1, ease: "linear" } as const
    const calls = [wardic.animate(dial, { turn: 1 }, short), wardic.animate(sealed, { x: 1 }, short), wardic.animate(inherited, { y: 1 }, short), wardic.animate(own, { level: 1 }, short)]
    await tick()
    pump(wardic, 10, () => undefined)
    await Promise.all(calls)
    expect([dial.turn, sealed.x, inherited.y, held]).toEqual([1, 1, 1, 1])
    wardic.dispose()
  })

  it("WO8: a key with no transition runs on Motion's by its name: an ease of 0.3 s for an object's own key", async () => {
    const wardic = WardicObject.make()
    const uniforms = { uProgress: 0 }
    wardic.animate(uniforms, { uProgress: 1 })
    await tick()
    const clock = { time: 0 }
    const drawn = pump(wardic, 18, () => uniforms.uProgress, clock)
    expect(drawn[8]!).toBeGreaterThan(0.3)
    expect(drawn[8]!).toBeLessThan(0.9)
    expect(drawn.at(-1)).toBe(1)
    wardic.dispose()
  })

  it("WO9: reduced motion snaps a transform's key and animates the rest", async () => {
    const wardic = WardicObject.make({ reducedMotion: "always" })
    const mesh = { x: 0, opacity: 1 }
    wardic.animate(mesh, { x: 100, opacity: 0 }, { type: "tween", duration: 0.2, ease: "linear" })
    await tick()
    const clock = { time: 0 }
    pump(wardic, 1, () => undefined, clock)
    expect(mesh.x).toBe(100)
    expect(mesh.opacity).toBeGreaterThan(0.5)
    wardic.dispose()
  })

  it("WO10: skipAnimations lands every key on its next frame", async () => {
    const wardic = WardicObject.make({ skipAnimations: true })
    const mesh = { x: 0 }
    const controls = wardic.animate(mesh, { x: 100 }, { type: "tween", duration: 2 })
    await tick()
    pump(wardic, 1, () => undefined)
    expect(mesh.x).toBe(100)
    await controls
    wardic.dispose()
  })

  it("WO11: a string with a unit animates as one", async () => {
    const wardic = WardicObject.make()
    const node = { width: "10px" }
    wardic.animate(node, { width: "30px" }, { type: "tween", duration: 0.1, ease: "linear" })
    await tick()
    const clock = { time: 0 }
    const drawn = pump(wardic, 7, () => node.width, clock)
    expect(drawn[2]).toMatch(/^\d+(\.\d+)?px$/)
    expect(drawn.at(-1)).toBe("30px")
    wardic.dispose()
  })

  it("WO12: cancel puts the key back where the animation started it; dispose stops what runs", async () => {
    const wardic = WardicObject.make()
    const a = { x: 0 }
    const controls = wardic.animate(a, { x: 100 }, { type: "tween", duration: 1, ease: "linear" })
    await tick()
    const clock = { time: 0 }
    pump(wardic, 5, () => undefined, clock)
    controls.cancel()
    pump(wardic, 1, () => undefined, clock)
    expect(a.x).toBe(0)
    const b = { x: 0 }
    const running = wardic.animate(b, { x: 100 }, { type: "tween", duration: 1, ease: "linear" })
    await tick()
    pump(wardic, 5, () => undefined, clock)
    const at = b.x
    wardic.dispose()
    expect(running.state).toBe("idle")
    expect(b.x).toBe(at)
  })

  it("WO13: a target's Transition end is set once its keys land, and the landing includes it (#896)", async () => {
    const wardic = WardicObject.make()
    const clock = { time: 0 }
    // The issue's: 1 while it lands, then 5, already 5 when onComplete and the controls are told.
    const o = { v: 0 }
    const told: Array<number> = []
    const controls = wardic.animate(o, { v: 1, transitionEnd: { v: 5 } }, { type: "tween", duration: 0.1, ease: "linear", onComplete: () => told.push(o.v) })
    await tick()
    const drawn = pump(wardic, 12, () => o.v, clock)
    // Its last frame drawn at 1, its end the frame after.
    const atEnd = drawn.indexOf(1)
    expect(atEnd, drawn.join(" ")).toBeGreaterThan(0)
    expect(drawn.slice(0, atEnd + 1), drawn.join(" ")).not.toContain(5)
    expect(drawn[atEnd + 1], drawn.join(" ")).toBe(5)
    await controls
    expect(o.v).toBe(5)
    expect(told).toEqual([5])
    // Nothing to animate: set at once, and landed.
    const p = { v: 0 }
    const bare = wardic.animate(p, { transitionEnd: { v: 5 } })
    await tick()
    pump(wardic, 2, () => undefined, clock)
    await bare
    expect(p.v).toBe(5)
    // A key both animated and ended animates to 100, then rests at 0.
    const q = { x: 0 }
    const both = wardic.animate(q, { x: 100, transitionEnd: { x: 0 } }, { type: "tween", duration: 0.1, ease: "linear" })
    await tick()
    const moved = pump(wardic, 6, () => q.x, clock)
    expect(moved.at(-1)).toBe(100)
    pump(wardic, 3, () => undefined, clock)
    await both
    expect(q.x).toBe(0)
    wardic.dispose()
  })

  it("WO14: a target's own transition runs, the options' fields laid over it, an entry whole (#896)", async () => {
    const wardic = WardicObject.make()
    const clock = { time: 0 }
    const linear = { type: "tween", duration: 1, ease: "linear" } as const
    // The issue's: its own 1 s linear tween, half way at 0.5 s, where the Default transition has landed.
    const p = { a: 0 }
    wardic.animate(p, { a: 1, transition: linear })
    // A delay alone keeps it, and so does an onComplete alone.
    const delayed = { a: 0 }
    wardic.animate(delayed, { a: 1, transition: linear }, { delay: 0.2 })
    const told = { a: 0 }
    wardic.animate(told, { a: 1, transition: linear }, { onComplete: () => undefined })
    // The options' fields over its own: its tween and ease, the options' duration.
    const shorter = { a: 0 }
    wardic.animate(shorter, { a: 1, transition: linear }, { duration: 0.5 })
    // The options' entry in place of the target's, whole: its 1 s gone, a tween's own duration in its place.
    const entry = { a: 0 }
    wardic.animate(entry, { a: 1, transition: { a: linear } }, { a: { ease: "easeIn" } })
    await tick()
    pump(wardic, 12, () => undefined, clock)
    expect(delayed.a).toBe(0)
    pump(wardic, 18, () => undefined, clock)
    expect(entry.a).toBe(1)
    expect(p.a).toBeGreaterThan(0.4)
    expect(p.a).toBeLessThan(0.6)
    expect(told.a).toBeGreaterThan(0.4)
    expect(told.a).toBeLessThan(0.6)
    expect(shorter.a).toBeCloseTo(1, 5)
    pump(wardic, 12, () => undefined, clock)
    expect(delayed.a).toBeGreaterThan(0.4)
    expect(delayed.a).toBeLessThan(0.6)
    wardic.dispose()
  })

  it("WO15: a Subject stopped, cancelled or taken over before it lands never sets its Transition end, nor a key a later call draws; complete() does (#896); one taken over ends without landing (#951)", async () => {
    const wardic = WardicObject.make()
    const clock = { time: 0 }
    const tween = { type: "tween", duration: 0.5, ease: "linear" } as const
    const stopped = { v: 0, e: 0 }
    const stop = wardic.animate(stopped, { v: 1, transitionEnd: { e: 9 } }, tween)
    const cancelled = { v: 0, e: 0 }
    const cancel = wardic.animate(cancelled, { v: 1, transitionEnd: { e: 9 } }, tween)
    const taken = { v: 0, w: 0, e: 0 }
    const firstTold: Array<number> = []
    const first = wardic.animate(taken, { v: 1, w: 1, transitionEnd: { e: 9 } }, { ...tween, onComplete: () => firstTold.push(1) })
    let firstResolved = false
    void first.then(() => {
      firstResolved = true
    })
    const completed = { v: 0, e: 0 }
    const complete = wardic.animate(completed, { v: 1, transitionEnd: { e: 9 } }, tween)
    const drawn = { v: 0, e: 0 }
    wardic.animate(drawn, { v: 1, transitionEnd: { e: 9 } }, tween)
    await tick()
    pump(wardic, 6, () => undefined, clock)
    stop.stop()
    cancel.cancel()
    // A later call takes one of its keys: the rest land, and the first call never does.
    wardic.animate(taken, { v: 0 }, { type: "tween", duration: 0.1 })
    // A later call draws a key its end sets, still as it lands: the key is left to that call.
    wardic.animate(drawn, { e: 5 }, { type: "tween", duration: 0.8, ease: "linear" })
    complete.complete()
    await tick()
    pump(wardic, 60, () => undefined, clock)
    await complete
    expect(completed).toEqual({ v: 1, e: 9 })
    expect(stopped.e).toBe(0)
    expect(cancelled).toEqual({ v: 0, e: 0 })
    // Its other key lands, and the call ends there without landing (#951): idle, its promise pending, no
    // onComplete, its end dropped.
    await tick()
    expect(taken.w).toBe(1)
    expect(first.state).toBe("idle")
    expect(firstResolved).toBe(false)
    expect(firstTold).toEqual([])
    expect(taken.e).toBe(0)
    expect(drawn).toEqual({ v: 1, e: 5 })
    wardic.dispose()
  })

  it("WO16: once it's set, a cancel, a seek before the end and a replay put a Transition end's keys back; the next landing sets it again (#896)", async () => {
    const wardic = WardicObject.make()
    const clock = { time: 0 }
    const tween = { type: "tween", duration: 0.5, ease: "linear" } as const
    const cancelled = { v: 0, e: 0 }
    const cancel = wardic.animate(cancelled, { v: 1, transitionEnd: { e: 9 } }, tween)
    const sought = { v: 0, e: 0 }
    const seek = wardic.animate(sought, { v: 1, transitionEnd: { e: 9 } }, tween)
    const replayed = { v: 0, e: 0 }
    const replay = wardic.animate(replayed, { v: 1, transitionEnd: { e: 9 } }, tween)
    // A key both animated and ended: a cancel puts it where the call started it, not where its end found it.
    const both = { x: 10 }
    const bothCancel = wardic.animate(both, { x: 100, transitionEnd: { x: 0 } }, tween)
    await tick()
    pump(wardic, 40, () => undefined, clock)
    await Promise.all([cancel, seek, replay, bothCancel])
    expect([cancelled.e, sought.e, replayed.e, both.x]).toEqual([9, 9, 9, 0])
    cancel.cancel()
    seek.time = 0.25
    replay.play()
    bothCancel.cancel()
    await tick()
    pump(wardic, 2, () => undefined, clock)
    expect(cancelled).toEqual({ v: 0, e: 0 })
    expect(both.x).toBe(10)
    // Held where the seek put it, at half way, its end not yet set.
    expect(sought.v).toBeCloseTo(0.5, 5)
    expect(sought.e).toBe(0)
    expect(replayed.v).toBeLessThan(0.2)
    expect(replayed.e).toBe(0)
    // Put back once: a key another call has set since stays that call's as a replay runs.
    await Promise.all([wardic.animate(cancelled, { e: 3 }, { type: "tween", duration: 0.05 }), tick().then(() => pump(wardic, 6, () => undefined, clock))])
    cancel.play()
    await tick()
    pump(wardic, 3, () => undefined, clock)
    expect(cancelled.e).toBe(3)
    seek.play()
    pump(wardic, 40, () => undefined, clock)
    await Promise.all([seek, replay, cancel])
    expect(sought).toEqual({ v: 1, e: 9 })
    expect(replayed).toEqual({ v: 1, e: 9 })
    expect(cancelled).toEqual({ v: 1, e: 9 })
    // The replay's end found the other call's 3: a cancel now puts that back.
    cancel.cancel()
    pump(wardic, 2, () => undefined, clock)
    expect(cancelled).toEqual({ v: 0, e: 3 })
    wardic.dispose()
  })

  it("WO17: each Subject's Transition end is set as it lands; under reduced motion and skipAnimations, at once (#896)", async () => {
    const wardic = WardicObject.make()
    const clock = { time: 0 }
    const a = { y: 0, e: 0 }
    const b = { y: 0, e: 0 }
    wardic.animate([a, b], { y: 10, transitionEnd: { e: 9 } }, { type: "tween", duration: 0.1, ease: "linear", delay: (i) => i * 0.3 })
    await tick()
    pump(wardic, 10, () => undefined, clock)
    // a's set as a lands, while b waits out its delay.
    expect(a).toEqual({ y: 10, e: 9 })
    expect(b).toEqual({ y: 0, e: 0 })
    pump(wardic, 20, () => undefined, clock)
    expect(b).toEqual({ y: 10, e: 9 })
    wardic.dispose()
    // A positional key snaps under reduced motion: landed at once, its end set the frame after.
    const reduced = WardicObject.make({ reducedMotion: "always" })
    const snapped = { x: 0, e: 0 }
    const snap = reduced.animate(snapped, { x: 100, transitionEnd: { e: 9 } }, { type: "tween", duration: 2 })
    await tick()
    pump(reduced, 3, () => undefined)
    await snap
    expect(snapped).toEqual({ x: 100, e: 9 })
    reduced.dispose()
    const skipping = WardicObject.make({ skipAnimations: true })
    const skipped = { v: 0, e: 0 }
    const skip = skipping.animate(skipped, { v: 100, transitionEnd: { e: 9 } }, { type: "tween", duration: 2 })
    await tick()
    pump(skipping, 3, () => undefined)
    await skip
    expect(skipped).toEqual({ v: 100, e: 9 })
    skipping.dispose()
  })

  it("WO18: a stop, a cancel or a seek in the frame between its legs landing and its landing told tells none (#896)", async () => {
    const wardic = WardicObject.make()
    const clock = { time: 0 }
    const tween = { type: "tween", duration: 0.1, ease: "linear" } as const
    const told: Array<string> = []
    const make = (name: string) => {
      const o = { v: 0, e: 0 }
      const controls = wardic.animate(o, { v: 1, transitionEnd: { e: 9 } }, { ...tween, onComplete: () => told.push(name) })
      let resolved = false
      void controls.then(() => {
        resolved = true
      })
      return { o, controls, resolved: () => resolved }
    }
    const stopped = make("stopped")
    const cancelled = make("cancelled")
    const sought = make("sought")
    await tick()
    // Frame by frame until its legs land: its end set and drawn the frame after, its landing told then.
    for (let i = 0; i < 20 && stopped.o.v !== 1; i++) pump(wardic, 1, () => undefined, clock)
    expect([stopped.o.e, cancelled.o.e, sought.o.e]).toEqual([0, 0, 0])
    expect(told).toEqual([])
    stopped.controls.stop()
    cancelled.controls.cancel()
    sought.controls.time = 0.05
    sought.controls.play()
    await tick()
    const replay = pump(wardic, 12, () => sought.o.v, clock)
    await tick()
    pump(wardic, 2, () => undefined, clock)
    await sought.controls
    // Stopped where it is: its legs landed, its end set as they did, but no landing told.
    expect(stopped.resolved(), "a stop tells no landing").toBe(false)
    expect(stopped.controls.state).toBe("idle")
    expect(stopped.o).toEqual({ v: 1, e: 9 })
    expect(cancelled.resolved(), "nor does a cancel").toBe(false)
    expect(cancelled.o).toEqual({ v: 0, e: 0 })
    // The seek's replay runs on from half way and lands once, its end set again.
    expect(replay[0]!, replay.join(" ")).toBeGreaterThan(0.5)
    expect(sought.o).toEqual({ v: 1, e: 9 })
    expect(told).toEqual(["sought"])
    wardic.dispose()
  })

  it("WO19: a put back leaves a key a later call has set since; a seek to the end or complete() after it lands keeps its end (#896)", async () => {
    const wardic = WardicObject.make()
    const clock = { time: 0 }
    const tween = { type: "tween", duration: 0.1, ease: "linear" } as const
    const newer = { v: 0, e: 0 }
    const older = wardic.animate(newer, { v: 1, transitionEnd: { e: 9 } }, tween)
    const sought = { v: 0, e: 0 }
    const seek = wardic.animate(sought, { v: 1, transitionEnd: { e: 9 } }, tween)
    const completed = { v: 0, e: 0 }
    const complete = wardic.animate(completed, { v: 1, transitionEnd: { e: 9 } }, tween)
    await tick()
    pump(wardic, 12, () => undefined, clock)
    await Promise.all([older, seek, complete])
    // A later call sets e and lands: the older call's cancel puts v back, and leaves e the later call's.
    await Promise.all([wardic.animate(newer, { e: 3 }, tween), tick().then(() => pump(wardic, 10, () => undefined, clock))])
    older.cancel()
    pump(wardic, 2, () => undefined, clock)
    expect(newer).toEqual({ v: 0, e: 3 })
    // At its end already: no frame without its end.
    seek.time = 5
    complete.complete()
    await tick()
    const ends = pump(wardic, 4, () => [sought.e, completed.e], clock)
    expect(ends.flat(), JSON.stringify(ends)).not.toContain(0)
    // A cancel after puts it back as it was before its first end, not as the second found it.
    await complete
    complete.cancel()
    pump(wardic, 2, () => undefined, clock)
    expect(completed).toEqual({ v: 0, e: 0 })
    wardic.dispose()
  })

  it("WO20: a call a later one takes keys from ends without landing: at once with none left, once its other Subjects land; a run before its end takes them back; after it, play and complete do nothing (#951)", async () => {
    const wardic = WardicObject.make()
    const clock = { time: 0 }
    const tween = { type: "tween", duration: 0.5, ease: "linear" } as const
    const short = { type: "tween", duration: 0.1, ease: "linear" } as const
    const resolvedOf = (controls: PromiseLike<void>): (() => boolean) => {
      let resolved = false
      void controls.then(() => {
        resolved = true
      })
      return () => resolved
    }
    const all = { v: 0 }
    const allCall = wardic.animate(all, { v: 1 }, tween)
    const allResolved = resolvedOf(allCall)
    const a = { v: 0 }
    const b = { v: 0 }
    const pair = wardic.animate([a, b], { v: 1 }, tween)
    const pairResolved = resolvedOf(pair)
    const sought = { v: 0, w: 0 }
    const seek = wardic.animate(sought, { v: 1, w: 1 }, tween)
    const ended = { v: 0 }
    const endedCall = wardic.animate(ended, { v: 1 }, tween)
    // One Subject's part ended without landing, the other's still running: a seek takes its keys back,
    // and it lands after all.
    const c = { v: 0 }
    const d = { v: 0 }
    const retaken = wardic.animate([c, d], { v: 1 }, tween)
    await tick()
    pump(wardic, 6, () => undefined, clock)
    wardic.animate(all, { v: 0 }, short)
    wardic.animate(a, { v: 0 }, short)
    wardic.animate(c, { v: 0 }, short)
    const later = wardic.animate(sought, { v: -1 }, { type: "tween", duration: 1, ease: "linear" })
    wardic.animate(ended, { v: 0 }, short)
    await tick()
    pump(wardic, 2, () => undefined, clock)
    // Every key taken: it ends there. Its other Subject still runs: it doesn't yet.
    expect(allCall.state).toBe("idle")
    expect(pair.state).toBe("running")
    // A seek before its end takes its keys back from the later call, which has lost one in turn.
    seek.time = 0.1
    retaken.time = 0.1
    const drawn = pump(wardic, 40, () => sought.v, clock)
    await tick()
    pump(wardic, 2, () => undefined, clock)
    expect(drawn.every((v) => v >= 0.19), drawn.join(" ")).toBe(true)
    expect(sought).toEqual({ v: 1, w: 1 })
    expect(seek.state).toBe("finished")
    expect(later.state).toBe("idle")
    expect([c.v, d.v, retaken.state]).toEqual([1, 1, "finished"])
    // Its other Subject landed: it ends without landing.
    expect(b.v).toBe(1)
    expect(pair.state).toBe("idle")
    expect([allResolved(), pairResolved()]).toEqual([false, false])
    // Ended, as after a stop: play and complete do nothing.
    expect(endedCall.state).toBe("idle")
    endedCall.play()
    endedCall.complete()
    pump(wardic, 40, () => undefined, clock)
    expect(ended.v).toBe(0)
    expect(endedCall.state).toBe("idle")
    wardic.dispose()
  })
  it("WO21: a seek, complete() or a cancel then play() in the task a later call takes every key runs it again, and it lands (#951)", async () => {
    const wardic = WardicObject.make()
    const clock = { time: 0 }
    const tween = { type: "tween", duration: 0.5, ease: "linear" } as const
    const short = { type: "tween", duration: 0.1, ease: "linear" } as const
    const sought = { v: 0 }
    const seek = wardic.animate(sought, { v: 1 }, tween)
    const completed = { v: 0 }
    const complete = wardic.animate(completed, { v: 1 }, tween)
    const replayed = { v: 0 }
    const replay = wardic.animate(replayed, { v: 1 }, tween)
    await tick()
    pump(wardic, 6, () => undefined, clock)
    // Every key taken, then, in the same task, run again: the take's report is for the run before.
    wardic.animate(sought, { v: 0 }, short)
    seek.time = 0.1
    wardic.animate(completed, { v: 0 }, short)
    complete.complete()
    wardic.animate(replayed, { v: 0 }, short)
    replay.cancel()
    replay.play()
    await tick()
    pump(wardic, 40, () => undefined, clock)
    await Promise.all([seek, complete, replay])
    expect([sought.v, completed.v, replayed.v]).toEqual([1, 1, 1])
    expect([seek.state, complete.state, replay.state]).toEqual(["finished", "finished", "finished"])
    wardic.dispose()
  })

  it("WO22: a key taken after its leg landed, or one that snaps, doesn't keep the call from landing, as Motion's (#951)", async () => {
    const wardic = WardicObject.make()
    const clock = { time: 0 }
    const short = { type: "tween", duration: 0.1, ease: "linear" } as const
    // v on a 0.1 s entry, w on the call's 0.5 s: v lands, then a later call takes it; the call lands with w.
    const perKey = { type: "tween", duration: 0.5, ease: "linear", v: short } as const
    const o = { v: 0, w: 0 }
    const call = wardic.animate(o, { v: 1, w: 1 }, perKey)
    await tick()
    pump(wardic, 14, () => undefined, clock)
    expect(o.v).toBe(1)
    wardic.animate(o, { v: 0 }, short)
    await tick()
    pump(wardic, 30, () => undefined, clock)
    await call
    expect(call.state).toBe("finished")
    wardic.dispose()
    // Skipped, and reduced motion's snapped x: taken in the task they start, before their first frame.
    const skipping = WardicObject.make({ skipAnimations: true })
    const skipped = { v: 0 }
    const skip = skipping.animate(skipped, { v: 1 }, { type: "tween", duration: 2 })
    skipping.animate(skipped, { v: 0 }, short)
    await tick()
    pump(skipping, 4, () => undefined)
    await skip
    expect(skip.state).toBe("finished")
    skipping.dispose()
    const reduced = WardicObject.make({ reducedMotion: "always" })
    const snapped = { x: 0 }
    const snap = reduced.animate(snapped, { x: 100 }, { type: "tween", duration: 2 })
    reduced.animate(snapped, { x: 0 }, short)
    await tick()
    pump(reduced, 4, () => undefined)
    await snap
    expect(snap.state).toBe("finished")
    reduced.dispose()
  })

  it("WO23: a typed array's elements animate by index, each on its own entry, and an optional key the object has animates (#964)", async () => {
    const wardic = WardicObject.make()
    const clock = { time: 0 }
    const short = { type: "tween", duration: 0.1, ease: "linear" } as const
    // [0] on a 0.1 s entry, [1] on the call's 0.5 s: a quarter second in, the first has landed, the second hasn't.
    const weights = new Float32Array(2)
    const call = wardic.animate(weights, { 0: 1, 1: 1 }, { type: "tween", duration: 0.5, ease: "linear", 0: short })
    await tick()
    pump(wardic, 15, () => undefined, clock)
    expect(weights[0]).toBe(1)
    expect(weights[1], `[1] at a quarter second: ${weights[1]}`).toBeGreaterThan(0.3)
    expect(weights[1]).toBeLessThan(0.7)
    pump(wardic, 20, () => undefined, clock)
    await call
    expect(Array.from(weights)).toEqual([1, 1])
    // A key the object may lack, which it has: as any other.
    const sprite: { a?: number; b: number } = { a: 0, b: 0 }
    const moved = wardic.animate(sprite, { a: 1, transitionEnd: { a: 2 } }, short)
    await tick()
    pump(wardic, 10, () => undefined, clock)
    await moved
    expect(sprite).toEqual({ a: 2, b: 0 })
    wardic.dispose()
  })

  it("WO25: a Transition end's key the object lacks, or one it can't write, is an error at the call naming it, and nothing of the call animates (#970)", async () => {
    const wardic = WardicObject.make()
    const clock = { time: 0 }
    const sprite = { x: 0, z: 0 }
    expect(() => wardic.animate(sprite as { x: number; y: number; z: number }, { x: 1, transitionEnd: { y: 2, z: 3 } })).toThrow(/the object has no "y" to animate/)
    const pinned = Object.defineProperty({ x: 0, z: 0 }, "y", { value: 0, enumerable: true }) as { x: number; y: number; z: number }
    expect(() => wardic.animate(pinned, { x: 1, transitionEnd: { y: 2, z: 3 } })).toThrow(/the object's "y" can't be written/)
    // A list's later object's, and an end with no key to animate.
    const first = { x: 0, y: 0 }
    expect(() => wardic.animate([first, Object.freeze({ x: 0, y: 0 })], { x: 1, transitionEnd: { y: 2 } })).toThrow(/the object's "y" can't be written/)
    const bare: { readonly v: number } = Object.freeze({ v: 0 })
    expect(() => wardic.animate(bare, { transitionEnd: { v: 5 } })).toThrow(/the object's "v" can't be written/)
    await tick()
    expect(wardic.wantsFrame()).toBe(false)
    pump(wardic, 12, () => undefined, clock)
    expect(sprite).toEqual({ x: 0, z: 0 })
    expect(pinned).toEqual({ x: 0, y: 0, z: 0 })
    expect(first).toEqual({ x: 0, y: 0 })
    wardic.dispose()
  })

  it("WO26: a Transition end's key it can no longer set when the call lands is reported once, and the call lands with the rest of its end set (#970)", async () => {
    const wardic = WardicObject.make()
    const clock = { time: 0 }
    const said: Array<string> = []
    const log = console.log
    console.log = (...args: Array<unknown>) => void said.push(args.map(String).join(" "))
    try {
      // Made read-only after the call, before it lands.
      const sprite = { x: 0, y: 0, z: 0 }
      const call = wardic.animate(sprite, { x: 1, transitionEnd: { y: 2, z: 3 } }, { type: "tween", duration: 0.1, ease: "linear" })
      Object.defineProperty(sprite, "y", { writable: false })
      await tick()
      pump(wardic, 12, () => undefined, clock)
      expect(call.state).toBe("finished")
      await call
      expect(sprite).toEqual({ x: 1, y: 0, z: 3 })
      // Deleted after the call: the same.
      const ghost: { x: number; y?: number; z: number } = { x: 0, y: 0, z: 0 }
      const gone = wardic.animate(ghost, { x: 1, transitionEnd: { y: 2, z: 3 } }, { type: "tween", duration: 0.1, ease: "linear" })
      delete ghost.y
      await tick()
      pump(wardic, 12, () => undefined, clock)
      expect(gone.state).toBe("finished")
      await gone
      expect(ghost).toEqual({ x: 1, z: 3 })
      // Each reported once, with the object's own error, and nothing else said.
      const told = said.filter((line) => line.includes("wardic."))
      expect(told, said.join("\n")).toHaveLength(2)
      expect(told[0]).toContain(`wardic.animate: a Transition end's "y" couldn't be set, the rest of it set and the animation landed`)
      expect(told[0]).toContain(`the object's "y" can't be written`)
      expect(told[1]).toContain(`wardic.animate: a Transition end's "y" couldn't be set`)
      expect(told[1]).toContain(`the object has no "y" to animate`)
    } finally {
      console.log = log
      wardic.dispose()
    }
  })

  it("WO27: a call refused at the call takes nothing: an earlier call runs on and lands after the same Subject's later key, a list's later Subject, its end key or a sequence's later Segment is refused (#973)", async () => {
    const wardic = WardicObject.make()
    const clock = { time: 0 }
    const run = { type: "tween", duration: 0.5, ease: "linear" } as const
    const frozen = (): { readonly x: number; readonly y: number } => Object.freeze({ x: 0, y: 0 })
    // Its `y` read-only, its `x` not: a call taking `x` first, then refused at `y`.
    const pinned = (): { x: number; y: number } => Object.defineProperty({ x: 0 }, "y", { value: 0, enumerable: true }) as { x: number; y: number }
    const refusals: ReadonlyArray<{ readonly shape: string; readonly first: { x: number; y: number }; readonly refuse: (first: { x: number; y: number }) => unknown }> = [
      { shape: "the same Subject's later key", first: pinned(), refuse: (first) => wardic.animate(first, { x: 1, y: 1 }) },
      { shape: "a list's later Subject", first: { x: 0, y: 0 }, refuse: (first) => wardic.animate([first, frozen()], { x: 1 }) },
      { shape: "a list's later Subject's end key", first: { x: 0, y: 0 }, refuse: (first) => wardic.animate([first, pinned()], { x: 1, transitionEnd: { y: 2 } }) },
      { shape: "a sequence's later Segment's Subject", first: { x: 0, y: 0 }, refuse: (first) => wardic.animate([[first, { x: 1 }], [frozen(), { x: 1 }]]) },
    ]
    for (const { shape, first, refuse } of refusals) {
      const earlier = wardic.animate(first, { x: 10 }, run)
      await tick()
      pump(wardic, 5, () => undefined, clock)
      expect(() => refuse(first), shape).toThrow(/can't be written/)
      await tick()
      pump(wardic, 40, () => undefined, clock)
      // Each shape on its own: a failure doesn't hide the next.
      expect.soft(earlier.state, shape).toBe("finished")
      expect.soft(first.x, shape).toBe(10)
      if (earlier.state === "finished") await earlier
    }
    wardic.dispose()
  })

  it("WO28: an object frozen mid-run is reported once, and an animation of another object after it still runs and lands (#969)", async () => {
    const wardic = WardicObject.make()
    const clock = { time: 0 }
    const said: Array<string> = []
    const log = console.log
    console.log = (...args: Array<unknown>) => void said.push(args.map(String).join(" "))
    try {
      const run = { type: "tween", duration: 0.1, ease: "linear" } as const
      // Its call first, so the gate commits it first: before #969, its throw ended each frame's flush.
      const stuck = { x: 0 }
      const plain = { x: 0 }
      wardic.animate(stuck, { x: 1 }, run)
      const moving = wardic.animate(plain, { x: 1 }, run)
      await tick()
      pump(wardic, 1, () => undefined, clock)
      Object.freeze(stuck)
      const drawn = pump(wardic, 12, () => plain.x, clock)
      // It moves each frame: on main it stayed at its first frame's value.
      expect(new Set(drawn).size, drawn.join(" ")).toBeGreaterThan(3)
      await moving
      expect(plain.x).toBe(1)
      const told = said.filter((line) => line.includes("wardic."))
      expect(told, said.join("\n")).toHaveLength(1)
      expect(told[0]).toContain("wardic.gate: a commit failed")
      expect(told[0]).toContain("Cannot assign to read only property")
    } finally {
      console.log = log
      wardic.dispose()
    }
  })

  it("WO29: a call whose onComplete throws still ends finished, reported at each landing, and play() plays it again (#977)", async () => {
    const wardic = WardicObject.make()
    const clock = { time: 0 }
    const target = { x: 0 }
    // What it is as its onComplete runs: finished already, as Motion's.
    const seen: Array<string> = []
    const reports = await reportsDuring(async () => {
      const call = wardic.animate(target, { x: 1 }, {
        type: "tween",
        duration: 0.1,
        ease: "linear",
        onComplete: () => {
          seen.push(call.state)
          throw new Error("its onComplete threw")
        },
      })
      await tick()
      pump(wardic, 12, () => undefined, clock)
      await tick()
      // Before #977, its throw skipped the call's end: "running" for good, and play() did nothing.
      expect(call.state).toBe("finished")
      await call
      call.play()
      expect(call.state).toBe("running")
      await tick()
      const replayed = pump(wardic, 12, () => target.x, clock)
      await tick()
      expect(replayed[0]).toBeLessThan(0.5)
      expect(call.state).toBe("finished")
    })
    expect(reports).toEqual(["wardic.animate: an onComplete failed", "wardic.animate: an onComplete failed"])
    expect(seen).toEqual(["finished", "finished"])
    wardic.dispose()
  })

  it("WO30: a function Segment whose callback throws is called again each frame and lands with its sequence, reported once a run of throws, a replay's its own (#979)", async () => {
    const wardic = WardicObject.make()
    const clock = { time: 0 }
    const ball = { x: 0 }
    const told: Array<number> = []
    let calls = 0
    let breaking = false
    const reports = await reportsDuring(async () => {
      const sequence = wardic.animate([
        [ball, { x: 10 }, { duration: 0.2, ease: "linear" }],
        [
          (value: number) => {
            calls++
            if (breaking) throw new Error(`call ${calls} threw`)
            told.push(value)
          },
          [0, 1],
          { duration: 0.2, ease: "linear", at: 0 },
        ],
      ])
      await tick()
      pump(wardic, 2, () => undefined, clock)
      // Two runs of throws: three frames, then from the fifth frame on to its last.
      breaking = true
      pump(wardic, 3, () => undefined, clock)
      breaking = false
      pump(wardic, 2, () => undefined, clock)
      breaking = true
      pump(wardic, 30, () => undefined, clock)
      await tick()
      // Before #979, its first throw ended its run: it was told no more, and the sequence stayed "running".
      expect(calls).toBeGreaterThan(10)
      expect(ball.x).toBe(10)
      expect(sequence.state).toBe("finished")
      await sequence
      // Played again, still throwing: a run of its own, reported again; then told to its end.
      sequence.play()
      await tick()
      pump(wardic, 2, () => undefined, clock)
      breaking = false
      pump(wardic, 30, () => undefined, clock)
      await tick()
      expect(told.at(-1)).toBe(1)
      expect(sequence.state).toBe("finished")
    })
    expect(reports).toEqual(["wardic.animate: a function Segment failed", "wardic.animate: a function Segment failed", "wardic.animate: a function Segment failed"])
    wardic.dispose()
  })

  it("WO31: a cancel whose function Segment's callback throws at its first stop still cancels the call: nothing comes out of cancel(), its object is put back, and it's reported (#979)", async () => {
    const wardic = WardicObject.make()
    const clock = { time: 0 }
    const ball = { x: 0 }
    let cancelling = false
    const reports = await reportsDuring(async () => {
      const sequence = wardic.animate([
        [
          () => {
            if (cancelling) throw new Error("its cancel threw")
          },
          [0, 1],
          { duration: 0.5, ease: "linear" },
        ],
        [ball, { x: 10 }, { duration: 0.5, ease: "linear", at: 0 }],
      ])
      await tick()
      pump(wardic, 6, () => undefined, clock)
      expect(ball.x).toBeGreaterThan(0)
      cancelling = true
      // Before #979, its throw came out of cancel(), before the object's Segment was put back.
      expect(() => sequence.cancel()).not.toThrow()
      await tick()
      pump(wardic, 2, () => undefined, clock)
      expect(ball.x).toBe(0)
      expect(sequence.state).toBe("idle")
    })
    expect(reports).toEqual(["wardic.animate: a function Segment's cancel failed"])
    wardic.dispose()
  })

  it("WO32: a list call whose delay(i, n) throws for a later Subject takes nothing: an earlier call's animation of the first runs on and lands (#979)", async () => {
    const wardic = WardicObject.make()
    const clock = { time: 0 }
    const first = { x: 0 }
    const second = { x: 0 }
    const earlier = wardic.animate(first, { x: 10 }, { type: "tween", duration: 0.5, ease: "linear" })
    await tick()
    pump(wardic, 5, () => undefined, clock)
    // Before #979, each Subject's delay was worked out as its track was built: the first's took x first.
    const delay = (i: number): number => {
      if (i === 1) throw new Error("its delay threw")
      return 0
    }
    expect(() => wardic.animate([first, second], { x: 1 }, { delay })).toThrow(/its delay threw/)
    await tick()
    pump(wardic, 40, () => undefined, clock)
    expect(earlier.state).toBe("finished")
    expect(first.x).toBe(10)
    await earlier
    wardic.dispose()
  })

  it("WO33: a resolver given as a call's target that throws is still an error at the call, and takes nothing (#979)", async () => {
    const wardic = WardicObject.make()
    const clock = { time: 0 }
    const ball = { x: 0 }
    const earlier = wardic.animate(ball, { x: 10 }, { type: "tween", duration: 0.5, ease: "linear" })
    await tick()
    pump(wardic, 5, () => undefined, clock)
    const resolver = (): never => {
      throw new Error("its target broke")
    }
    // A resolver's throw is caught where every resolver runs (#979): at a call it's thrown again, a refusal.
    expect(() => wardic.animate(ball, resolver as never)).toThrow(/its target broke/)
    await tick()
    pump(wardic, 40, () => undefined, clock)
    expect(earlier.state).toBe("finished")
    expect(ball.x).toBe(10)
    wardic.dispose()
  })
})
