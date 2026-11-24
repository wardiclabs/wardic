/**
 * A Stage's hooks alone (#927): `ward`, `createBatch` and the sensors on a Stage's Subjects, with none of
 * the page's code. `@wardic/solid`'s own `ward`, `createBatch` and sensors take a page's element or a
 * scene's object, so each carries the page's half too: its ward, its Batch, its gesture Features. These
 * take only what the Stage in context takes. An Environment's binding re-exports them under the hooks'
 * own names (`@wardic/three/solid`'s `ward`, `createBatch`, `createHover`, `createPress` and
 * `createDrag`), so a scene that has no page wards carries none of the page's code.
 *
 * @module
 */
// #927 (ADR-0073, *Amendment (#885)*, #927's note): `ward` is the Complete ward, whose module brings
// every DOM Feature, 44.7 KB gzipped of the 57.6 a scene-only app paid for it. A provider can't take them
// over without every Slim app carrying them, so the Stage's hooks are exported apart, and the full hooks'
// Stage forms run the same watches as these.
import type * as Drag from "@wardic/core/Drag"
import type * as InputFeed from "@wardic/core/InputFeed"
import type * as InputSource from "@wardic/core/InputSource"
import * as Recognizer from "@wardic/core/Recognizer"
import * as Bool from "effect/Boolean"
import type * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import type * as Scope from "effect/Scope"
import * as UndefinedOr from "effect/UndefinedOr"
import { type Accessor, DEV, useContext } from "solid-js"
import { type CreateDragOptions, watchDragSamples } from "./drag-samples.ts"
import { isElement, stageSensorOf } from "./sensors.tsx"
import { type StageBatch, type StageCountBatchConfig, type StageKeyedBatchConfig, type StageSubject, type StageSubjectOf, type StageWard, type StageWardChecked, type StageWardConfig, WardicStage } from "./stage.ts"
import { stageBatchOf } from "./stage-batch.ts"
import { isWard, type WardOptions } from "./ward.tsx"

/** A watch of a Stage's Subject on its input: what a sensor reads. */
type StageWatch<A> = (subject: unknown, handlers: InputFeed.Handlers<A>) => Effect.Effect<void, never, Scope.Scope | InputSource.InputSource>

/** `createHover`'s watch of a Stage's Subject: whether the pointer is over it in the scene. */
export const watchHoverOnStage: StageWatch<boolean> = (subject, { on, onDefect }) => Recognizer.watchHover(subject, { on: (edge) => on(edge.active), onDefect })

/** `createPress`'s watch of a Stage's Subject: whether a pointer is pressed on it in the scene. A scene's object takes no focus, so no keys. */
export const watchPressOnStage: StageWatch<boolean> = (subject, { on, onDefect }) =>
  Recognizer.watchPress(subject, { on: (press) => on(press.phase === "start"), onDefect }, { keys: false })

/** `createDrag`'s watch of a Stage's Subject with `options`: its drags' pointer samples. */
export const watchDragOnStage =
  (options: CreateDragOptions | undefined): StageWatch<Drag.Sample | null> =>
  (subject, handlers) =>
    watchDragSamples(subject, { ...options }, handlers)

/** What a Stage's hook says when it's given what the page's hook would take. */
const pageOnes = (name: string): string =>
  `${name}(subject): this ${name} is a Stage's, for its Subjects under a <WardicStage>. For a page's element or a ward, import ${name} from @wardic/solid.`

/** A sensor of a Stage's Subject: the page's targets refused in development, its reading `initial` where there's no scene (a server). */
const sensorOnStage = <A>(name: string, subject: unknown, initial: A, watch: StageWatch<A>): Accessor<A> => {
  if (DEV && Bool.some([Predicate.isUndefined(subject), isElement(subject), isWard(subject)])) throw new Error(pageOnes(name))
  return UndefinedOr.match(stageSensorOf(name, subject, initial, watch), { onUndefined: () => () => initial, onDefined: (sensed) => sensed })
}

/**
 * Wardic's motion for one of a Stage's Subjects, under a `<WardicStage>`: `@wardic/solid`'s `ward(subject,
 * config)` for a scene's object, with none of the page's ward. An accessor Subject follows each one it gives.
 *
 * @example
 * const crate = wardOnStage(mesh, { initial: { scale: 0 }, animate: { scale: 1 }, whileHover: { y: 0.3 } })
 * @see https://wardic.dev/reference/solid/provider/wardic-stage
 */
export function wardOnStage<const C extends StageWardConfig, G extends StageSubject | Accessor<StageSubject | undefined>>(
  subject: G,
  config: StageWardChecked<C>,
  options?: WardOptions,
): StageWard<C, StageSubjectOf<G>>
export function wardOnStage(subject: unknown, config: unknown, options?: WardOptions): StageWard {
  const stage = useContext(WardicStage)
  if (Predicate.isNull(stage)) {
    throw new Error("ward(subject, config): no <WardicStage> is above it. Give the scene's Stage to its tree, <WardicStage value={stage}>, or call the Stage itself, stage.ward(subject, config).")
  }
  if (Bool.not(Bool.or(Predicate.isFunction(subject), stage.isSubject(subject)))) throw new Error(pageOnes("ward"))
  return stage.ward(subject, config as StageWardConfig, options)
}

/**
 * A scene's Batch, under a `<WardicStage>` whose Stage makes them: `@wardic/solid`'s `createBatch` given
 * `object` or `instances`, with none of the page's Batch.
 *
 * @see https://wardic.dev/reference/solid/provider/wardic-stage
 */
export function createBatchOnStage<T>(config: StageKeyedBatchConfig<T>): StageBatch
export function createBatchOnStage(config: StageCountBatchConfig): StageBatch
// `object`: a keyed config of `T` isn't one of `unknown`'s, its functions taking `T`.
export function createBatchOnStage(config: object): StageBatch {
  return stageBatchOf(config as StageKeyedBatchConfig<unknown> | StageCountBatchConfig)
}

/** `true` while the pointer is over one of a Stage's Subjects in the scene: `@wardic/solid`'s `createHover(subject)`, a scene's alone. */
export const createHoverOnStage = (subject: StageSubject): Accessor<boolean> => sensorOnStage("createHover", subject, false, watchHoverOnStage)

/** `true` while a pointer is pressed on one of a Stage's Subjects: `@wardic/solid`'s `createPress(subject)`, a scene's alone. */
export const createPressOnStage = (subject: StageSubject): Accessor<boolean> => sensorOnStage("createPress", subject, false, watchPressOnStage)

/** The pointer's samples of each drag on one of a Stage's Subjects: `@wardic/solid`'s `createDrag(subject)`, a scene's alone. */
export const createDragOnStage = (subject: StageSubject, options?: CreateDragOptions): Accessor<Drag.Sample | null> =>
  sensorOnStage<Drag.Sample | null>("createDrag", subject, null, watchDragOnStage(options))
