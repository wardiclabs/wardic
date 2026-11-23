/**
 * `createStage` (ADR-0073 decisions 11–13): a Stage that runs a three.js scene for its owner. It's the
 * `Stage` the hooks under a `<WardicStage>` find (`ward(mesh, config)`, `createFrameEffect`, the sensors),
 * and the ref that mounts and sizes the renderer's canvas:
 *
 * ```tsx
 * const stage = createStage({ renderer: () => new WebGLRenderer({ antialias: true }), scene, camera })
 * <WardicStage value={stage}>
 *   <div class="viewport" ref={stage} />
 *   <Crate />
 * </WardicStage>
 * ```
 *
 * - **Its Host loop:** `renderer.setAnimationLoop`, the scene's raycast, then Wardic's frame, then the
 *   render. With `frameloop: "demand"`, it renders only when something moves, or after `invalidate()`.
 * - **Given as a ref,** an element mounts `renderer.domElement` and keeps it sized: `setSize`, and a
 *   perspective camera's `aspect`. `resize: false` leaves the size to the app.
 * - **`renderer`** is an instance, in client-only code, or a factory the browser calls once the page has
 *   settled. `{ wardic: made }` adopts a runtime made outside Solid, whose maker pumps its frames.
 * - **On a server** it does nothing: its ref renders nothing, and the hooks under it animate nothing.
 * - **It ends with its owner:** the loop, the input and the runtime stop; the renderer, scene and camera
 *   stay the app's.
 *
 * @module
 */
// #885's PR 1 (ADR-0073, *Amendment (#885)*, Q2–Q4).
import { isServer } from "@solidjs/web"
import * as InputFeed from "@wardic/core/InputFeed"
import type * as InputSource from "@wardic/core/InputSource"
import { type Stage, type StageWard, stageWard, type StageWardEnvironment } from "@wardic/solid"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import { constUndefined, constVoid } from "effect/Function"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Atom from "effect/reactivity/Atom"
import * as UndefinedOr from "effect/UndefinedOr"
import { onCleanup, onSettled, untrack } from "solid-js"
import type { Camera, Object3D } from "three"
import * as ThreeColours from "../ThreeColours.ts"
import * as ThreeInput from "../ThreeInput.ts"
import * as WardicThree from "../WardicThree.ts"

/** What a Stage needs of a renderer: three's `WebGLRenderer` and `WebGPURenderer` both have it. */
export interface RendererLike {
  readonly domElement: HTMLCanvasElement
  readonly setSize: (width: number, height: number, updateStyle?: boolean) => void
  readonly setAnimationLoop: (callback: ((time: number) => void) | null) => unknown
  readonly render: (scene: Object3D, camera: Camera) => unknown
}

/** A Stage's options: the scene it draws, its camera, its renderer, and the runtime's own options. */
export interface StageOptions extends Omit<WardicThree.Options, "canvas" | "camera" | "scene" | "now"> {
  /** The scene it draws and a pointer hits. */
  readonly scene: Object3D
  /** The camera it draws with, or a function giving the one active now. */
  readonly camera: Camera | (() => Camera)
  /** The renderer, or a function making it, which the browser calls once the page has settled. */
  readonly renderer: RendererLike | (() => RendererLike)
  /** `"always"` renders every frame; `"demand"`, only when something moves, or after `invalidate()`. */
  readonly frameloop?: "always" | "demand" | undefined
  /** `false` leaves the canvas's size to the app. */
  readonly resize?: boolean | undefined
}

/** A Stage over a runtime made outside Solid: its maker pumps its frames and draws. */
export interface AdoptOptions {
  readonly wardic: WardicThree.WardicThree
}

/** A three.js Stage: the `Stage` the hooks find, the ref that mounts its canvas, and its own calls. */
export interface ThreeStage extends Stage {
  /** Mount the renderer's canvas in `element`, kept sized: give the Stage to an element's `ref`. */
  (element: HTMLElement): void
  /** Draw a frame under `frameloop: "demand"`: the scene changed in a way Wardic didn't. */
  readonly invalidate: () => void
  /** The runtime, for code outside Solid: `stage.wardic.batch(…)`, `stage.wardic.hover(…)`. */
  readonly wardic: WardicThree.WardicThree | undefined
}

/** Whether `value` is one of a scene's Subjects: an `Object3D` or a `Material`, by three's flags. */
export const isThreeSubject = (value: unknown): boolean =>
  Predicate.isObject(value) && ((value as { readonly isObject3D?: unknown }).isObject3D === true || (value as { readonly isMaterial?: unknown }).isMaterial === true)

/**
 * An `InputSource` the Stage's hooks can watch before its canvas is made (a renderer made once the page
 * has settled): each feed connects to the scene's input as it's attached. Internal; exported for its test.
 */
