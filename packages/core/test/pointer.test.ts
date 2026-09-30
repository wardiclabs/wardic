import { DragActivity, isPrimaryPointer, makeDragActivity, makePointerLikeEvent, type PointerLikeEvent } from "@wardic/core"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

// The pointer helpers core ships for Environments and tests (ADR-0019, decision 5
// and 3b): the event builder with mouse defaults, Motion's Primary pointer rule,
// and the Drag activity counter. Written against the pinned shapes before they exist.

type PointerType = PointerLikeEvent["type"]

describe("makePointerLikeEvent", () => {
  it("C1: fills mouse defaults per type, and an override wins", () => {
    // Every type, with no fields but `type`.
    const types: ReadonlyArray<PointerType> = ["down", "move", "up", "cancel", "enter", "leave"]
    const built = types.map((type) => makePointerLikeEvent({ type }))
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
    const overridden = makePointerLikeEvent({
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
      const event = makePointerLikeEvent({
        type: "down",
        pointerType: row.pointerType,
        button: row.button,
        isPrimary: row.isPrimary,
      })
      expect(isPrimaryPointer(event), row.name).toBe(row.expected)
    }
  })
})

describe("DragActivity", () => {
  it("C3: a claim makes it active, two claims need two releases, a release is idempotent", () => {
    const activity = makeDragActivity()
    // A fresh one is inactive.
    expect(activity.isDragActive()).toBe(false)
    // One claim.
    const releaseA = activity.claim()
    expect(activity.isDragActive()).toBe(true)
    // A second claim, then release the first twice.
    const releaseB = activity.claim()
    releaseA()
    releaseA()
    // The double release counted once, so B still holds it.
    expect(activity.isDragActive()).toBe(true)
    releaseB()
    expect(activity.isDragActive()).toBe(false)
    // Releasing again after it reached zero doesn't go negative and break the next claim.
    releaseB()
    const releaseC = activity.claim()
    expect(activity.isDragActive()).toBe(true)
    releaseC()
    expect(activity.isDragActive()).toBe(false)
  })

  it("C4: the Reference defaults to one shared instance, and a provided one is independent", () => {
    // Two separate runs with no layer.
    const first = Effect.runSync(Effect.gen(function* () { return yield* DragActivity }))
    const second = Effect.runSync(Effect.gen(function* () { return yield* DragActivity }))
    // The same cached default (one page-wide instance).
    expect(second).toBe(first)
    // An instance provided for one run.
    const provided = makeDragActivity()
    const seen = Effect.runSync(
      Effect.gen(function* () { return yield* DragActivity }).pipe(Effect.provideService(DragActivity, provided)),
    )
    // It is the provided one, independent of the default.
    expect(seen).toBe(provided)
    expect(seen).not.toBe(first)
    const release = provided.claim()
    expect(provided.isDragActive()).toBe(true)
    expect(first.isDragActive()).toBe(false)
    release()
  })
})
