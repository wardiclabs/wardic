import * as DragActivity from "@wardic/core/DragActivity"
import * as InputSource from "@wardic/core/InputSource"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"

// The pointer helpers core ships for Environments and tests (ADR-0019, decision 5
// and 3b): the event builder with mouse defaults, Motion's Primary pointer rule,
// and the Drag activity counter, with its Drag claims (ADR-0019, *Amendment (#29)*). Written
// against the pinned shapes before they exist.

type PointerType = InputSource.PointerLikeEvent["type"]

describe("makePointerLikeEvent", () => {
  it("C1: fills mouse defaults per type, and an override wins", () => {
    // Every type, with no fields but `type`.
    const types: ReadonlyArray<PointerType> = ["down", "move", "up", "cancel", "enter", "leave"]
    const built = types.map((type) => InputSource.makePointerLikeEvent({ type }))
    // Shared defaults, then `button` and `buttons` per type.
    for (const event of built) {
      expect(event.pointerId).toBe(1)
      expect(event.x).toBe(0)
      expect(event.y).toBe(0)
      expect(event.timeStamp).toBe(0)
      expect(event.pointerType).toBe("mouse")
      expect(event.isPrimary).toBe(true)
    }
    expect(built.map((event) => event.button)).toEqual([0, -1, 0, -1, -1, -1])
    expect(built.map((event) => event.buttons)).toEqual([1, 1, 0, 0, 0, 0])
    // An override beats the default it replaces.
    const overridden = InputSource.makePointerLikeEvent({
      type: "down",
      pointerId: 7,
      x: 3,
      y: 4,
      timeStamp: 9,
      pointerType: "touch",
      button: 2,
      buttons: 0,
      isPrimary: false,
    })
    expect(overridden).toEqual({
      type: "down",
      pointerId: 7,
      x: 3,
      y: 4,
      timeStamp: 9,
      pointerType: "touch",
      button: 2,
      buttons: 0,
      isPrimary: false,
    })
  })
})

describe("isPrimaryPointer", () => {
  // Motion's rule: a mouse event is primary when `button <= 0`; anything else follows `isPrimary`.
  const table: ReadonlyArray<{
    readonly name: string
    readonly pointerType: string
    readonly button: number
    readonly isPrimary: boolean
    readonly expected: boolean
  }> = [
    { name: "mouse, no button change", pointerType: "mouse", button: -1, isPrimary: true, expected: true },
    { name: "mouse, left button", pointerType: "mouse", button: 0, isPrimary: true, expected: true },
    { name: "mouse, middle button", pointerType: "mouse", button: 1, isPrimary: true, expected: false },
    { name: "mouse, right button", pointerType: "mouse", button: 2, isPrimary: true, expected: false },
    { name: "touch, primary", pointerType: "touch", button: 0, isPrimary: true, expected: true },
    { name: "pen, primary", pointerType: "pen", button: 0, isPrimary: true, expected: true },
    { name: "touch, not primary", pointerType: "touch", button: 0, isPrimary: false, expected: false },
    { name: "pen, not primary", pointerType: "pen", button: 0, isPrimary: false, expected: false },
  ]

  it("C2: mouse follows its button, touch and pen follow isPrimary", () => {
    for (const row of table) {
      const event = InputSource.makePointerLikeEvent({
        type: "down",
        pointerType: row.pointerType,
        button: row.button,
        isPrimary: row.isPrimary,
      })
      expect(InputSource.isPrimaryPointer(event), row.name).toBe(row.expected)
    }
  })
})

