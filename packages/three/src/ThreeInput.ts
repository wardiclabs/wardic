/**
 * A scene's pointer input: the canvas's pointer events, hit-tested by a raycast, as core's `InputSource`,
 * so a mesh is hovered and pressed as an element is. `hover(subject, onStart)` and `press(subject, onStart)`
 * are Motion's functions on a scene's objects: `onStart` runs as the gesture starts, and what it returns runs
 * as it ends, `press`'s told whether it ended on the object. Each returns its cancel.
 *
 * - **What a pointer hits:** the nearest object under it that's drawn: on the camera's layers, and visible,
 *   with every parent. An object with no gesture still blocks what's behind it. A hit on a child is a hit
 *   on each object above it. `hitTest` replaces the raycast, for a BVH or GPU picking.
 * - **When:** once a frame per pointer over the canvas, at the start of `frame(t)`, against what was last
 *   drawn, so hover follows what moves under a still pointer; a down and a release at once, where they
 *   happen. With no gesture watched, nothing is cast.
 * - **A raycast that throws** (the camera's, `hitTest`'s, an object's `raycast`) is reported once until one
 *   succeeds: a pointer keeps what it was over, a down or a release hits nothing, and Wardic's writes run on.
 * - **A Batch:** `hover(swarm, onStart)` watches each member, an `InstancedMesh`'s instance by the hit's
 *   `instanceId`, and tells which as the event's `member`; `hover(swarm.at(i), onStart)` member `i` alone.
 *
 * @example
 * import * as WardicThree from "@wardic/three/WardicThree"
 *
 * const wardic = WardicThree.make({ canvas: renderer.domElement, camera, scene })
 * wardic.hover(crate, () => {
 *   wardic.animate(crate, { scale: 1.1 })
 *   return () => wardic.animate(crate, { scale: 1 })
 * })
 * wardic.press(swarm, (event) => (end, { success }) => {
 *   if (success) select(event.member)
 * })
 */
// `@wardic/three/ThreeInput` (#883's PR 5a; ADR-0069 decisions 22 and 23, ADR-0073 decision 25 and
// *Amendment (#883)*, PR 5's Q3–Q5). Core's recognizers hear it as they hear the DOM's: an enter and a leave
// as the hit changes, the downs, moves and releases over a target, and a held pointer's anywhere through
// core's `heldPointer`, its window's events by `onTarget`. Probe `.tmp/883-instanced/raycast.ts`: a raycast
// over 1,000 meshes 17–27 µs, 10,000 196–233 µs; an `InstancedMesh` of 10,000 360–720 µs, hit or miss.
// Per frame: plain code.
import * as InputFeed from "@wardic/core/InputFeed"
import * as InputSource from "@wardic/core/InputSource"
import * as Recognizer from "@wardic/core/Recognizer"
import * as Report from "@wardic/core/unstable/Report"
import * as ObjectBatch from "@wardic/object/ObjectBatch"
import * as Arr from "effect/Array"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import { constVoid } from "effect/Function"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Scope from "effect/Scope"
import * as UndefinedOr from "effect/UndefinedOr"
import type { Camera, Intersection, Object3D, Vector3 } from "three"
import { Raycaster, Vector2 } from "three"
import * as ThreeInstances from "./ThreeInstances.ts"
import * as Lookup from "./internal/lookup.ts"

/** A canvas, as the input reads one: its pointer events, and where it is on the page. */
export interface CanvasLike extends EventTarget {
  readonly getBoundingClientRect: () => { readonly left: number; readonly top: number; readonly width: number; readonly height: number }
  readonly ownerDocument?: { readonly defaultView: EventTarget | null } | null | undefined
}

/** What hits a scene: the intersections along the raycaster's ray, nearest first. */
export type HitTest = (raycaster: Raycaster, scene: Object3D) => ReadonlyArray<Intersection>

/** The scene's input: its canvas, its camera (or the one active now), and the scene a pointer hits. */
export interface Options {
  readonly canvas: CanvasLike
  readonly camera: Camera | (() => Camera)
  readonly scene: Object3D
  /** What a pointer hits, in the raycast's place: a BVH's, or a GPU pick's. three's raycast over `scene` when left out. */
  readonly hitTest?: HitTest | undefined
  /** Where a held pointer's events are heard once it leaves the canvas: the canvas's window when left out. */
  readonly window?: EventTarget | undefined
}

