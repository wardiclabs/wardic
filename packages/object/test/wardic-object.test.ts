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

  it("WO7: a key the object lacks, one that isn't a number or a string, and a subject that isn't an object are errors naming them", () => {
    const wardic = WardicObject.make()
    class Sprite {
      x = 0
      tint = { r: 1 }
    }
    expect(() => wardic.animate({ x: 0 } as { x: number; y: number }, { y: 1 })).toThrow(/the object has no "y" to animate/)
    expect(() => wardic.animate(new Sprite() as unknown as { tint: number }, { tint: 0 })).toThrow(/a Sprite's "tint" is object, which can't be animated/)
    expect(() => wardic.animate(42 as unknown as object, {})).toThrow(/42 isn't an object to animate/)
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
})

