/**
 * A Batch of plain objects (#882, ADR-0073 *Amendment (#882)*, PR 3): one run for many objects, on frames
 * the test pumps, its calls core's `BatchCalls`, the DOM's. Node, with no DOM.
 */
import * as WardicObject from "@wardic/object/WardicObject"
import { describe, expect, it } from "@effect/vitest"

const FRAME = 1000 / 60
const LINEAR = { type: "tween", duration: 0.1, ease: "linear" } as const

/** A microtask: the one a run waits before it asks for its first frame. */
const tick = (): Promise<void> => Promise.resolve()

/** `n` frames of 1/60 s, continuing `clock`. */
const pump = (wardic: WardicObject.WardicObject, n: number, clock = { time: 0 }): void => {
  for (let i = 0; i < n; i++) {
    clock.time += FRAME
    wardic.frame(clock.time)
  }
}

const sprites = (n: number) => Array.from({ length: n }, () => ({ x: 0, y: 0, opacity: 1 }))

describe("ObjectBatch: many objects as one run", () => {
  it("OB1: a function of each member's index gives its target, and every member lands there, written on its object", async () => {
    const wardic = WardicObject.make()
    const dots = sprites(4)
    const swarm = wardic.batch(dots)
    const controls = wardic.animate(swarm, { x: (i) => i * 10 }, LINEAR)
    await tick()
    pump(wardic, 3)
    expect(dots[3]!.x).toBeGreaterThan(0)
    expect(dots[3]!.x).toBeLessThan(30)
    pump(wardic, 6)
    expect(dots.map((dot) => dot.x)).toEqual([0, 10, 20, 30])
    await controls
    wardic.dispose()
  })

  it("OB2: two stops start each member at the first, then move it to the target", async () => {
    const wardic = WardicObject.make()
    const dots = sprites(2)
    wardic.animate(wardic.batch(dots), { y: [-20, (i) => i * 5] }, LINEAR)
    await tick()
    pump(wardic, 1)
    expect(dots[0]!.y).toBeLessThan(-10)
    pump(wardic, 8)
    expect(dots.map((dot) => dot.y)).toEqual([0, 5])
    wardic.dispose()
  })

  it("OB3: a member's handle, batch.at(i), moves that member alone", async () => {
    const wardic = WardicObject.make()
    const dots = sprites(3)
    const swarm = wardic.batch(dots)
    wardic.animate(swarm.at(1), { x: 50 }, LINEAR)
    await tick()
    pump(wardic, 9)
    expect(dots.map((dot) => dot.x)).toEqual([0, 50, 0])
    expect(swarm.get(1, "x")).toBe(50)
    wardic.dispose()
  })

  it("OB4: its keys are its first call's; a later key is an error naming it and `keys`, which fixes them up front", async () => {
    const wardic = WardicObject.make()
    const swarm = wardic.batch(sprites(2))
    wardic.animate(swarm, { x: 10 }, LINEAR)
    expect(() => wardic.animate(swarm, { opacity: 0 }, LINEAR)).toThrow(/"opacity" isn't one of its keys \(x\).*give them all as `keys`/)
    const fixed = wardic.batch(sprites(2), { keys: ["x", "opacity"] })
    wardic.animate(fixed, { x: 10 }, LINEAR)
    expect(() => wardic.animate(fixed, { opacity: 0 }, LINEAR)).not.toThrow()
    wardic.dispose()
  })

  it("OB5: a stagger counts the members a change moves, so each sets off after the one before", async () => {
    const wardic = WardicObject.make()
    const dots = sprites(3)
    wardic.animate(wardic.batch(dots), { x: 10 }, { ...LINEAR, delay: (rank) => rank * 0.1 })
    await tick()
    pump(wardic, 7)
    expect(dots[0]!.x).toBe(10)
    expect(dots[1]!.x).toBeLessThan(10)
    expect(dots[2]!.x).toBe(0)
    pump(wardic, 14)
    expect(dots.map((dot) => dot.x)).toEqual([10, 10, 10])
    wardic.dispose()
  })

  it("OB6: an object of a Batch given to animate itself, and an object in two Batches, are errors naming the way", () => {
    const wardic = WardicObject.make()
    const dots = sprites(3)
    wardic.batch(dots)
    expect(() => wardic.animate(dots[2]!, { x: 1 })).toThrow(/member 2 of a Batch.*batch\.at\(2\)/)
    expect(() => wardic.animate([[dots[1]!, { x: 1 }]])).toThrow(/member 1 of a Batch/)
    expect(() => wardic.batch([dots[0]!])).toThrow(/already a member of a Batch/)
    wardic.dispose()
  })

  it("OB7: a sequence plays a Segment of a Batch, then a Segment of an object, on one set of controls", async () => {
    const wardic = WardicObject.make()
    const dots = sprites(2)
    const title = { opacity: 0 }
    const controls = wardic.animate([
      [wardic.batch(dots), { y: (i) => (i + 1) * 10 }, LINEAR],
      [title, { opacity: 1 }, LINEAR],
    ])
    await tick()
    pump(wardic, 7)
    expect(dots.map((dot) => dot.y)).toEqual([10, 20])
    expect(title.opacity).toBeLessThan(0.5)
    pump(wardic, 8)
    expect(title.opacity).toBe(1)
    await controls
    wardic.dispose()
  })

  it("OB8: get and velocity read a member's key: its own value before the Batch moves, then as drawn", async () => {
    const wardic = WardicObject.make()
    const dots = [{ x: 7, y: 0, opacity: 1 }]
    const swarm = wardic.batch(dots)
    expect(swarm.get(0, "x")).toBe(7)
    expect(swarm.velocity(0, "x")).toBe(0)
    wardic.animate(swarm, { x: 17 }, LINEAR)
    await tick()
    pump(wardic, 3)
    expect(swarm.get(0, "x")).toBe(dots[0]!.x)
    expect(swarm.velocity(0, "x")).toBeGreaterThan(0)
    wardic.dispose()
  })

  it("OB9: cancel puts the members back where the change started them", async () => {
    const wardic = WardicObject.make()
    const dots = sprites(2)
    const controls = wardic.animate(wardic.batch(dots), { x: 100 }, { type: "tween", duration: 1, ease: "linear" })
    await tick()
    pump(wardic, 5)
    controls.cancel()
    pump(wardic, 1)
    expect(dots.map((dot) => dot.x)).toEqual([0, 0])
    wardic.dispose()
  })

  it("OB10: reduced motion snaps a Batch's positional key, and animates the rest", async () => {
    const wardic = WardicObject.make({ reducedMotion: "always" })
    const dots = sprites(2)
    wardic.animate(wardic.batch(dots), { x: 40, opacity: 0 }, { type: "tween", duration: 0.2, ease: "linear" })
    await tick()
    pump(wardic, 1)
    expect(dots.map((dot) => dot.x)).toEqual([40, 40])
    expect(dots[0]!.opacity).toBeGreaterThan(0.5)
    wardic.dispose()
  })

  it("OB11: a later call turns each member from where it's drawn, keeping its speed", async () => {
    const wardic = WardicObject.make()
    const dots = sprites(1)
    const swarm = wardic.batch(dots)
    const spring = { type: "spring", stiffness: 100, damping: 10 } as const
    wardic.animate(swarm, { x: 100 }, spring)
    await tick()
    const clock = { time: 0 }
    pump(wardic, 6, clock)
    const at = dots[0]!.x
    wardic.animate(swarm, { x: 0 }, spring)
    await tick()
    pump(wardic, 1, clock)
    expect(dots[0]!.x).toBeGreaterThan(at)
    wardic.dispose()
  })

  it("OB13: an Environment's batchSource makes a Batch of what isn't a list, drawn and read its own way; anything else is an error", async () => {
    const strip = { cells: [0, 0, 0] }
    const flushes: Array<number> = []
    const environment: WardicObject.Environment = {
      ...WardicObject.OBJECTS,
      batchSource: (given) => {
        if (given !== strip) return undefined
        return {
          members: [0, 1, 2].map((index) => ({ index })),
          writer: {
            writes: (key) => key === "level",
            forKeys: () => (subject, positions, base) => {
              strip.cells[(subject as { readonly index: number }).index] = positions[base]!
            },
            flush: () => void flushes.push(strip.cells[2]!),
          },
          read: (subject) => strip.cells[(subject as { readonly index: number }).index],
        }
      },
    }
    const wardic = WardicObject.makeWith(environment)
    // Typed for lists: an Environment's own `batch` types what its source takes (`@wardic/three`'s).
    const cells = wardic.batch(strip as never)
    const controls = wardic.animate(cells, { level: (i: number) => i + 1 } as never, LINEAR)
    await tick()
    pump(wardic, 9)
    await controls
    expect(strip.cells).toEqual([1, 2, 3])
    expect(flushes.at(-1)).toBe(3)
    expect(() => WardicObject.make().batch({ cells: [] } as never)).toThrow(/a Batch is made of a list of objects/)
    wardic.dispose()
  })

  it("OB12: a member whose key isn't a number is an error naming it, at the Batch's first call", () => {
    const wardic = WardicObject.make()
    const swarm = wardic.batch([{ x: 0 }, { x: "far" as unknown as number }])
    expect(() => wardic.animate(swarm, { x: 1 })).toThrow(/member 1's "x" is "far"/)
    wardic.dispose()
  })
  it("OB14: a Batch call, or a sequence of a Batch, a later one takes a member's key from ends without landing, once the keys it kept land (#951)", async () => {
    const wardic = WardicObject.make()
    const clock = { time: 0 }
    const dots = sprites(2)
    const swarm = wardic.batch(dots)
    const told: Array<number> = []
    const first = wardic.animate(swarm, { x: 10, y: 10 }, { type: "tween", duration: 0.5, ease: "linear", onComplete: () => told.push(1) })
    let resolved = false
    void first.then(() => {
      resolved = true
    })
    // A sequence's Segment of a Batch, the same.
    const others = sprites(2)
    const flock = wardic.batch(others)
    const sequence = wardic.animate([[flock, { x: 10, y: 10 }, { duration: 0.5, ease: "linear" }]])
    await tick()
    pump(wardic, 6, clock)
    wardic.animate(swarm.at(0), { x: 0 }, LINEAR)
    wardic.animate(flock.at(0), { x: 0 }, LINEAR)
    await tick()
    pump(wardic, 40, clock)
    await tick()
    pump(wardic, 2, clock)
    // Its other keys landed; member 0's x is the later call's.
    expect(dots.map((dot) => [dot.x, dot.y])).toEqual([[0, 10], [10, 10]])
    expect(first.state).toBe("idle")
    expect(resolved).toBe(false)
    expect(told).toEqual([])
    expect(others.map((dot) => [dot.x, dot.y])).toEqual([[0, 10], [10, 10]])
    expect(sequence.state).toBe("idle")
    wardic.dispose()
  })
  it("OB15: a member's key taken after it landed, or one that snaps, doesn't keep a Batch call from landing (#951)", async () => {
    const wardic = WardicObject.make()
    const clock = { time: 0 }
    // x on a 0.1 s entry, y on the call's 0.5 s: x lands, then a later call takes member 0's; the call lands with y.
    const perKey = { type: "tween", duration: 0.5, ease: "linear", x: LINEAR } as const
    const dots = sprites(2)
    const swarm = wardic.batch(dots)
    const call = wardic.animate(swarm, { x: 10, y: 10 }, perKey)
    await tick()
    pump(wardic, 14, clock)
    expect(dots[0]!.x).toBe(10)
    wardic.animate(swarm.at(0), { x: 0 }, LINEAR)
    await tick()
    pump(wardic, 30, clock)
    await call
    expect(call.state).toBe("finished")
    wardic.dispose()
    // Skipped: taken in the task it starts, before its first frame.
    const skipping = WardicObject.make({ skipAnimations: true })
    const flock = skipping.batch(sprites(2))
    const skip = skipping.animate(flock, { x: 10 }, { type: "tween", duration: 2 })
    skipping.animate(flock.at(0), { x: 0 }, LINEAR)
    await tick()
    pump(skipping, 4)
    await skip
    expect(skip.state).toBe("finished")
    skipping.dispose()
  })
})
