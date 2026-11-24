/**
 * `createSceneObject` (ADR-0073 decisions 10, 14 and 15): an object's membership of the scene, with a ward
 * for its motion. It joins once its ward can start, its `initial` drawn in its first frame, and plays its
 * `exit` before it leaves, as its owner ends or as an accessor gives another object, or none:
 *
 * ```tsx
 * function Card(props: { readonly open: boolean }) {
 *   const card = createSceneObject(() => (props.open ? mesh : undefined), {
 *     initial: { scale: 0 }, animate: { scale: 1 }, exit: { scale: 0 },
 *   })
 *   return card.held
 * }
 * ```
 *
 * - **Its parent:** the one given, else the one it has (a node of a loaded model stays where it is, and
 *   leaves from there), else the Stage's scene.
 * - **Its exit** runs on its ward's own spine past its owner, from where it is at the speed it has; its
 *   object leaves once it lands, or at once when the Stage ends first.
 * - **`dispose: true`** disposes its geometries and materials, and its descendants', once it has left.
 *
 * A camera or a material never joins a scene: give them to `ward`.
 *
 * @module
 */
// #885's PR 2 (ADR-0073, *Amendment (#885)*, Q5 and Q6).
import { isServer } from "@solidjs/web"
import { type SceneWard, stageSceneObject, type StageMembership, type StageSubjectOf, type StageWardConfig, WardicStage } from "@wardic/solid"
import * as Arr from "effect/Array"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import { type Accessor, omit, useContext } from "solid-js"
import type { Object3D } from "three"
import { inertWardOn, SCENE, type SceneOf, type SceneStage } from "./stage.ts"

/** The keys of a ward a Scene object takes, with its `exit`. */
type SceneMotion = Pick<
  StageWardConfig,
  | "initial"
  | "animate"
  | "exit"
  | "transition"
  | "variants"
  | "whileHover"
  | "whileTap"
  | "whileDrag"
  | "custom"
  | "drag"
  | "dragPlane"
  | "dragConstraints"
  | "dragElastic"
  | "dragMomentum"
  | "dragTransition"
  | "dragSnapToOrigin"
>

/** A Scene object's config: its ward's, its `exit`, its parent, and whether it's disposed once it has left. */
export interface SceneObjectConfig extends SceneMotion {
  /** The object it joins: else the parent it has, else the Stage's scene. */
  readonly parent?: Object3D | undefined
  /** Dispose its geometries and materials, and its descendants', once it has left. Off: they're the app's. */
  readonly dispose?: boolean | undefined
}

/** A Scene object's handle: its ward, with `exitStart` and `exitComplete` (ADR-0073 decision 15), reading `S`'s keys at their types. */
export type SceneObject<S = Object3D> = SceneWard<SceneMotion, S>

/** No three.js Stage above it. */
const NO_STAGE = "createSceneObject(object, config): no three.js Stage above it. Make one with `createStage` and give it to `<WardicStage value={stage}>` above this component."

/** Nowhere to join. */
const NO_PARENT =
  "createSceneObject(object, config): the object has no parent, and the Stage adopts a runtime with no scene of its own. Give it one: `createSceneObject(object, { parent: group, … })`."

/** `value`'s `dispose()`, when it has one: a geometry's, a material's. */
const disposeOf = (value: unknown): void => {
  if (Predicate.hasProperty(value, "dispose") && Predicate.isFunction(value.dispose)) value.dispose()
}

/** `object`'s geometries and materials, and its descendants', disposed. */
const disposeTree = (object: Object3D): void =>
  object.traverse((node) => {
    const parts = node as unknown as { readonly geometry?: unknown; readonly material?: unknown }
    disposeOf(parts.geometry)
    Arr.forEach(Arr.ensure(parts.material), disposeOf)
  })

/** The parent `object` joins: the one given, else the one it has, else the Stage's scene. */
const joiningParentOf = (object: Object3D, given: Object3D | undefined, scene: Object3D | undefined): Object3D => {
  if (Predicate.isNotUndefined(given)) return given
  if (Predicate.isNotNull(object.parent)) return object.parent
  return UndefinedOr.match(scene, {
    onUndefined: () => {
      throw new Error(NO_PARENT)
    },
    onDefined: (root) => root,
  })
}

/** The three.js Stage in context: what `createSceneObject` needs of it. */
const sceneOfContext = (): SceneOf => {
  const stage = useContext(WardicStage) as Partial<SceneStage> | null
  if (Predicate.isNull(stage)) throw new Error(NO_STAGE)
  return UndefinedOr.match(stage[SCENE], {
    onUndefined: () => {
      throw new Error(NO_STAGE)
    },
    onDefined: (scene) => scene,
  })
}

/**
 * An object's membership of the Stage's scene, with a ward for its motion: given as a value, or as an
 * accessor whose `undefined` takes it out, and whose next object enters as the last one exits.
 *
 * @example
 * const card = createSceneObject(mesh, { parent: board, initial: { scale: 0 }, animate: { scale: 1 }, exit: { scale: 0 } })
 * createEffect(card.when("tap"), () => {
 *   props.onPick()
 * })
 */
export const createSceneObject = <G extends Object3D | Accessor<Object3D | undefined>>(object: G, config: SceneObjectConfig): SceneObject<StageSubjectOf<G>> => {
  if (isServer) return inertWardOn(object) as unknown as SceneObject<StageSubjectOf<G>>
  const scene = sceneOfContext()
  const membership: StageMembership = {
    join: (subject) => {
      const joining = subject as Object3D
      const parent = joiningParentOf(joining, config.parent, scene.scene)
      if (joining.parent !== parent) parent.add(joining)
    },
    leave: (subject) => {
      const leaving = subject as Object3D
      leaving.removeFromParent()
      if (config.dispose === true) disposeTree(leaving)
    },
    // Where a Variant child looks for the ward it follows, at its setup (decision 17).
    parentOf: (subject) => joiningParentOf(subject as Object3D, config.parent, scene.scene),
    exiting: (land) => {
      scene.exits.add(land)
      return () => void scene.exits.delete(land)
    },
  }
  // Its ward's keys alone, read per key as a ward reads them: `parent` and `dispose` are the membership's.
  const motion = omit(config, "parent", "dispose") as StageWardConfig
  return stageSceneObject(scene.environment)(object, scene.split(object, motion), membership) as SceneObject<StageSubjectOf<G>>
}
