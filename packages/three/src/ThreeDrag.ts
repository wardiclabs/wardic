/**
 * Drag in 3D (ADR-0070 decision 9, kept by ADR-0073 decision 18): a pointer moves in 2D, so each of its
 * moves is cast into the scene, and the object moves with what it meets.
 *
 * - **`drag: true`** moves the object on the plane through the point grabbed, facing the camera, as
 *   three's `DragControls` and drei's do.
 * - **`drag: "x" | "y" | "z"`** moves it along that axis of its parent's space, matching the `x`, `y`
 *   and `z` keys.
 * - **`dragPlane`** drags it on a fixed plane, in world space: the ground.
 * - **`dragConstraints`**, `{ x: [-2, 2], z: [-2, 2] }`, are its ranges per axis in its parent's space,
 *   which `dragElastic` lets it be pulled past.
 * - **Its release** glides on at the pointer's speed, cast into the scene the same way, in world units a
 *   second, on Motion's inertia per axis (`dragMomentum`, `dragTransition`), back within its ranges,
 *   or back where it was picked up from (`dragSnapToOrigin`). Its rest thresholds are Motion's, in the
 *   scene's units through its unit scale.
 *
 * Its moves are written through `animate`, a 0 s change each: a ward on the object takes them as the
 * Stage's `animate` (#433), holding `x`, `y` and `z` where the drag leaves them until its own target
 * for one changes. `@wardic/three/solid`'s Stage drags with it.
 *
 * @module
 */
// #885's PR 4 (ADR-0073, *Amendment (#885)*, Q8).
import * as Drag from "@wardic/core/Drag"
import * as DragRecognizer from "@wardic/core/DragRecognizer"
import type * as InputFeed from "@wardic/core/InputFeed"
import type * as InputSource from "@wardic/core/InputSource"
import type * as Point from "@wardic/core/Point"
import type * as UnitScale from "@wardic/core/UnitScale"
import type * as Config from "@wardic/core/unstable/Config"
import type * as Imperative from "@wardic/core/unstable/Imperative"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import type * as Scope from "effect/Scope"
import * as UndefinedOr from "effect/UndefinedOr"
import { type Camera, type Object3D, Plane, type Ray, Raycaster, Vector2, Vector3 } from "three"

/** An axis of an object's parent's space. */
export type DragAxis = "x" | "y" | "z"

/** A range on one axis: its least, then its most. */
export type DragRange = readonly [min: number, max: number]

/** A release's inertia, as `type: "inertia"`'s: Motion's `dragTransition`. */
export type DragTransition = Omit<Config.WardicInertia, "type" | "velocity" | "min" | "max">

/** A drag's config, read at each gesture's start. */
export interface DragConfig {
  readonly drag?: boolean | DragAxis | undefined
  readonly dragPlane?: Plane | undefined
  readonly dragConstraints?: Partial<Readonly<Record<DragAxis, DragRange>>> | undefined
  readonly dragElastic?: number | undefined
  readonly dragMomentum?: boolean | undefined
  readonly dragTransition?: DragTransition | undefined
  readonly dragSnapToOrigin?: boolean | undefined
}

/** What a drag tells: each pointer sample, after the object has moved, and its release coming to rest. */
export interface DragHandlers {
  readonly sample: (sample: Drag.Sample) => void
  readonly released: () => void
  readonly onDefect?: InputFeed.OnDefect | undefined
}

/** A canvas, as the drag reads it: where it is on the page. */
export interface CanvasRect {
  readonly getBoundingClientRect: () => { readonly left: number; readonly top: number; readonly width: number; readonly height: number }
}

/** What a scene's drags run on: its `animate`, its camera, its canvas, and its unit scale. */
export interface Options {
  readonly animate: (subject: object, target: Readonly<Record<string, unknown>>, options?: Imperative.WardicAnimateOptions) => Imperative.WardicPlaybackControls
  /** The camera it's drawn with, or a function giving the one active now. */
  readonly camera: Camera | (() => Camera)
  /** Its canvas, once there is one. */
  readonly canvas: () => CanvasRect | undefined
  /** How many of Motion's units a key counts as, for the release's rest thresholds. */
  readonly unitScale: UnitScale.Rule
}