/** A pointer's event on a scene, as a gesture's callbacks get it: where it is on the page, and what's under it. */
export interface ScenePointerEvent {
  /** Where the pointer is across the page, in CSS pixels. */
  readonly x: number
  /** Where the pointer is down the page, in CSS pixels. */
  readonly y: number
  /** The nearest object under it, `undefined` over nothing. */
  readonly object: Object3D | undefined
  /** Where the pointer's ray meets `object`, in world space. */
  readonly point: Vector3 | undefined
  /** How far that is from the camera. */
  readonly distance: number | undefined
  /** The instance of an `InstancedMesh` it's over. */
  readonly instanceId: number | undefined
  /** The Batch member a gesture on a Batch is told of, by its index. */
  readonly member: number | undefined
  /** The platform's event, `undefined` for a hover a frame found under a still pointer. */
  readonly nativeEvent: Event | undefined
}

/** `hover`'s start: what to run as the pointer comes over, and what it returns, as it goes off. */
export type HoverStart = (event: ScenePointerEvent) => void | ((event: ScenePointerEvent) => void)

/** `press`'s start: what to run as a press starts, and what it returns, as it ends, `success` when it ended on the object. */
export type PressStart = (event: ScenePointerEvent) => void | ((event: ScenePointerEvent, info: { readonly success: boolean }) => void)

/** A scene's input, made by `make`: core's `InputSource` for its gestures, and its raycast, once a frame. */
export interface SceneInput {
  readonly source: InputSource.InputSource["Service"]
  /** The frame's raycast, each pointer's over the canvas: before Wardic's writes, against what was last drawn. */
  readonly frame: () => void
  /** Whether a pointer moved since the last frame while a gesture is watched: a loop that draws on demand draws one. */
  readonly wantsFrame: () => boolean
  /** `hover`, on this input. */
  readonly hover: (subject: unknown, onStart: HoverStart) => () => void
  /** `press`, on this input. */
  readonly press: (subject: unknown, onStart: PressStart) => () => void
  /** Ends every gesture, and stops listening. */
  readonly dispose: () => void
}

/** A DOM pointer event's fields the input reads. */
interface PointerEventLike extends Event {
  readonly pointerId: number
  readonly clientX: number
  readonly clientY: number
  readonly buttons: number
  readonly button: number
  readonly pointerType: string
  readonly isPrimary: boolean
}

/** One step on a hit's path: an object, and the instance of it hit, on the object hit itself. */
interface Node {
  readonly object: Object3D
  readonly instanceId: number | undefined
}

/** What a pointer is over: the nearest intersection, and its path from the object hit up to the scene, innermost first. */
interface Hit {
  readonly intersection: Intersection | undefined
  readonly path: ReadonlyArray<Node>
}

/** Over nothing. */
const NO_HIT: Hit = { intersection: undefined, path: [] }

/** A pointer over the canvas, or held: where it is, and what it's over. */
interface Pointer {
  ndcX: number
  ndcY: number
  x: number
  y: number
  pressed: boolean
  kind: InputSource.PointerKind
  primary: boolean
  timeStamp: number
  native: Event | undefined
  over: boolean
  hit: Hit
}

/** A target's pointer feed's emit, as `heldPointer` hands it: each event, and the platform event it came from. */
type Emit = (event: InputSource.PointerLikeEvent, raw: unknown) => void

/** A feed over many targets: its `memberOf`, and its members' emits. */
interface Among {
  readonly memberOf: (node: unknown) => Option.Option<unknown>
  readonly deliver: (member: unknown, event: InputSource.PointerLikeEvent, raw: unknown) => void
  readonly hold: (member: unknown) => void
}

/** DOM `pointer*` types → core's. */
const POINTER_TYPE: Readonly<Record<string, InputSource.PointerLikeEvent["type"]>> = {
  pointerdown: "down",
  pointermove: "move",
  pointerup: "up",
  pointercancel: "cancel",
}

