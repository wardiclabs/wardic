/**
 * A Stage, as the shared hooks find it (ADR-0073 decisions 11, 12 and 20): what runs a scene for its
 * owner, through a Solid context, `WardicStage`, which is its own provider. It names no three.js code:
 * `@wardic/three/solid`'s `createStage` fills it for a three.js scene, and another Environment (Pixi, a
 * terminal) would fill the same interface.
 *
 * Under a `WardicStage`, `ward(mesh, config)` hands a Subject the Stage says is its own to the Stage's
 * ward, an accessor of one too, and `createFrameEffect` runs in the Stage's Host loop, before it renders.
 *
 * @example
 * const stage = createStage({ renderer, scene, camera })
 * <WardicStage value={stage}>
 *   <Card />
 * </WardicStage>
 *
 * @module
 */
// #884's PR 3 (ADR-0073, *Amendment (#884)*, Q3 and Q4).
import type { JSX } from "@solidjs/web"
import type * as Drag from "@wardic/core/Drag"
import type * as InputFeed from "@wardic/core/InputFeed"
import type * as InputSource from "@wardic/core/InputSource"
import type * as Config from "@wardic/core/unstable/Config"
import type * as FrameEffects from "@wardic/core/unstable/FrameEffects"
import type * as Imperative from "@wardic/core/unstable/Imperative"
import { type Accessor, type Context, createContext } from "solid-js"
import type * as Effect from "effect/Effect"
import type * as Atom from "effect/reactivity/Atom"
import type * as Scope from "effect/Scope"
import type * as BatchMembers from "@wardic/dom/unstable/BatchMembers"
import type { PerKey, PerKeyApart } from "./config-view.ts"
import type { WardElement, WardEvents, WardSettled } from "./lifecycle.ts"
import type { WardCallbackKey, WardConfigValues, WardOptions, WardRead } from "./ward.tsx"
import type { WardCheckedConfig } from "./ward-keys.ts"

/**
 * The Subjects a Stage takes, by the Environment that fills one, for `ward`'s types:
 * `@wardic/three/solid` adds three.js's objects, as `declare module "@wardic/solid" { interface
 * StageSubjects { three: Object3D | Material } }` does. None until one does, so a config is never taken
 * for a Subject.
 */
// #884's PR 3: by declaration merging, so `@wardic/solid` names no three.js type.
export interface StageSubjects {}

/** A Stage's Subject: any an Environment has added to {@link StageSubjects}. */
export type StageSubject = StageSubjects[keyof StageSubjects]

/** A drag's range on one axis of its Subject's parent's space: its least, then its most. */
export type StageDragRange = readonly [min: number, max: number]

/** A scene drag's release: its inertia's, as `type: "inertia"`'s, Motion's `dragTransition`. */
export type StageDragTransition = Omit<Config.WardicInertia, "type" | "velocity" | "min" | "max">

/**
 * A scene's drag keys (#885's PR 4; ADR-0070 decision 9, kept by ADR-0073 decision 18), in a Stage ward's
 * config in the page's drag keys' place. An Environment adds its own by declaration merging:
 * `@wardic/three/solid` adds `dragPlane`.
 */
export interface StageDragConfig {
  /**
   * `true` drags its Subject on the plane through the point grabbed, facing the camera; `"x"`, `"y"` or
   * `"z"`, along that axis of its parent's space.
   */
  readonly drag?: boolean | "x" | "y" | "z" | undefined
  /** Its ranges per axis, in its parent's space: `{ x: [-2, 2], z: [-2, 2] }`. */
  readonly dragConstraints?: { readonly x?: StageDragRange; readonly y?: StageDragRange; readonly z?: StageDragRange } | undefined
  /** How far it's pulled past a range: 0 stops it there, 1 lets it go freely. Default 0.35. */
  readonly dragElastic?: number | undefined
  /** Whether it glides on at its release's speed. Default `true`. */
  readonly dragMomentum?: boolean | undefined
  /** Its release's inertia. */
  readonly dragTransition?: StageDragTransition | undefined
  /** Whether it goes back to where it was picked up from at its release. */
  readonly dragSnapToOrigin?: boolean | undefined
}