describe("DragActivity", () => {
  it("C3: a count makes it active, two counts need two releases, a release is idempotent", () => {
    const activity = DragActivity.make()
    // A fresh one is inactive.
    expect(activity.isDragActive()).toBe(false)
    // One count.
    const releaseA = activity.count()
    expect(activity.isDragActive()).toBe(true)
    // A second count, then release the first twice.
    const releaseB = activity.count()
    releaseA()
    releaseA()
    // The double release counted once, so B still holds it.
    expect(activity.isDragActive()).toBe(true)
    releaseB()
    expect(activity.isDragActive()).toBe(false)
    // Releasing again after it reached zero doesn't go negative and break the next count.
    releaseB()
    const releaseC = activity.count()
    expect(activity.isDragActive()).toBe(true)
    releaseC()
    expect(activity.isDragActive()).toBe(false)
  })

  it("C4: the Reference defaults to one shared instance, and a provided one is independent", () => {
    // Two separate runs with no layer.
    const first = Effect.runSync(Effect.gen(function* () { return yield* DragActivity.DragActivity }))
    const second = Effect.runSync(Effect.gen(function* () { return yield* DragActivity.DragActivity }))
    // The same cached default (one page-wide instance).
    expect(second).toBe(first)
    // An instance provided for one run.
    const provided = DragActivity.make()
    const seen = Effect.runSync(
      Effect.gen(function* () { return yield* DragActivity.DragActivity }).pipe(Effect.provideService(DragActivity.DragActivity, provided)),
    )
    // It is the provided one, independent of the default.
    expect(seen).toBe(provided)
    expect(seen).not.toBe(first)
    const release = provided.count()
    expect(provided.isDragActive()).toBe(true)
    expect(first.isDragActive()).toBe(false)
    release()
  })
  // The Drag claims (#29): a target holds the axes it claimed, each on its own; another target
  // that needs one is refused; one target's claims share its hold, which ends at the last release.
  const A = { name: "A" }
  const B = { name: "B" }
  const C = { name: "C" }
  const take = (activity: DragActivity.Shape, target: unknown, axis: "x" | "y" | "xy") =>
    Option.getOrThrowWith(activity.claim(target, axis), () => new Error(`refused: ${axis}`))

  it("C5: a free claim refuses another target on either axis, and a refused claim counts nothing", () => {
    const activity = DragActivity.make()
    const releaseA = take(activity, A, "xy")
    expect(activity.isDragActive()).toBe(true)
    expect(Option.isNone(activity.claim(B, "xy"))).toBe(true)
    expect(Option.isNone(activity.claim(B, "x"))).toBe(true)
    expect(Option.isNone(activity.claim(B, "y"))).toBe(true)
    releaseA()
    // The refusals counted nothing, so nothing is active once A has released.
    expect(activity.isDragActive()).toBe(false)
    // And B claims now.
    const releaseB = take(activity, B, "xy")
    releaseB()
    expect(activity.isDragActive()).toBe(false)
  })

  it("C6: each axis is claimed on its own: x and y by two targets, and a free claim needs both", () => {
    const activity = DragActivity.make()
    const releaseX = take(activity, A, "x")
    // Another target takes the other axis.
    const releaseY = take(activity, B, "y")
    // A third needs both, or either, and is refused.
    expect(Option.isNone(activity.claim(C, "xy"))).toBe(true)
    expect(Option.isNone(activity.claim(C, "x"))).toBe(true)
    expect(Option.isNone(activity.claim(C, "y"))).toBe(true)
    // Once x is free, a free claim still needs y.
    releaseX()
    expect(Option.isNone(activity.claim(C, "xy"))).toBe(true)
    const releaseCx = take(activity, C, "x")
    releaseY()
    releaseCx()
    expect(activity.isDragActive()).toBe(false)
    take(activity, C, "xy")()
  })

  it("C7: one target's claims share its hold, which ends at its last release; a repeated release frees nothing more", () => {
    const activity = DragActivity.make()
    const first = take(activity, A, "xy")
    // The same target claims again: never refused by itself.
    const second = take(activity, A, "x")
    first()
    first()
    // A still holds x through its second claim, so B is refused x; y is free again.
    expect(Option.isNone(activity.claim(B, "x"))).toBe(true)
    const releaseBy = take(activity, B, "y")
    second()
    const releaseBx = take(activity, B, "x")
    releaseBx()
    releaseBy()
    expect(activity.isDragActive()).toBe(false)
  })

  it("C8: a count claims no axis and refuses no one, but keeps the activity on", () => {
    const activity = DragActivity.make()
    const counted = activity.count()
    const releaseA = take(activity, A, "xy")
    releaseA()
    expect(activity.isDragActive()).toBe(true)
    counted()
    expect(activity.isDragActive()).toBe(false)
  })
})