/** The canvas's events the input hears. */
const CANVAS_EVENTS = ["pointerenter", "pointerleave", "pointermove", "pointerdown", "pointerup", "pointercancel"]

/** The window's events while a pointer is held: its moves, release and cancel, and a down, which ends a hold whose release was lost. */
const HELD_EVENTS = ["pointermove", "pointerup", "pointercancel", "pointerdown"]

/** The window's listeners: in the capture phase, before the canvas's, as the DOM's held pointer hears them. */
const CAPTURE_PASSIVE: AddEventListenerOptions = { capture: true, passive: true }

/** A `pointerType` as core's pointer kind. */
const kindOf: (pointerType: string) => InputSource.PointerKind = /*#__PURE__*/ Match.type<string>().pipe(
  Match.when("mouse", (): InputSource.PointerKind => "mouse"),
  Match.when("pen", (): InputSource.PointerKind => "pen"),
  Match.when("touch", (): InputSource.PointerKind => "touch"),
  Match.orElse((): InputSource.PointerKind => "other"),
)

/** A `PointerEvent.button` in core's names. */
const buttonOf: (button: number) => InputSource.PointerButton = /*#__PURE__*/ Match.type<number>().pipe(
  Match.when(0, (): InputSource.PointerButton => "main"),
  Match.when(1, (): InputSource.PointerButton => "middle"),
  Match.when(2, (): InputSource.PointerButton => "secondary"),
  Match.when(-1, (): InputSource.PointerButton => "none"),
  Match.orElse((): InputSource.PointerButton => "other"),
)

/** Whether `object` is drawn: it and every parent visible. three's raycast doesn't ask. */
const isShown = (object: Object3D): boolean => {
  let at: Object3D | null = object
  while (Predicate.isNotNull(at)) {
    if (!at.visible) return false
    at = at.parent
  }
  return true
}

/** The path of `intersection`'s object up to the scene, innermost first, its instance on the first step. */
const pathOf = (intersection: Intersection): ReadonlyArray<Node> => {
  const path: Array<Node> = [{ object: intersection.object, instanceId: intersection.instanceId }]
  let at = intersection.object.parent
  while (Predicate.isNotNull(at)) {
    path.push({ object: at, instanceId: undefined })
    at = at.parent
  }
  return path
}

/** Whether two hits are over the same object, and the same instance of it. */
const sameHit = (a: Intersection | undefined, b: Intersection | undefined): boolean => {
  if (Predicate.isUndefined(a) || Predicate.isUndefined(b)) return a === b
  return a.object === b.object && a.instanceId === b.instanceId
}

/** How deep `target` is on `path`, from the object hit: `-1` where it isn't on it. An instance is its mesh's, at that instance. */
const depthOf = (target: unknown, path: ReadonlyArray<Node>): number => {
  if (ThreeInstances.isInstance(target)) {
    if (path.length === 0) return -1
    const first = path[0]
    if (first.object === target.mesh && first.instanceId === target.index) return 0
    return -1
  }
  for (let i = 0; i < path.length; i++) if (path[i].object === target) return i
  return -1
}

/** The members `memberOf` names on `path`, innermost first, each once. */
const membersOn = (memberOf: (node: unknown) => Option.Option<unknown>, path: ReadonlyArray<Node>): ReadonlyArray<unknown> => {
  const members: Array<unknown> = []
  for (const node of path) {
    const member = memberOf(node)
    if (Option.isSome(member) && !members.includes(member.value)) members.push(member.value)
  }
  return members
}

/** A gesture's event from core's: the scene's own, which every event the input makes carries as its `raw`. */
const sceneOf = (event: InputSource.PointerLikeEvent): ScenePointerEvent => event.raw as ScenePointerEvent

/** `event` told of a Batch's member. */
const ofMember = (event: ScenePointerEvent, member: unknown): ScenePointerEvent => ({ ...event, member: member as number })

/** What a gesture's callback hands back: its end, when it's a function. */
const endOf = <F>(returned: unknown): F | undefined => {
  if (Predicate.isFunction(returned)) return returned as F
  return undefined
}

/** A watch's failure, reported where Wardic reports one. */
const reportOf =
  (name: string) =>
  (cause: Cause.Cause<never>): void =>
    void Effect.runFork(Report.failure(`wardic.${name}: a callback failed`, cause))

