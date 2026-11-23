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
import type * as InputSource from "@wardic/core/InputSource"
import type * as FrameEffects from "@wardic/core/unstable/FrameEffects"
import type * as Imperative from "@wardic/core/unstable/Imperative"
import { type Accessor, type Context, createContext } from "solid-js"
import type * as Atom from "effect/reactivity/Atom"
import type { WardElement, WardEvents, WardSettled } from "./lifecycle.ts"
import type { WardConfig, WardOptions, WardRead } from "./ward.tsx"

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

/** An event a ward on a Stage's Subject tells: its landings, and its hovers and presses, through the Stage's input. */
export type StageEvent = "settled" | "hoverStart" | "hover" | "hoverEnd" | "pressStart" | "tap" | "tapCancel"

/** An event's info on a Stage's Subject: a ward's, with the Subject as its `element`. */
type OnSubject<T> = T extends { readonly element: WardElement } ? Omit<T, "element"> & { readonly element: object } : T

/** Each {@link StageEvent}'s info. */
export type StageEvents = { readonly [E in StageEvent]: OnSubject<WardEvents[E]> }

/**
 * A ward on a Stage's Subject: its events and values, as a ward on an element has them, and `held`,
 * which renders nothing and joins its component's `<Loading>` while its Subject or config is still
 * loading. Return it from a component that renders nothing else.
 */
export interface StageWard<C extends WardConfig = WardConfig> {
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

/** What runs a scene for its owner, as the shared hooks read it: its Subjects, its ward, `animate`, its Frame effects and its input. */
export interface Stage {
  /** Whether `value` is one of its Environment's Subjects: a three.js object, by its `is*` flags. */
  readonly isSubject: (value: unknown) => boolean
  /** A ward on `subject`, one of its Subjects or an accessor of one: what `ward(subject, config)` hands it. */
  readonly ward: (subject: unknown, config: WardConfig, options?: WardOptions) => StageWard
  /** Motion's `animate`, on its Subjects. */
  readonly animate: (subject: object, target: Readonly<Record<string, unknown>>, options?: Imperative.WardicAnimateOptions) => Imperative.WardicPlaybackControls
  /** Its Frame effects: run in its Host loop after Wardic's writes, before it renders; `request` asks a loop that draws on demand for a frame. */
  readonly frameEffects: Pick<FrameEffects.FrameEffects, "add" | "request">
  /** Its pointer input, for a sensor given one of its Subjects. */
  readonly input: InputSource.InputSource["Service"]
}

/**
 * The Stage the hooks under it use: Solid 2's own provider, `<WardicStage value={stage}>`, and
 * `useContext(WardicStage)` to read it. `null` outside one.
 */
// Solid 2 reads a context made with no default as an error outside its provider: `null` is "none".
export const WardicStage: Context<Stage | null> = /*#__PURE__*/ createContext<Stage | null>(null)