/** A scene's drags. */
export interface ThreeDrag {
  /** Watch `subject`'s drags on the scene's input: `config()` read at each gesture's start. */
  readonly watch: (subject: object, config: () => DragConfig, handlers: DragHandlers) => Effect.Effect<void, never, Scope.Scope | InputSource.InputSource>
}

/** How far an object is pulled past a range by default: Motion's. */
export const DEFAULT_ELASTIC = 0.35

const AXES: ReadonlyArray<DragAxis> = ["x", "y", "z"]

/** Each axis's unit vector. */
const UNIT: Readonly<Record<DragAxis, Vector3>> = { x: new Vector3(1, 0, 0), y: new Vector3(0, 1, 0), z: new Vector3(0, 0, 1) }

/** Motion's release: a 750 ms time constant, power 0.8, at rest within 1 of its units and below 10 a second. */
const RELEASE = { power: 0.8, timeConstant: 750 } as const
const REST_DELTA = 1
const REST_SPEED = 10
/** Its bounce back within a range: soft with an elastic edge, at once with none. Motion's. */
const ELASTIC_BOUNCE = { bounceStiffness: 200, bounceDamping: 40 } as const
const RIGID_BOUNCE = { bounceStiffness: 1e6, bounceDamping: 1e7 } as const

/** A 1/60 s step back along the pointer's velocity: where a release's speed is cast from. */
const STEP = 1 / 60

/** A drag's moves, written at once. */
const AT_ONCE: Imperative.WardicAnimateOptions = { duration: 0 }

// Module state: scratch for the casts, each used and read before the next.
const raycaster = new Raycaster()
const ndc = new Vector2()

/** A gesture: what it moves, on what, from where. */
interface Grab {
  readonly object: Object3D
  readonly config: DragConfig
  /** The keys it moves: one for an axis drag, else all three. */
  readonly keys: ReadonlyArray<DragAxis>
  /** What the pointer's ray meets, in world space. */
  readonly plane: Plane
  /** An axis drag's axis, in world space: what's met on the plane is taken to the line along it. */
  readonly line: Vector3 | undefined
  /** Where the plane was met at the down, in world space. */
  readonly grabbed: Vector3
  /** The object's world position at the down. */
  readonly from: Vector3
  /** Its position at the down, in its parent's space. */
  readonly start: Readonly<Record<DragAxis, number>>
  /** Where it is now, in its parent's space. */
  readonly now: Record<DragAxis, number>
}

/** The camera now: one given, or the one a function gives. */
const cameraOf = (camera: Options["camera"]): Camera => {
  if (Predicate.isFunction(camera)) return (camera as () => Camera)()
  return camera
}

/** The pointer's ray through `point` on the page, from the camera. */
const rayAt = (point: Point.Point, rect: ReturnType<CanvasRect["getBoundingClientRect"]>, camera: Camera): Ray => {
  ndc.set(((point.x - rect.left) / rect.width) * 2 - 1, -((point.y - rect.top) / rect.height) * 2 + 1)
  raycaster.setFromCamera(ndc, camera)
  return raycaster.ray
}

/** Where `ray` meets the drag: on its plane, and for an axis drag on its line; none where the ray runs along the plane. */
const meet = (plane: Plane, line: Vector3 | undefined, through: Vector3, ray: Ray, out: Vector3): Vector3 | undefined => {
  if (Predicate.isNull(ray.intersectPlane(plane, out))) return undefined
  return UndefinedOr.match(line, {
    onUndefined: () => out,
    onDefined: (along) => {
      const d = out.sub(through).dot(along)
      return out.copy(through).addScaledVector(along, d)
    },
  })
}

/**
 * The plane an axis drag moves on: through `through`, holding the axis `line`, and facing the camera as
 * nearly as one can. Looking down the axis, one holding it at all.
 */
const axisPlane = (line: Vector3, through: Vector3, camera: Camera): Plane => {
  const view = camera.getWorldDirection(new Vector3())
  const normal = view.addScaledVector(line, -view.dot(line))
  if (normal.lengthSq() < 1e-12) normal.crossVectors(line, Bool.match(Math.abs(line.y) < 0.9, { onTrue: () => UNIT.y, onFalse: () => UNIT.x }))
  return new Plane().setFromNormalAndCoplanarPoint(normal.normalize(), through)
}