/** A Stage ward's config values: a ward's, with a scene's drag keys in the page's. */
export interface StageWardConfigValues extends Omit<WardConfigValues, keyof StageDragConfig>, StageDragConfig {}

/** A Stage ward's config: each key a value, or an accessor of it, read per key, as a ward's. */
export type StageWardConfig = PerKey<StageWardConfigValues, WardCallbackKey>

/** A Stage ward's config `C`, its transitions' entries checked against the keys each drives, as `WardChecked`. */
export type StageWardChecked<C> = WardCheckedConfig<C, PerKeyApart<StageWardConfigValues, WardCallbackKey>, StageValueKey>

/**
 * The values a Stage's Subjects take beyond an element's, by name, for a ward's config on one: an
 * Environment adds its own by declaration merging, as it adds its Subjects to {@link StageSubjects}.
 * `@wardic/three/solid` adds three.js's: a material's `roughness` and `emissive`, a light's
 * `intensity`, a camera's `fov`. A name in neither an element's values nor these is an error naming it.
 */
// #934: the scene lab's keys were all an element's too (`opacity`, `color`); a material's own weren't.
export interface StageValues {}

/** The names of {@link StageValues}. */
export type StageValueKey = keyof StageValues & string

/** What a drag tells as it goes: each pointer sample, and its release coming to rest. */
export interface StageDragHandlers {
  readonly sample: (sample: Drag.Sample) => void
  readonly released: () => void
  readonly onDefect?: InputFeed.OnDefect | undefined
}

/** What a Stage drags its Subjects with (#885's PR 4): its Environment's, `@wardic/three`'s `ThreeDrag` for three's. */
export interface StageDrag {
  /**
   * Watch `subject`'s drags on the Stage's input: each gesture read with `config()` at its start, its
   * Subject moved as it goes, and released at its end.
   */
  readonly watch: (subject: object, config: () => StageDragConfig, handlers: StageDragHandlers) => Effect.Effect<void, never, Scope.Scope | InputSource.InputSource>
}

/**
 * A scene Batch's values (#885's PR 5): its keys' numbers, three's keys (`x`, `y`, `z`, `rotateY`,
 * `scale` and the rest), a colour key a colour, as `animate`'s. Its keys are its first targets'.
 */
export type StageBatchValues = Readonly<Record<string, unknown>>

/** A scene Batch's gesture or exit: its values, and the transition it runs on, else the Batch's. */
export type StageBatchTarget = StageBatchValues & { readonly transition?: BatchMembers.WardicBatchTransition | undefined }

/** What a scene Batch's members are: a three.js object each (`object`), or an `InstancedMesh`'s instances (`instances`). */
export type StageBatchMembers<Args extends ReadonlyArray<unknown>> =
  | {
      /** Each member's object, made as it enters, which joins `parent` (else its own, else the Stage's scene) and leaves once its exit lands. */
      readonly object: (...args: Args) => object
      readonly instances?: undefined
    }
  | {
      /** An `InstancedMesh`: each member an instance, at the next free index as it enters; as one leaves, the last moves into its index. */
      readonly instances: object
      readonly object?: undefined
    }

/** A scene Batch's config by count (#885's PR 5; ADR-0070 decision 11): `count` members, each `animate(i)`. */
export type StageCountBatchConfig = StageBatchMembers<[i: number]> & {
  readonly count: number
  readonly initial?: false | StageBatchValues | ((i: number) => StageBatchValues) | undefined
  readonly animate: (i: number) => StageBatchValues
  readonly whileHover?: StageBatchTarget | ((i: number) => StageBatchValues) | undefined
  readonly whileTap?: StageBatchTarget | ((i: number) => StageBatchValues) | undefined
  readonly transition?: BatchMembers.WardicBatchTransition | undefined
  /** The object its members join: else each one's own parent, else the Stage's scene. */
  readonly parent?: object | undefined
  /** Its keys, fixed now: else its first targets'. */
  readonly keys?: ReadonlyArray<string> | undefined
}