export const lateInput = (): { readonly source: InputSource.InputSource["Service"]; readonly attach: (source: InputSource.InputSource["Service"]) => void } => {
  let real: InputSource.InputSource["Service"] | undefined
  const waiting = new Set<(given: InputSource.InputSource["Service"]) => void>()
  const later =
    <A>(feedOf: (source: InputSource.InputSource["Service"]) => InputFeed.InputFeed<A>): InputFeed.InputFeed<A> =>
    (emit, end) => {
      if (Predicate.isNotUndefined(real)) return feedOf(real)(emit, end)
      let cancel: () => void = constVoid
      const connect = (given: InputSource.InputSource["Service"]): void => {
        cancel = feedOf(given)(emit, end)
      }
      waiting.add(connect)
      return () => {
        waiting.delete(connect)
        cancel()
      }
    }
  const source: InputSource.InputSource["Service"] = {
    pointer: (target) => later((given) => given.pointer(target)),
    keyboard: () => InputFeed.empty,
    focus: () => InputFeed.empty,
    adoptPointer: () => Option.none(),
    pointerAmong: (memberOf) => later((given) => UndefinedOr.match(given.pointerAmong, { onUndefined: () => InputFeed.empty, onDefined: (among) => among(memberOf) })),
  }
  const attach = (given: InputSource.InputSource["Service"]): void => {
    real = given
    const connecting = Arr.fromIterable(waiting)
    waiting.clear()
    Arr.forEach(connecting, (connect) => connect(given))
  }
  return { source, attach }
}

/**
 * `subject`, a Subject or an accessor of one, as the Subject now: an accessor read untracked, since the
 * colour split only looks up which keys are a colour on it, often in the component's body, and the ward
 * follows the Subject itself.
 */
const subjectNowOf = (subject: unknown): (() => unknown) => {
  if (Predicate.isFunction(subject)) return () => untrack(subject as () => unknown)
  return () => subject
}

/** Where a three.js Stage keeps what `createSceneObject` needs of it: not the `Stage` interface's. */
export const SCENE: unique symbol = Symbol.for("@wardic/three/solid/scene")

/**
 * What `createSceneObject` needs of a Stage (#885): what its wards run on, its scene, and its exits in
 * flight. `createSceneObject` makes its own ward on it, so a Stage app that never calls it carries none.
 */
export interface SceneOf {
  /** What its wards run on. */
  readonly environment: StageWardEnvironment
  /** A config's colours split into their channels on `subject`, as the Stage's ward splits them. */
  readonly split: <C>(subject: unknown, config: C) => C
  /** The scene a Scene object with no parent joins: none on a Stage adopting a runtime. */
  readonly scene: Object3D | undefined
  /** Each exit in flight, by what lands it now: the Stage lands them as it ends. */
  readonly exits: Set<() => void>
}

/** A three.js Stage, with what `createSceneObject` needs of it. */
export type SceneStage = Stage & { readonly [SCENE]: SceneOf }

/** Every exit still in flight landed: its Subject taken out, as the Stage ends (*Amendment (#885)* Q5). */
export const landExits = (stage: { readonly [SCENE]: SceneOf }): void =>
  Arr.forEach(Arr.fromIterable(stage[SCENE].exits), (land) => land())

/**
 * The Stage over `runtime`: its Subjects three's, its ward the Stage ward on the runtime, each colour of
 * its config split into its channels in linear light as three's `animate` splits a call's, its input
 * `input`. `scene` is what a Scene object with no parent joins.
 */
export const stageOver = (runtime: WardicThree.WardicThree, input: InputSource.InputSource["Service"], scene: Object3D | undefined): SceneStage => {
  const environment: StageWardEnvironment = { ...runtime.stageEnvironment, input }
  const ward = stageWard(environment)
  const split = <C,>(subject: unknown, config: C): C => ThreeColours.splitConfig(subjectNowOf(subject), config as Readonly<Record<string, unknown>>) as C
  return {
    isSubject: isThreeSubject,
    ward: (subject, config, options) => ward(subject, split(subject, config), options),
    animate: runtime.animate as unknown as Stage["animate"],
    frameEffects: runtime.stageEnvironment.frameEffects,
    input,
    [SCENE]: {
      environment,
      split,
      scene,
      exits: new Set(),
    },
  }
}

/** No input: a runtime made with no canvas, on a server. */
const NO_INPUT: InputSource.InputSource["Service"] = {
  pointer: () => InputFeed.empty,
  keyboard: () => InputFeed.empty,
  focus: () => InputFeed.empty,
  adoptPointer: () => Option.none(),
}

/** A ward that does nothing: a server's, and a server's Scene object's. */
export const INERT_WARD: StageWard = {
  held: undefined,
  settled: constUndefined,
  tapped: constUndefined,
  next: () => new Promise(() => {}),
  each: () => ({ [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) }),
  when: () => constUndefined as never,
  read: (() => constUndefined) as unknown as StageWard["read"],
  atom: () => Atom.make<unknown>(undefined),
}

/** A Stage on a server: its ref renders nothing, its hooks animate nothing, and it runs no loop. */
// ADR-0073 decision 13: the host `<div>` renders empty, so hydration matches.
export const inertStage = (): ThreeStage =>
  Object.assign((_element: HTMLElement) => undefined, {
    isSubject: isThreeSubject,
    ward: () => INERT_WARD,
    animate: (): never => {
      throw new Error("A Stage animates nothing on a server: call animate in the browser, in an event or once the page has settled.")
    },
    frameEffects: { add: () => constVoid, request: constVoid },
    input: NO_INPUT,
    invalidate: constVoid,
    wardic: undefined,
  }) as ThreeStage