/** What a gesture watches: one target, or a Batch's members by what a node is. */
type Watched = { readonly one: unknown } | { readonly memberOf: (node: unknown) => Option.Option<unknown> }

/** A Batch's or a member's handle, as a call names it. */
interface BatchHandle {
  readonly members?: ReadonlyArray<object>
  readonly i?: number
  readonly batch?: { readonly members: ReadonlyArray<object> }
}

/** Which of `members` a node is: an `InstancedMesh`'s instance by its `instanceId`, a mesh by itself. */
const memberOfBatch = (members: ReadonlyArray<object>): ((node: unknown) => Option.Option<unknown>) => {
  const first = members[0]
  if (ThreeInstances.isInstance(first)) {
    const mesh = first.mesh
    return (node) => {
      const { object, instanceId } = node as Node
      if (object !== mesh || Predicate.isUndefined(instanceId) || instanceId >= members.length) return Option.none()
      return Option.some(instanceId)
    }
  }
  const index = new Map<unknown, number>(Arr.map(members, (member, i) => [member, i] as const))
  return (node) => Option.fromUndefinedOr(index.get((node as Node).object))
}

/** What `subject` watches, for `name`'s call: a scene object or an instance, a member's handle, or a Batch's members. */
const watchedOf = (name: string, subject: unknown): Watched => {
  if (Predicate.isNotUndefined(ObjectBatch.entryOf(subject))) {
    const handle = subject as BatchHandle
    if (Predicate.isNumber(handle.i) && Predicate.isNotUndefined(handle.batch)) return { one: handle.batch.members[handle.i] }
    return { memberOf: memberOfBatch(UndefinedOr.match(handle.members, { onUndefined: () => [], onDefined: (members) => members })) }
  }
  if (Lookup.isObject3D(subject) || ThreeInstances.isInstance(subject)) return { one: subject }
  throw new Error(`wardic.${name}: it was given ${String(subject)}, which isn't a scene object, a Batch or a Batch's member. Give one: wardic.${name}(mesh, onStart).`)
}

/** The camera `options` gives now. */
const cameraOf = (camera: Camera | (() => Camera)): Camera => {
  if (Predicate.isFunction(camera)) return camera()
  return camera
}

/** Where a held pointer's events are heard: `options`' window, else the canvas's, else the global one. */
const windowOf = (options: Options): EventTarget => {
  if (Predicate.isNotUndefined(options.window)) return options.window
  const doc = options.canvas.ownerDocument
  if (Predicate.isObject(doc) && Predicate.isNotNull(doc.defaultView)) return doc.defaultView
  return globalThis as unknown as EventTarget
}