/** A scene Batch's keyed config (#885's PR 5; ADR-0070 decisions 11 and 13): a list's items, each a member by its key. */
export type StageKeyedBatchConfig<T> = StageBatchMembers<[item: T, i: number]> & {
  readonly each: () => ReadonlyArray<T>
  readonly key: keyof T | ((item: T) => unknown)
  readonly initial?: false | StageBatchValues | ((item: T, i: number) => StageBatchValues) | undefined
  readonly animate: (item: T, i: number) => StageBatchValues
  /** What a leaving member plays before it leaves. */
  readonly exit?: StageBatchTarget | ((item: T, i: number) => StageBatchValues) | undefined
  readonly whileHover?: StageBatchTarget | ((item: T, i: number) => StageBatchValues) | undefined
  readonly whileTap?: StageBatchTarget | ((item: T, i: number) => StageBatchValues) | undefined
  readonly transition?: BatchMembers.WardicBatchTransition | undefined
  readonly parent?: object | undefined
  /** Dispose each object's geometries and materials, and its descendants', once it has left. */
  readonly dispose?: boolean | undefined
  readonly keys?: ReadonlyArray<string> | undefined
}

/** A scene Batch's member, as its gesture events tell it: its index now, a keyed one's item, and its object or instance. */
export interface StageBatchMemberInfo {
  readonly i: number
  readonly item?: unknown
  /** Its object, or for an instance, `{ mesh, index }`. */
  readonly element: object
}

/** A scene Batch's events, by name, for `next` and `when`: its landings, and its members' hovers and presses. */
export interface StageBatchEvents {
  /** Every member at rest again: how many set off in the flight. */
  readonly settled: { readonly moved: number }
  readonly hoverStart: StageBatchMemberInfo
  readonly hoverEnd: StageBatchMemberInfo
  readonly pressStart: StageBatchMemberInfo
  readonly tap: StageBatchMemberInfo
  readonly tapCancel: StageBatchMemberInfo
}

/** A scene Batch: its landings, as a page's Batch's. Its members are its own: it adds and removes them. */
export interface StageBatch {
  /** Its last landing, `undefined` before the first: pending while a member moves. */
  readonly settled: () => StageBatchEvents["settled"] | undefined
  /** A promise of its next `name`. */
  readonly next: <E extends keyof StageBatchEvents>(name: E) => Promise<StageBatchEvents[E]>
  /** Every `name` from now on, for an effect. */
  readonly when: <E extends keyof StageBatchEvents>(name: E) => Accessor<StageBatchEvents[E]>
}

/** What a scene Batch tells its binding: a flight's start, its landing, and its members' gestures. */
export interface StageBatchHooks {
  readonly started: () => void
  readonly landed: (landing: StageBatchEvents["settled"]) => void
  readonly gesture: <E extends Exclude<keyof StageBatchEvents, "settled">>(name: E, info: StageBatchEvents[E]) => void
}

/**
 * A scene Batch bound to its Stage, as `createBatch` drives it: its targets read where they track, a
 * compute's, then applied, its members entering and leaving, by its effect; its gestures watched once asked for.
 */
export interface StageBatchBinding {
  readonly targetsOf: () => unknown
  readonly apply: (targets: unknown) => void
  readonly listen: (gesture: "hover" | "press") => void
  readonly dispose: () => void
}

/** An event a ward on a Stage's Subject tells: its landings, its hovers and presses, and its drags, through the Stage's input. */
export type StageEvent = "settled" | "hoverStart" | "hover" | "hoverEnd" | "pressStart" | "tap" | "tapCancel" | "dragStart" | "drag" | "dragEnd" | "dragTransitionEnd"

/** An event's info on a Stage's Subject: a ward's, with the Subject as its `element`. */
type OnSubject<T> = T extends { readonly element: WardElement } ? Omit<T, "element"> & { readonly element: object } : T

/** Each {@link StageEvent}'s info. */
export type StageEvents = { readonly [E in StageEvent]: OnSubject<WardEvents[E]> }

/**
 * A ward on a Stage's Subject: its events and values, as a ward on an element has them, and `held`,
 * which renders nothing and joins its component's `<Loading>` while its Subject or config is still
 * loading. Return it from a component that renders nothing else.
 */