/** `options.renderer`'s renderer, made: a factory is called, an instance is itself. */
const rendererOf = (renderer: StageOptions["renderer"]): RendererLike => {
  if (Predicate.isFunction(renderer)) return (renderer as () => RendererLike)()
  return renderer
}

/** The camera now: one given, or the one a function gives. */
const cameraOf = (camera: StageOptions["camera"]): Camera => {
  if (Predicate.isFunction(camera)) return (camera as () => Camera)()
  return camera
}

/** A Stage over `made`, a runtime made outside Solid: its maker pumps its frames and draws; it adopts no loop. */
const adopted = (made: WardicThree.WardicThree): ThreeStage =>
  Object.assign((_element: HTMLElement) => undefined, stageOver(made, UndefinedOr.match(made.input, { onUndefined: () => NO_INPUT, onDefined: (given) => given }), undefined), {
    invalidate: constVoid,
    wardic: made,
  }) as ThreeStage

/**
 * A Stage that runs `options.scene` for its owner: its Host loop, its pointer input, and its canvas's size.
 * Make it in a component's body; it ends with its owner. Given `{ wardic }`, it adopts that runtime.
 *
 * @example
 * const stage = createStage({ renderer: () => new WebGLRenderer({ antialias: true }), scene, camera })
 * <WardicStage value={stage}>
 *   <div class="viewport" ref={stage} />
 * </WardicStage>
 */
export const createStage = (options: StageOptions | AdoptOptions): ThreeStage => {
  if (isServer) return inertStage()
  if ("wardic" in options) return adopted(options.wardic)
  const { scene, camera, frameloop = "always", resize = true, renderer: given, ...rest } = options
  const runtime = WardicThree.make({ ...rest, scene, camera })
  const late = lateInput()
  let renderer: RendererLike | undefined
  let input: ThreeInput.SceneInput | undefined
  let host: HTMLElement | undefined
  let observer: ResizeObserver | undefined
  // The first frame draws, as does each one after `invalidate()`.
  let invalidated = true

  /** The canvas in `element`, kept sized to it: the renderer's size, and a perspective camera's aspect. */
  const mount = (element: HTMLElement, made: RendererLike): void => {
    if (made.domElement.parentElement !== element) element.append(made.domElement)
    if (Bool.not(resize)) return
    UndefinedOr.map(observer, (last) => last.disconnect())
    const sized = new ResizeObserver(() => {
      const width = Math.max(1, element.clientWidth)
      const height = Math.max(1, element.clientHeight)
      made.setSize(width, height)
      const now = cameraOf(camera) as Camera & { readonly isPerspectiveCamera?: boolean; aspect?: number; readonly updateProjectionMatrix?: () => void }
      if (now.isPerspectiveCamera === true) {
        now.aspect = width / height
        UndefinedOr.map(now.updateProjectionMatrix, (update) => update.call(now))
      }
      invalidated = true
    })
    sized.observe(element)
    observer = sized
  }

  /** The renderer made: its input attached, its canvas mounted, and its loop started. */
  const start = (made: RendererLike): void => {
    renderer = made
    const madeInput = ThreeInput.make({ canvas: made.domElement, camera, scene, hitTest: rest.hitTest, window: rest.window })
    input = madeInput
    late.attach(madeInput.source)
    UndefinedOr.map(host, (element) => mount(element, made))
    made.setAnimationLoop((time) => {
      // The raycast first, against what was last drawn; then Wardic's writes; then the render.
      madeInput.frame()
      runtime.frame(time)
      if (frameloop === "demand" && Bool.not(Bool.some([invalidated, runtime.wantsFrame(), madeInput.wantsFrame()]))) return
      invalidated = false
      made.render(scene, cameraOf(camera))
    })
  }

  // A factory waits for the page to settle, so a server never calls it and hydration makes no canvas.
  Bool.match(Predicate.isFunction(given), {
    onTrue: () => onSettled(() => start(rendererOf(given))),
    onFalse: () => start(given as RendererLike),
  })

  const over = stageOver(runtime, late.source, scene)
  onCleanup(() => {
    // Exits still in flight land first: their Subjects leave the scene, which stays the app's.
    landExits(over)
    UndefinedOr.map(renderer, (made) => {
      made.setAnimationLoop(null)
      made.domElement.remove()
    })
    UndefinedOr.map(observer, (sized) => sized.disconnect())
    UndefinedOr.map(input, (madeInput) => madeInput.dispose())
    runtime.dispose()
  })

  const ref = (element: HTMLElement): void => {
    host = element
    UndefinedOr.map(renderer, (made) => mount(element, made))
  }
  return Object.assign(ref, over, {
    invalidate: () => {
      invalidated = true
    },
    wardic: runtime,
  }) as ThreeStage
}