/** `object`'s parent: none at the root. */
const parentOf = (object: Object3D): Object3D | undefined => Option.getOrUndefined(Option.fromNullishOr(object.parent))

/** `world`, a point, in `object`'s parent's space: as it is at the root. */
const toParent = (object: Object3D, world: Vector3): Vector3 =>
  UndefinedOr.match(parentOf(object), { onUndefined: () => world, onDefined: (parent) => parent.worldToLocal(world) })

/** `config`'s range on `axis`, as core's: none without one. */
const rangeOf = (config: DragConfig, axis: DragAxis): Drag.AxisRange | undefined => {
  const constraints = config.dragConstraints
  if (Predicate.isUndefined(constraints)) return undefined
  return UndefinedOr.map(constraints[axis], ([min, max]): Drag.AxisRange => ({ min, max }))
}

/** The object's place, its keys' values. */
const valuesOf = (grab: Grab): Readonly<Record<string, number>> => {
  const values: Record<string, number> = {}
  Arr.forEach(grab.keys, (key) => {
    values[key] = grab.now[key]
  })
  return values
}

/** A scene's drags on `options`' camera and canvas, moving each object through `options.animate`. */
export const make = (options: Options): ThreeDrag => {
  /** Its canvas's place on the page now, once there's a canvas. */
  const rectNow = (): ReturnType<CanvasRect["getBoundingClientRect"]> | undefined => UndefinedOr.map(options.canvas(), (canvas) => canvas.getBoundingClientRect())

  /** A gesture's start: where the pointer went down on the object, and what it moves on from there. */
  const begin = (object: Object3D, config: DragConfig, sample: Drag.Sample): Grab | undefined => {
      const rect = rectNow()
      if (Predicate.isUndefined(rect)) return undefined
      const camera = cameraOf(options.camera)
      object.updateWorldMatrix(true, false)
      const down = { x: sample.point.x - sample.offset.x, y: sample.point.y - sample.offset.y }
      const ray = rayAt(down, rect, camera)
      const from = object.getWorldPosition(new Vector3())
      // Where it was grabbed: where the pointer's ray met it, else its middle.
      const through = Option.match(Arr.head(raycaster.intersectObject(object, true)), {
        onNone: () => from.clone(),
        onSome: (hit) => hit.point.clone(),
      })
      const axis = Option.getOrUndefined(Arr.findFirst(AXES, (one) => one === config.drag))
      const line = UndefinedOr.map(axis, (one) =>
        UndefinedOr.match(parentOf(object), {
          onUndefined: () => UNIT[one].clone(),
          onDefined: (parent) => UNIT[one].clone().transformDirection(parent.matrixWorld),
        }),
      )
      const plane = UndefinedOr.match(config.dragPlane, {
        onDefined: (given) => given,
        onUndefined: () =>
          UndefinedOr.match(line, {
            onDefined: (along) => axisPlane(along, through, camera),
            onUndefined: () => new Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new Vector3()), through),
          }),
      })
      return UndefinedOr.map(meet(plane, line, through, ray, new Vector3()), (grabbed) => {
        const start = { x: object.position.x, y: object.position.y, z: object.position.z }
        const keys: ReadonlyArray<DragAxis> = UndefinedOr.match(axis, { onUndefined: () => AXES, onDefined: (one) => [one] })
        return { object, config, keys, plane, line, grabbed, from, start, now: { ...start } }
      })
  }

  // Scratch for a move's cast: each used and read before the next.
  const met = new Vector3()
  const world = new Vector3()

  /** The object where the pointer at `point` has it, within its ranges' give, written. Whether the plane was met. */
  const moveTo = (grab: Grab, point: Point.Point): boolean =>
    UndefinedOr.match(rectNow(), {
      onUndefined: () => false,
      onDefined: (rect) =>
        UndefinedOr.match(meet(grab.plane, grab.line, grab.grabbed, rayAt(point, rect, cameraOf(options.camera)), met), {
          onUndefined: () => false,
          onDefined: (hit) => {
            const local = toParent(grab.object, world.copy(grab.from).add(hit).sub(grab.grabbed))
            const elastic = UndefinedOr.match(grab.config.dragElastic, { onUndefined: () => DEFAULT_ELASTIC, onDefined: (given) => given })
            Arr.forEach(grab.keys, (key) => {
              grab.now[key] = Drag.constrain(local[key], rangeOf(grab.config, key), elastic)
            })
            void options.animate(grab.object, valuesOf(grab), AT_ONCE)
            return true
          },
        }),
    })

  /** The pointer's velocity at its release, cast into the scene: in its parent's space's units a second. */
  const velocityOf = (grab: Grab, sample: Drag.Sample): Readonly<Record<DragAxis, number>> => {
    const none = { x: 0, y: 0, z: 0 }
    if (Bool.and(sample.velocity.x === 0, sample.velocity.y === 0)) return none
    return UndefinedOr.match(rectNow(), {
      onUndefined: () => none,
      onDefined: (rect) => {
        const camera = cameraOf(options.camera)
        const back = { x: sample.point.x - sample.velocity.x * STEP, y: sample.point.y - sample.velocity.y * STEP }
        const here = meet(grab.plane, grab.line, grab.grabbed, rayAt(sample.point, rect, camera), new Vector3())
        const there = meet(grab.plane, grab.line, grab.grabbed, rayAt(back, rect, camera), new Vector3())
        if (Bool.or(Predicate.isUndefined(here), Predicate.isUndefined(there))) return none
        const a = toParent(grab.object, (here as Vector3).clone())
        const b = toParent(grab.object, (there as Vector3).clone())
        const out = { ...none }
        Arr.forEach(grab.keys, (key) => {
          out[key] = (a[key] - b[key]) / STEP
        })
        return out
      },
    })
  }

  /**
   * Its release, Motion's: inertia per key at the release's speed (none with `dragMomentum: false`),
   * bounded by its ranges, or by where it was picked up from with `dragSnapToOrigin`.
   */
  const release = (grab: Grab, sample: Drag.Sample, handlers: DragHandlers): void => {
    const config = grab.config
    const velocity = Bool.match(config.dragMomentum === false, { onTrue: () => ({ x: 0, y: 0, z: 0 }), onFalse: () => velocityOf(grab, sample) })
    const elastic = UndefinedOr.match(config.dragElastic, { onUndefined: () => DEFAULT_ELASTIC, onDefined: (given) => given })
    const bounce = Bool.match(elastic > 0, { onTrue: () => ELASTIC_BOUNCE, onFalse: () => RIGID_BOUNCE })
    const transition: Record<string, unknown> = {}
    Arr.forEach(grab.keys, (key) => {
      const scale = options.unitScale(key, 1)
      const range = Bool.match(config.dragSnapToOrigin === true, {
        onTrue: (): Drag.AxisRange | undefined => ({ min: grab.start[key], max: grab.start[key] }),
        onFalse: () => rangeOf(config, key),
      })
      transition[key] = {
        type: "inertia",
        velocity: velocity[key],
        ...RELEASE,
        restDelta: REST_DELTA / scale,
        restSpeed: REST_SPEED / scale,
        ...bounce,
        ...range,
        ...config.dragTransition,
      }
    })
    void options.animate(grab.object, valuesOf(grab), transition as Imperative.WardicAnimateOptions).then(handlers.released)
  }

  return {
    watch: (subject, config, handlers) => {
      let grab: Grab | undefined
      return DragRecognizer.watchDrag(
        subject,
        { axis: "xy" },
        {
          on: (sample) => {
            if (sample.phase === "start") {
              grab = begin(subject as Object3D, config(), sample)
              UndefinedOr.map(grab, (g) => moveTo(g, sample.point))
            }
            if (sample.phase === "move") UndefinedOr.map(grab, (g) => moveTo(g, sample.point))
            if (sample.phase === "end") {
              // A cancelled gesture stops where it is: no release, as Motion's `cancel`.
              UndefinedOr.map(grab, (g) => {
                if (sample.cancelled === true) return
                moveTo(g, sample.point)
                release(g, sample, handlers)
              })
              grab = undefined
            }
            handlers.sample(sample)
          },
          onDefect: handlers.onDefect,
        },
      ).pipe(Effect.asVoid)
    },
  }
}
