/**
 * A scene's runtime for tests, with no renderer and no page: `WardicThree.make` on a stand-in canvas,
 * its frames pumped by `frame()`, and a pointer that hovers and presses objects through the scene's own
 * input, hit by three's real raycast. It runs in Node.
 *
 * - **`frame(ms?)`** runs one frame of the Host loop, 1/60 s on by default: Wardic's raycast and writes
 *   against the scene as it's built, as though the page had drawn it, then its matrices made current, as a
 *   render makes them.
 * - **`pointer`** moves a mouse over the stand-in canvas: `over(mesh)` to where `mesh` is drawn, `at(x, y)`,
 *   `down()`, `up()`, `cancel()` and `leave()`. A frame then finds what's under it, as on a page.
 *
 * @example
 * import * as TestStage from "@wardic/three/TestStage"
 *
 * const stage = TestStage.make({ scene, camera, size: { width: 800, height: 600 } })
 * stage.hover(crate, () => {
 *   stage.animate(crate, { scale: 1.1 })
 *   return () => stage.animate(crate, { scale: 1 })
 * })
 * stage.pointer.over(crate)
 * stage.frame()
 */
// `@wardic/three/TestStage` (#883's PR 5a; ADR-0073 decision 26, amended by *Amendment (#883)*, PR 5's Q2
// and Q6): it stays in `@wardic/three` at 1.3 (ADR-0073, *1.3's release*), beside the runtime it drives,
// so `@wardic/test` takes no three.js peers. `stage.ward` and `<WardicStage value={stage}>` came with
// steps 3 and 4.
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import type { Camera, Object3D } from "three"
import { Matrix4, Vector3 } from "three"
import * as ThreeInstances from "./ThreeInstances.ts"
import * as WardicThree from "./WardicThree.ts"
import * as ObjectBatch from "@wardic/object/ObjectBatch"

/** `make`'s options: the scene, its camera, the stand-in canvas's size, and `WardicThree.make`'s. */
export interface Options extends Omit<WardicThree.Options, "canvas" | "camera" | "scene" | "window" | "now"> {
  readonly scene: Object3D
  readonly camera: Camera
  /** The stand-in canvas's size, in CSS pixels, at the page's top left. */
  readonly size: { readonly width: number; readonly height: number }
}

/** A mouse over the stand-in canvas. */
export interface TestPointer {
  /** Moves it to where `target` is drawn: a scene object's middle, a Batch member's, an instance's. */
  readonly over: (target: object) => void
  /** Moves it to `x`, `y` on the canvas, in CSS pixels. */
  readonly at: (x: number, y: number) => void
  /** Presses its main button where it is. */
  readonly down: () => void
  /** Releases it where it is. */
  readonly up: () => void
  /** The platform cancels its press. */
  readonly cancel: () => void
  /** Takes it off the canvas. */
  readonly leave: () => void
  /** Where it is now, in CSS pixels. */
  readonly position: () => { readonly x: number; readonly y: number }
}

/** A test's scene runtime: `WardicThree`'s, its frames pumped by `frame`, with a pointer. */
export interface TestStage extends Omit<WardicThree.WardicThree, "frame"> {
  /** One frame of the Host loop, `ms` after the last (1/60 s): Wardic's frame on the scene as it's built, then its matrices, as a render makes them. */
  readonly frame: (ms?: number) => void
  /** The stage's time now, in ms. */
  readonly now: () => number
  readonly pointer: TestPointer
  /** The stand-in canvas the pointer's events reach. */
  readonly canvas: EventTarget
}

/** A pointer event as the stand-in dispatches it: an `Event` with a `PointerEvent`'s fields. */
const pointerEvent = (type: string, fields: Readonly<Record<string, number | string | boolean>>): Event =>
  Object.defineProperties(new Event(type), Rec.map(fields, (value) => ({ value })))