/** A scene's input on `options`' canvas, listening from now until `dispose`. */
export const make = (options: Options): SceneInput => {
  const canvas = options.canvas
  const win = windowOf(options)
  const raycaster = new Raycaster()
  const at = new Vector2()
  // The default raycast's intersections, kept.
  const found: Array<Intersection> = []
  const pointers = new Map<number, Pointer>()
  const targets = new Map<unknown, Set<Emit>>()
  const amongs = new Set<Among>()
  const watches = new Set<() => void>()
  // A pointer moved, or came over the canvas, since the last frame's raycast.
  let moved = false
  // The platform event last seen, with what it hit and its scene event: one each, whichever feed reads it first.
  let lastNative: Event | undefined
  let lastHit: Hit = NO_HIT
  let lastScene: ScenePointerEvent | undefined

  /** Whether any gesture is watched: else nothing is cast. */
  const watched = (): boolean => targets.size > 0 || amongs.size > 0

  /** The nearest drawn object at `ndcX`, `ndcY`: its intersection, `undefined` over nothing. */
  const cast = (ndcX: number, ndcY: number): Intersection | undefined => {
    const camera = cameraOf(options.camera)
    raycaster.setFromCamera(at.set(ndcX, ndcY), camera)
    raycaster.layers.mask = camera.layers.mask
    let hits: ReadonlyArray<Intersection> = found
    found.length = 0
    if (Predicate.isUndefined(options.hitTest)) raycaster.intersectObject(options.scene, true, found)
    if (Predicate.isNotUndefined(options.hitTest)) hits = options.hitTest(raycaster, options.scene)
    for (const hit of hits) if (isShown(hit.object)) return hit
    return undefined
  }

  // A raycast threw (its camera, its `hitTest`, an object's `raycast`), reported, since one last succeeded.
  let castFailing = false

  /**
   * `cast`, or `instead` where the raycast throws: a frame's pointer keeps the hit it had, an event's hits
   * nothing. A failure is the input's, reported once until a raycast succeeds again, and Wardic's writes
   * and the render still run.
   */
  // #979, group A (ADR-0074): before, it threw out of `frame`, skipping the runtime's writes every frame.
  const castOr = (ndcX: number, ndcY: number, instead: Intersection | undefined): Intersection | undefined => {
    try {
      const intersection = cast(ndcX, ndcY)
      castFailing = false
      return intersection
    } catch (defect) {
      if (!castFailing) {
        castFailing = true
        Effect.runFork(Report.failure("wardic.input: a raycast failed", Cause.die(defect)))
      }
      return instead
    }
  }

  /** `intersection` as a hit: its path made once it changes. */
  const hitOf = (intersection: Intersection | undefined): Hit => {
    if (Predicate.isUndefined(intersection)) return NO_HIT
    return { intersection, path: pathOf(intersection) }
  }

  /** A scene event at `x`, `y` over `hit`. */
  const sceneEvent = (x: number, y: number, hit: Hit, native: Event | undefined): ScenePointerEvent => {
    const intersection = hit.intersection
    if (Predicate.isUndefined(intersection)) return { x, y, object: undefined, point: undefined, distance: undefined, instanceId: undefined, member: undefined, nativeEvent: native }
    return { x, y, object: intersection.object, point: intersection.point, distance: intersection.distance, instanceId: intersection.instanceId, member: undefined, nativeEvent: native }
  }

  /** Whether `x`, `y` is on the canvas, and where in its normalized device coordinates. */
  const ndcAt = (x: number, y: number): readonly [inside: boolean, ndcX: number, ndcY: number] => {
    const rect = canvas.getBoundingClientRect()
    const u = (x - rect.left) / rect.width
    const v = (y - rect.top) / rect.height
    return [u >= 0 && u <= 1 && v >= 0 && v <= 1, u * 2 - 1, 1 - v * 2]
  }

  /**
   * What `ev` hit, and its scene event, one each: a down's, a release's and a cancel's cast at its point,
   * a move's what its pointer is over now, nothing off the canvas.
   */
  const seen = (ev: PointerEventLike): ScenePointerEvent => {
    if (ev === lastNative && Predicate.isNotUndefined(lastScene)) return lastScene
    const [inside, ndcX, ndcY] = ndcAt(ev.clientX, ev.clientY)
    let hit = NO_HIT
    if (inside && ev.type !== "pointermove" && watched()) hit = hitOf(castOr(ndcX, ndcY, undefined))
    if (inside && ev.type === "pointermove") hit = UndefinedOr.match(pointers.get(ev.pointerId), { onUndefined: () => NO_HIT, onDefined: (pointer) => pointer.hit })
    lastNative = ev
    lastHit = hit
    lastScene = sceneEvent(ev.clientX, ev.clientY, hit, ev)
    return lastScene
  }

  /** `ev` as core's pointer event, `onTarget` as given, its scene event its `raw`. */
  const toPointer = (type: InputSource.PointerLikeEvent["type"], ev: PointerEventLike, onTarget: boolean, scene: ScenePointerEvent): InputSource.PointerLikeEvent => ({
    type,
    pointerId: ev.pointerId,
    x: ev.clientX,
    y: ev.clientY,
    pressed: ev.buttons !== 0,
    timeStamp: ev.timeStamp,
    kind: kindOf(ev.pointerType),
    button: buttonOf(ev.button),
    primary: ev.isPrimary,
    scroll: InputSource.NO_SCROLL,
    onTarget,
    raw: scene,
  })

  /** An enter or a leave of `pointer`'s, at its point now. */
  const edgeOf = (type: "enter" | "leave", id: number, pointer: Pointer, scene: ScenePointerEvent): InputSource.PointerLikeEvent => ({
    type,
    pointerId: id,
    x: pointer.x,
    y: pointer.y,
    pressed: pointer.pressed,
    timeStamp: pointer.timeStamp,
    kind: pointer.kind,
    button: "none",
    primary: pointer.primary,
    scroll: InputSource.NO_SCROLL,
    onTarget: true,
    raw: scene,
  })

  /** `event` to each target on `path`, innermost first. */
  const toTargets = (path: ReadonlyArray<Node>, event: InputSource.PointerLikeEvent, raw: unknown): void => {
    if (path.length === 0) return
    const on: Array<readonly [number, Set<Emit>]> = []
    for (const [target, emits] of targets) {
      const depth = depthOf(target, path)
      if (depth >= 0) on.push([depth, emits])
    }
    on.sort((a, b) => a[0] - b[0])
    for (const [, emits] of on) for (const emit of emits) emit(event, raw)
  }

  /** `pointer` now over `next`: a leave for each target it's gone off, innermost first, then an enter for each it's come over, outermost first. */
  const moveTo = (id: number, pointer: Pointer, next: Hit, scene: ScenePointerEvent): void => {
    const was = pointer.hit
    pointer.hit = next
    const leave = edgeOf("leave", id, pointer, scene)
    const enter = edgeOf("enter", id, pointer, scene)
    const entered: Array<Set<Emit>> = []
    for (const [target, emits] of targets) {
      const before = depthOf(target, was.path) >= 0
      const after = depthOf(target, next.path) >= 0
      if (before && !after) for (const emit of emits) emit(leave, scene)
      if (!before && after) entered.push(emits)
    }
    for (const emits of entered) for (const emit of emits) emit(enter, scene)
    for (const among of amongs) {
      const left = membersOn(among.memberOf, was.path)
      const now = membersOn(among.memberOf, next.path)
      for (const member of left) if (!now.includes(member)) among.deliver(member, leave, scene)
      for (let i = now.length - 1; i >= 0; i--) if (!left.includes(now[i])) among.deliver(now[i], enter, scene)
    }
  }

  /** `ev`'s pointer, made at its first event. */
  const pointerOf = (ev: PointerEventLike): Pointer => {
    const known = pointers.get(ev.pointerId)
    if (Predicate.isNotUndefined(known)) return known
    const made: Pointer = { ndcX: 0, ndcY: 0, x: 0, y: 0, pressed: false, kind: "mouse", primary: true, timeStamp: 0, native: undefined, over: false, hit: NO_HIT }
    pointers.set(ev.pointerId, made)
    return made
  }

  /** `pointer` at `ev`'s point. */
  const update = (pointer: Pointer, ev: PointerEventLike): void => {
    const [, ndcX, ndcY] = ndcAt(ev.clientX, ev.clientY)
    pointer.ndcX = ndcX
    pointer.ndcY = ndcY
    pointer.x = ev.clientX
    pointer.y = ev.clientY
    pointer.pressed = ev.buttons !== 0
    pointer.kind = kindOf(ev.pointerType)
    pointer.primary = ev.isPrimary
    pointer.timeStamp = ev.timeStamp
    pointer.native = ev
  }

  /** A down, a move, a release or a cancel on the canvas: the hit it changes told first, then the event to each target it's over. */
  const onEvent = (ev: PointerEventLike, pointer: Pointer): void => {
    const type = POINTER_TYPE[ev.type]
    const scene = seen(ev)
    if (ev.type !== "pointermove" && !sameHit(pointer.hit.intersection, lastHit.intersection)) moveTo(ev.pointerId, pointer, lastHit, scene)
    const hit = pointer.hit
    const event = toPointer(type, ev, true, scene)
    toTargets(hit.path, event, ev)
    for (const among of amongs) {
      const members = membersOn(among.memberOf, hit.path)
      for (const member of members) {
        if (type === "down") among.hold(member)
        among.deliver(member, event, ev)
      }
    }
  }

  const onCanvas = (raw: Event): void => {
    const ev = raw as PointerEventLike
    const pointer = pointerOf(ev)
    update(pointer, ev)
    if (ev.type === "pointerenter") {
      pointer.over = true
      moved = true
      return
    }
    if (ev.type === "pointerleave") {
      pointer.over = false
      pointers.delete(ev.pointerId)
      if (pointer.hit !== NO_HIT) moveTo(ev.pointerId, pointer, NO_HIT, sceneEvent(ev.clientX, ev.clientY, NO_HIT, ev))
      return
    }
    pointer.over = true
    if (ev.type === "pointermove") moved = true
    if (!watched()) return
    onEvent(ev, pointer)
  }
  Arr.forEach(CANVAS_EVENTS, (type) => canvas.addEventListener(type, onCanvas))

  /** The window's pointer events while a pointer is held, each `onTarget` where its hit is `over`. */
  const heldFeed =
    (over: (path: ReadonlyArray<Node>) => boolean): InputSource.PointerFeed =>
    (emit) => {
      const listener = (raw: Event): void => {
        const ev = raw as PointerEventLike
        const scene = seen(ev)
        emit(toPointer(UndefinedOr.getOrThrow(POINTER_TYPE[ev.type]), ev, over(lastHit.path), scene), ev)
      }
      Arr.forEach(HELD_EVENTS, (type) => win.addEventListener(type, listener, CAPTURE_PASSIVE))
      return () => Arr.forEach(HELD_EVENTS, (type) => win.removeEventListener(type, listener, CAPTURE_PASSIVE))
    }

  /** `target`'s own events: a feed into the input's table of targets. */
  const targetFeed =
    (target: unknown): InputSource.PointerFeed =>
    (emit) => {
      let emits = targets.get(target)
      if (Predicate.isUndefined(emits)) {
        emits = new Set()
        targets.set(target, emits)
      }
      emits.add(emit)
      return () => {
        const known = targets.get(target)
        if (Predicate.isUndefined(known)) return
        known.delete(emit)
        if (known.size === 0) targets.delete(target)
      }
    }

  const pointer = InputFeed.byTarget((target) =>
    InputSource.heldPointer({
      target: targetFeed(target),
      global: heldFeed((path) => depthOf(target, path) >= 0),
    })
  )

  /** The pointer events over `memberOf`'s members, each held through core's `heldPointer` from a down on it, as the DOM's. */
  const amongOf =
    (memberOf: (node: unknown) => Option.Option<unknown>): InputFeed.InputFeed<InputSource.TargetEvent<InputSource.PointerLikeEvent>> =>
    (emit) => {
      interface Holding {
        toTarget: Emit | undefined
        readonly pointers: Set<number>
        stop: () => void
      }
      const held = new Map<unknown, Holding>()
      const among: Among = {
        memberOf,
        deliver: (member, event, raw) => {
          const holding = held.get(member)
          if (Predicate.isUndefined(holding) || Predicate.isUndefined(holding.toTarget)) return emit({ target: member, event })
          holding.toTarget(event, raw)
        },
        hold: (member) => {
          if (held.has(member)) return
          const made: Holding = { toTarget: undefined, pointers: new Set(), stop: constVoid }
          held.set(member, made)
          made.stop = InputSource.heldPointer({
            target: (toTarget) => {
              made.toTarget = toTarget
              return () => {
                made.toTarget = undefined
              }
            },
            global: heldFeed((path) => membersOn(memberOf, path).includes(member)),
          })(
            (event) => {
              emit({ target: member, event })
              if (event.type === "down") {
                made.pointers.add(event.pointerId)
                return
              }
              if (event.type !== "up" && event.type !== "cancel" && !(event.type === "move" && !event.pressed)) return
              made.pointers.delete(event.pointerId)
              if (made.pointers.size > 0) return
              // Let go once nothing pressed on it is held: after this dispatch, which may still reach it.
              queueMicrotask(() => {
                if (made.pointers.size > 0 || held.get(member) !== made) return
                held.delete(member)
                made.stop()
              })
            },
            constVoid,
          )
        },
      }
      amongs.add(among)
      return () => {
        amongs.delete(among)
        for (const [, holding] of held) holding.stop()
        held.clear()
      }
    }
  const pointerAmong = InputFeed.byTarget((memberOf) => amongOf(memberOf as (node: unknown) => Option.Option<unknown>))

  const source: InputSource.InputSource["Service"] = {
    pointer,
    keyboard: () => InputFeed.empty,
    focus: () => InputFeed.empty,
    adoptPointer: () => Option.none(),
    pointerAmong,
  }

  /** `effect`, a gesture's watch, open until its cancel. */
  const open = (effect: Effect.Effect<void, never, Scope.Scope | InputSource.InputSource>): (() => void) => {
    const scope = Scope.makeUnsafe()
    Effect.runSync(effect.pipe(Scope.provide(scope), Effect.provideService(InputSource.InputSource, source)))
    let live = true
    const cancel = (): void => {
      if (!live) return
      live = false
      watches.delete(cancel)
      Effect.runSync(Scope.close(scope, Exit.void))
    }
    watches.add(cancel)
    moved = true
    return cancel
  }

  const hover = (subject: unknown, onStart: HoverStart): (() => void) => {
    const watching = watchedOf("hover", subject)
    const onDefect = reportOf("hover")
    if ("one" in watching) {
      let end: ((event: ScenePointerEvent) => void) | undefined
      return open(
        Recognizer.watchHover(watching.one, {
          on: ({ active, event }) => {
            if (active) {
              end = endOf(onStart(sceneOf(event)))
              return
            }
            const ending = end
            end = undefined
            if (Predicate.isNotUndefined(ending)) ending(sceneOf(event))
          },
          onDefect,
        }),
      )
    }
    const ends = new Map<unknown, (event: ScenePointerEvent) => void>()
    return open(
      Recognizer.watchHoverAmong(watching.memberOf, {
        on: (member, { active, event }) => {
          if (active) {
            const end = endOf<(event: ScenePointerEvent) => void>(onStart(ofMember(sceneOf(event), member)))
            if (Predicate.isNotUndefined(end)) ends.set(member, end)
            return
          }
          const ending = ends.get(member)
          ends.delete(member)
          if (Predicate.isNotUndefined(ending)) ending(ofMember(sceneOf(event), member))
        },
        onDefect,
      }),
    )
  }

  const press = (subject: unknown, onStart: PressStart): (() => void) => {
    const watching = watchedOf("press", subject)
    const onDefect = reportOf("press")
    type End = (event: ScenePointerEvent, info: { readonly success: boolean }) => void
    if ("one" in watching) {
      let end: End | undefined
      return open(
        Recognizer.watchPress(
          watching.one,
          {
            on: (told) => {
              const event = sceneOf(told.event as InputSource.PointerLikeEvent)
              if (told.phase === "start") {
                end = endOf(onStart(event))
                return
              }
              const ending = end
              end = undefined
              if (Predicate.isNotUndefined(ending)) ending(event, { success: told.phase === "tap" })
            },
            onDefect,
          },
          { keys: false },
        ),
      )
    }
    const ends = new Map<unknown, End>()
    return open(
      Recognizer.watchPressAmong(
        watching.memberOf,
        {
          on: (member, told) => {
            const event = ofMember(sceneOf(told.event as InputSource.PointerLikeEvent), member)
            if (told.phase === "start") {
              const end = endOf<End>(onStart(event))
              if (Predicate.isNotUndefined(end)) ends.set(member, end)
              return
            }
            const ending = ends.get(member)
            ends.delete(member)
            if (Predicate.isNotUndefined(ending)) ending(event, { success: told.phase === "tap" })
          },
          onDefect,
        },
        { keys: false },
      ),
    )
  }

  const frame = (): void => {
    if (!watched()) return
    moved = false
    for (const [id, pointer] of pointers) {
      if (!pointer.over) continue
      const intersection = castOr(pointer.ndcX, pointer.ndcY, pointer.hit.intersection)
      if (sameHit(pointer.hit.intersection, intersection)) continue
      const next = hitOf(intersection)
      moveTo(id, pointer, next, sceneEvent(pointer.x, pointer.y, next, undefined))
    }
  }

  const dispose = (): void => {
    for (const cancel of Arr.fromIterable(watches)) cancel()
    Arr.forEach(CANVAS_EVENTS, (type) => canvas.removeEventListener(type, onCanvas))
    pointers.clear()
  }

  return { source, frame, wantsFrame: () => moved && watched(), hover, press, dispose }
}