// `C` unbounded: `ward<C>` for a page's `C extends WardConfig` instantiates the Stage's overload too.
export interface StageWard<C = StageWardConfig> {
  /** Renders nothing; reads the ward's pending Subject and config, so its component's `<Loading>` and `<Reveal>` wait for them. */
  readonly held: JSX.Element
  /** Its last landing, as a ward's `settled`: pending while a change runs. */
  readonly settled: Accessor<WardSettled | undefined>
  /** Its last tap, as a ward's `tapped`: pending while a press is down. */
  readonly tapped: Accessor<StageEvents["tap"] | undefined>
  /** The next `name`, as a ward's `next`. */
  readonly next: <E extends StageEvent>(name: E) => Promise<StageEvents[E]>
  /** Every `name` from now on, as a ward's `each`. */
  readonly each: <E extends StageEvent>(name: E) => AsyncIterable<StageEvents[E]>
  /** Every `name`, as a memo for an effect, as a ward's `when`. */
  readonly when: <E extends StageEvent>(name: E) => Accessor<StageEvents[E]>
  /** Its Subject's value for `key`, as a ward's `read`. */
  readonly read: WardRead<C>
  /** The same as an `effect/reactivity` Atom, as a ward's `atom`. */
  readonly atom: (key: string) => Atom.Atom<unknown>
}

/** An event a Scene object tells beside its ward's: its exit's start, and its landing, once the Subject has left. */
export type SceneObjectEvent = StageEvent | "exitStart" | "exitComplete"

/** A Scene object's exit: the Subject leaving, as `element`, as a Stage ward's events carry it. */
export interface SceneObjectExit {
  readonly element: object
}

/** Each {@link SceneObjectEvent}'s info. */
export type SceneObjectEvents = StageEvents & { readonly exitStart: SceneObjectExit; readonly exitComplete: SceneObjectExit }

/**
 * A Scene object's handle (ADR-0073 decision 15): its ward, with its membership's events, `exitStart` and
 * `exitComplete`, which only this handle has. `next("exitComplete")` resolves after its owner has ended.
 */
export interface SceneWard<C = StageWardConfig> extends Omit<StageWard<C>, "next" | "each" | "when"> {
  /** The next `name`: a ward's event, or its exit's. */
  readonly next: <E extends SceneObjectEvent>(name: E) => Promise<SceneObjectEvents[E]>
  /** Every `name` from now on. */
  readonly each: <E extends SceneObjectEvent>(name: E) => AsyncIterable<SceneObjectEvents[E]>
  /** Every `name`, as a memo for an effect. */
  readonly when: <E extends SceneObjectEvent>(name: E) => Accessor<SceneObjectEvents[E]>
}

/** What runs a scene for its owner, as the shared hooks read it: its Subjects, its ward, `animate`, its Frame effects and its input. */
export interface Stage {
  /** Whether `value` is one of its Environment's Subjects: a three.js object, by its `is*` flags. */
  readonly isSubject: (value: unknown) => boolean
  /** A ward on `subject`, one of its Subjects or an accessor of one: what `ward(subject, config)` hands it. */
  readonly ward: (subject: unknown, config: StageWardConfig, options?: WardOptions) => StageWard
  /** Motion's `animate`, on its Subjects. */
  readonly animate: (subject: object, target: Readonly<Record<string, unknown>>, options?: Imperative.WardicAnimateOptions) => Imperative.WardicPlaybackControls
  /** Its Frame effects: run in its Host loop after Wardic's writes, before it renders; `request` asks a loop that draws on demand for a frame. */
  readonly frameEffects: Pick<FrameEffects.FrameEffects, "add" | "request">
  /** Its pointer input, for a sensor given one of its Subjects. */
  readonly input: InputSource.InputSource["Service"]
  /** What it drags its Subjects with: a ward's `drag` with none is an error in development. */
  readonly drag?: StageDrag | undefined
  /** What makes its Batches (#885's PR 5): `createBatch` with `object` or `instances` with none is an error in development. */
  readonly batch?: ((config: StageKeyedBatchConfig<unknown> | StageCountBatchConfig, hooks: StageBatchHooks) => StageBatchBinding) | undefined
}

/**
 * The Stage the hooks under it use: Solid 2's own provider, `<WardicStage value={stage}>`, and
 * `useContext(WardicStage)` to read it. `null` outside one.
 */
// Solid 2 reads a context made with no default as an error outside its provider: `null` is "none".
export const WardicStage: Context<Stage | null> = /*#__PURE__*/ createContext<Stage | null>(null)