/** Where `target` is drawn, in world space: an instance's geometry's middle through its matrix, an object's through its own. */
const worldMiddleOf = (target: object): Vector3 => {
  const middle = new Vector3()
  const subject = memberOf(target)
  if (ThreeInstances.isInstance(subject)) {
    const mesh = subject.mesh as unknown as { geometry: { boundingSphere: { center: Vector3 } | null; computeBoundingSphere: () => void }; getMatrixAt: (i: number, m: Matrix4) => Matrix4; matrixWorld: Matrix4 }
    if (Predicate.isNull(mesh.geometry.boundingSphere)) mesh.geometry.computeBoundingSphere()
    middle.copy((mesh.geometry.boundingSphere as { center: Vector3 }).center)
    return middle.applyMatrix4(mesh.getMatrixAt(subject.index, new Matrix4())).applyMatrix4(mesh.matrixWorld)
  }
  const object = subject as Object3D & { geometry?: { boundingSphere: { center: Vector3 } | null; computeBoundingSphere: () => void } }
  const geometry = object.geometry
  if (Predicate.isUndefined(geometry)) return object.getWorldPosition(middle)
  if (Predicate.isNull(geometry.boundingSphere)) geometry.computeBoundingSphere()
  return object.localToWorld(middle.copy((geometry.boundingSphere as { center: Vector3 }).center))
}

/** A Batch member's handle as its member: a mesh, or an instance; anything else as it is. */
const memberOf = (target: object): object => {
  if (Predicate.isUndefined(ObjectBatch.entryOf(target))) return target
  const handle = target as { readonly i?: number; readonly batch?: { readonly members: ReadonlyArray<object> } }
  if (Predicate.isNumber(handle.i) && Predicate.isNotUndefined(handle.batch)) return handle.batch.members[handle.i] as object
  throw new Error("TestStage: pointer.over takes one object, a Batch's member (batch.at(i)) or an instance, not a whole Batch.")
}

/** A scene runtime for a test, on a stand-in canvas of `options.size`. */
export const make = (options: Options): TestStage => {
  const { width, height } = options.size
  const canvas = new EventTarget() as EventTarget & { getBoundingClientRect: () => { left: number; top: number; width: number; height: number } }
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width, height })
  // The page's window, where a held pointer's events are heard.
  const page = new EventTarget()
  let time = 0
  const runtime = WardicThree.make({ ...options, canvas, window: page, now: () => time })
  const { scene, camera } = options
  /** The scene's and the camera's matrices, made current as a render makes them. */
  const draw = (): void => {
    scene.updateMatrixWorld()
    camera.updateMatrixWorld()
  }

  let x = 0
  let y = 0
  let over = false
  let buttons = 0
  /** A pointer event at the pointer, reaching the window in its capture phase and then the canvas, as a page's does. */
  const dispatch = (type: string, button: number): void => {
    const event = pointerEvent(type, { clientX: x, clientY: y, pointerId: 1, pointerType: "mouse", isPrimary: true, button, buttons, timeStamp: time })
    if (type !== "pointerenter" && type !== "pointerleave") page.dispatchEvent(event)
    canvas.dispatchEvent(event)
  }
  const moveTo = (nextX: number, nextY: number): void => {
    x = nextX
    y = nextY
    if (!over) {
      over = true
      dispatch("pointerenter", -1)
    }
    dispatch("pointermove", -1)
  }
  const pointer: TestPointer = {
    over: (target) => {
      // Where it's drawn as it's built now.
      draw()
      const ndc = worldMiddleOf(target).project(camera)
      moveTo(((ndc.x + 1) / 2) * width, ((1 - ndc.y) / 2) * height)
    },
    at: moveTo,
    down: () => {
      buttons = 1
      dispatch("pointerdown", 0)
    },
    up: () => {
      buttons = 0
      dispatch("pointerup", 0)
    },
    cancel: () => {
      buttons = 0
      dispatch("pointercancel", 0)
    },
    leave: () => {
      if (!over) return
      over = false
      dispatch("pointerleave", -1)
    },
    position: () => ({ x, y }),
  }

  return {
    ...runtime,
    frame: (ms = 1000 / 60) => {
      time += ms
      // What a test built since the last frame, as though the page had drawn it: the raycast hits it there.
      draw()
      runtime.frame(time)
      draw()
    },
    now: () => time,
    pointer,
    canvas,
  }
}
