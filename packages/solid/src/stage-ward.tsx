/**
 * A ward on a Stage's Subject: what `ward(mesh, config)` makes under a `<WardicStage>`, a Stage's own
 * `ward`. `stageWard(environment)` binds one to a Stage's Environment, for the Stage to hand out.
 *
 * It moves its Subject as a ward moves an element: `initial`, `animate` (an async one held with
 * `held`), `transition`, its own `variants`, `whileHover` and `whileTap` through the Stage's input, its
 * events, `read` and `atom`. Given an accessor, it follows each Subject it gives: a new one takes the
 * ward over, starting as the ward did, with no exit.
 *
 * A Stage over `@wardic/object`'s runtime gives it the runtime's `stageEnvironment` and its scene's input:
 * `stageWard({ ...runtime.stageEnvironment, input })`.
 *
 * `stageSceneObject(environment)` makes the same ward with a **membership** (#885, ADR-0073 decisions 10,
 * 14 and 15): an Environment's `createSceneObject` gives it what joins its Subject to the scene and what
 * takes it out. It joins once the ward can start, and leaves once its `exit` lands, run on its own spine
 * past its owner, as it ends or as an accessor gives another Subject, or none.
 *
 * @module
 */
// #884's PR 4 (ADR-0073 decisions 8, 10 and 20; *Amendment (#884)*, Q2, Q3 and Q5): a second, smaller ward
// on core's spine and the DOM ward's config view, variant node and lifecycle. The DOM's own parts (its
// Starting style, server render, hydration, layout, drag, presence, `style`'s Live values) stay `wardWith`'s.
import type { JSX } from "@solidjs/web"
import * as BaseValue from "@wardic/core/BaseValue"
import * as InputSource from "@wardic/core/InputSource"
import * as Recognizer from "@wardic/core/Recognizer"
import * as AnimationControls from "@wardic/core/unstable/AnimationControls"
import type * as Config from "@wardic/core/unstable/Config"
import * as Imperative from "@wardic/core/unstable/Imperative"
import type * as OwnValues from "@wardic/core/unstable/OwnValues"
import * as Report from "@wardic/core/unstable/Report"
import * as Spine from "@wardic/core/unstable/Spine"
import * as VariantTree from "@wardic/core/unstable/VariantTree"
import * as OwnerScope from "@wardic/dom/unstable/OwnerScope"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import type * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import { constUndefined, constVoid, identity } from "effect/Function"
import * as Predicate from "effect/Predicate"
import * as Option from "effect/Option"
import * as Atom from "effect/reactivity/Atom"
import * as Rec from "effect/Record"
import * as Scope from "effect/Scope"
import * as UndefinedOr from "effect/UndefinedOr"
import { type Accessor, createEffect, createMemo, createSignal, DEV, getOwner, onCleanup, runWithOwner, untrack } from "solid-js"
import { followAtom } from "./bridge.tsx"
import { Lifecycle, type WardElement } from "./lifecycle.ts"
import { CLIENT_ONLY, CLIENT_ONLY_SYNC, CLIENT_ONLY_SYNC_DEFERRED } from "./solid-reactivity.ts"
import type { SceneObjectEvents, SceneWard, Stage, StageDrag, StageDragConfig, StageWard, StageWardConfig } from "./stage.ts"
import { GraphParent, provide, type StageGraph } from "./stage-graph.ts"
import { createVariantNode } from "./variant-node.ts"
import { configAtSetup, configuredView, gateOf, sameTarget, STARTS_AT_PENDING, WARD_VIEW, type WardConfigValues } from "./ward.tsx"
import { eachOf, Waiters, whenOf } from "./waiters.ts"
import { useWardicConfig } from "./wardic-config.tsx"

/**
 * What a Stage ward runs on: what `animate` runs on (its runtime, gate, Subjects' values, Positional keys,
 * Default transitions, reduced motion and `skipAnimations`), where a Subject starts, and the scene's
 * pointer input. `@wardic/object`'s `stageEnvironment`, with the Stage's input, is one.
 */
export interface StageWardEnvironment extends Imperative.AnimateEnv {
  /** Where each key of a Subject starts: its Environment's Base-value links. */
  readonly startLinksOf: (subject: object) => Spine.StartLinks
  /** The scene's pointer input, which its hovers and presses are heard through. */
  readonly input: InputSource.InputSource["Service"]
  /**
   * The scene's graph, which variants pass down (#885, decision 17): a Variant child follows the nearest
   * ward above its Subject. None: each ward has only its own variants.
   */
  readonly graph?: StageGraph | undefined
  /** What drags its Subjects (#885's PR 4): a `drag` with none is an error in development. */
  readonly drag?: StageDrag | undefined
}

/**
 * A Scene object's membership of its scene (#885; ADR-0073 decisions 10 and 14): what an Environment's
 * `createSceneObject` gives `stageSceneObject`'s ward.
 */
export interface StageMembership {
  /** Its Subject joins the scene: the ward can start, its `initial` written for the next frame drawn. */
  readonly join: (subject: object) => void
  /** Its Subject leaves the scene: its exit has landed, or it had none. */
  readonly leave: (subject: object) => void
  /** The parent its Subject will join, before it has: where a Variant child looks for the ward it follows, at its setup. */
  readonly parentOf?: ((subject: object) => object | undefined) | undefined
  /**
   * An exit in flight: `land` ends it now, the Subject taken out, as the Stage ends before it lands
   * (*Amendment (#885)* Q5). The call returned says it has landed.
   */
  readonly exiting: (land: () => void) => () => void
}

/** The keys a ward on a Stage's Subject takes: any other is the page's, or a Scene object's (decision 5). */
const STAGE_KEYS: ReadonlySet<string> = new Set([
  "initial",
  "animate",
  "transition",
  "variants",
  "whileHover",
  "whileTap",
  "custom",
  "inherit",
  // A scene's drag (#885's PR 4): its Stage's `drag` reads them.
  "whileDrag",
  "drag",
  "dragPlane",
  "dragConstraints",
  "dragElastic",
  "dragMomentum",
  "dragTransition",
  "dragSnapToOrigin",
])

/** A scene's drag keys, read from its config as given, at each gesture's start. */
const DRAG_KEYS = ["drag", "dragPlane", "dragConstraints", "dragElastic", "dragMomentum", "dragTransition", "dragSnapToOrigin"] as const

/** A `drag` on a Stage with nothing to drag with. */
const NO_DRAG =
  "ward(subject, { drag }): the Stage above it drags nothing, as it has no `drag`. With `@wardic/three/solid`, give `createStage` the feature: `createStage({ …, features: [stageDrag] })`."

/** `config`'s drag keys now, each an accessor's value as it's read. */
const dragConfigOf = (config: StageWardConfig): StageDragConfig => {
  const given = config as Readonly<Record<string, unknown>>
  const out: Record<string, unknown> = {}
  Arr.forEach(DRAG_KEYS, (key) => {
    const value = given[key]
    out[key] = Bool.match(Predicate.isFunction(value), { onTrue: () => (value as () => unknown)(), onFalse: () => value })
  })
  return out as StageDragConfig
}

/** A Scene object's own key: its ward's, plus its `exit`. */
const SCENE_KEYS: ReadonlySet<string> = new Set([...STAGE_KEYS, "exit"])

/** A key of the page's alone: a scene has no focus or viewport. */
const PAGE_ONLY: ReadonlySet<string> = new Set(["whileFocus", "whileInView", "viewport"])

/** Animation controls given as its `animate`, which a ward on a Stage's Subject doesn't follow. */
const NO_CONTROLS = "ward(subject, config): a ward on a Stage's Subject doesn't follow Animation controls. Give its `animate` a target, or call the Stage's `animate`."

/** In development: a key a ward on a Stage's Subject doesn't take, named; `exit` is a Scene object's. */
const checkKeys = (config: StageWardConfig, scene: boolean): void =>
  Arr.forEach(Rec.keys(config as Readonly<Record<string, unknown>>), (key) => {
    if (Bool.match(scene, { onTrue: () => SCENE_KEYS.has(key), onFalse: () => STAGE_KEYS.has(key) })) return
    if (PAGE_ONLY.has(key)) throw new Error(`ward(subject, config): \`${key}\` is the page's: a scene has no focus or viewport. Give it to a ward on an element.`)
    if (key === "exit") throw new Error("ward(subject, config): `exit` is a Scene object's: `createSceneObject(mesh, { exit })` plays it as the object leaves the scene.")
    throw new Error(
      `ward(subject, config): a ward on a Stage's Subject takes initial, animate, transition, variants, whileHover, whileTap, whileDrag, custom and the drag keys; \`${key}\` is a ward on an element's.`,
    )
  })

/** No gesture on: what a Scene object's exit resolves with. */
const NOTHING_ACTIVE: Spine.Active = { inView: false, focused: false, hovered: false, pressed: false, dragged: false, dragging: false }

/** A Scene object's own events: its exit's. */
type ExitEvents = Pick<SceneObjectEvents, "exitStart" | "exitComplete">

/** What a Scene object's exit waits reject with once it's gone and its last exit has landed. */
const EXITS_GONE = "The Scene object was gone before its next exit."

/** Whether `name` is a Scene object's exit event, its own waits', not its ward's. */
const isExitEvent = (name: string): name is "exitStart" | "exitComplete" => Bool.or(name === "exitStart", name === "exitComplete")

/** Its hover, press and drag, on the Subject they were heard on: a state recorded on another reads as none. */
interface Gestures {
  readonly subject: object | undefined
  readonly hovered: boolean
  readonly pressed: boolean
  readonly dragged: boolean
}
const NO_GESTURES: Gestures = { subject: undefined, hovered: false, pressed: false, dragged: false }

/** The Subject it's on: its spine, its gate registration, and which of its recognizers run. */
interface Mounted {
  readonly subject: object
  readonly spine: Spine.ElementSpine
  /** Its spine's record of what it drew: a Scene object's own each Subject, as the last exits beside the next. */
  readonly snapshot: Spine.Snapshot
  hover: boolean
  press: boolean
  drag: boolean
  /** A Scene object's exit starts: `land` lands it once its spine settles, a failed exit too; none, it's taken back. */
  readonly exitWith: (land: (() => void) | undefined) => void
  readonly watch: (watch: Effect.Effect<void, never, Scope.Scope | InputSource.InputSource>) => void
  /** Its recognizers stop, and the Stage's `animate` no longer goes through it: an exit's start. */
  readonly quiet: () => void
  /** What `quiet` stopped goes again: a Scene object's Subject taken back while it exits. */
  readonly wake: () => void
  readonly dispose: () => void
}

/**
 * `links` with each key's own value read once, before the ward first moves it: what a key a gesture moved
 * returns to once no entry sets it (ADR-0022's Own value), as Motion's base value is. An object's
 * property read again is where the ward left it, so a hover would have nothing to return to.
 */
const baseHeld = (links: Spine.StartLinks, ownValues: OwnValues.Shape): Spine.StartLinks => {
  const first = new Map<string, Option.Option<number | string>>()
  const ownValue = (key: string): Option.Option<number | string> => {
    const known = first.get(key)
    if (Predicate.isNotUndefined(known)) return known
    const read = links.ownValue(key)
    first.set(key, read)
    return read
  }
  const linksFor = (like: number | string): ReturnType<Spine.StartLinks["linksFor"]> => ({
    style: links.linksFor(like).style,
    own: (key) => Option.flatMap(ownValue(key), (raw) => ownValues.valueLike(raw, like)),
  })
  return { ownValue, linksFor, startLinkOf: (key, like) => BaseValue.start(key, linksFor(like)) }
}

/**
 * A Subject's own value for `key` now, as its Environment reads where a key starts (#939): none for a key
 * with no value of its own to start from, which the Environment's reading refuses with an error.
 */
const ownValueOf: (links: Spine.StartLinks, key: string) => Option.Option<Option.Option<number | string>> = /*#__PURE__*/ Option.liftThrowable(
  (links: Spine.StartLinks, key: string) => links.ownValue(key),
)

/** The Stage wards' gate ids, counted: unique across every gate. */
// Module state (#460, Q7): an id counter. Not `createUniqueId`, so a scene leaves the page's hydration keys alone.
let stageIds = 0

/** A Subject as the lifecycle's events carry it: its `element`, typed as the page's (`StageEvents` says otherwise). */
const asElement = (subject: object): WardElement => subject as WardElement

/** `given`, a Subject or an accessor of one, as an accessor. */
const subjectAccessorOf = (given: unknown): Accessor<object | undefined> => {
  if (Predicate.isFunction(given)) return given as Accessor<object | undefined>
  return () => given as object
}

/** A mount's own gate id, its spine's snapshot, and its transitions' reuse. */
interface Own {
  readonly id: string
  readonly snapshot: Spine.Snapshot
  readonly reuse: ReturnType<typeof Spine.makeReuse>
}

/** What a Scene object's side reads of the ward it's part of: its exit resolves on them. */
interface WardParts {
  readonly id: string
  readonly cfg: () => WardConfigValues
  readonly inherited: VariantTree.WardicVariantContextValue | undefined
  readonly start: Spine.Start
  readonly lifecycle: Lifecycle
  readonly gate: StageWardEnvironment["gate"]
  readonly registry: ReturnType<typeof Spine.registryOf>
  readonly runtime: StageWardEnvironment["runtime"]
}

/**
 * A Scene object's own part of its ward (#885): made only by {@link stageSceneObject}, so a Stage ward
 * that isn't one carries none of it.
 */
interface SceneSide {
  /** A mount's own gate id, snapshot and reuse: the last Subject may still be exiting beside the next. */
  readonly own: (begun: Spine.Start) => Own
  /** Its spine's hooks: the ward's lifecycle while it's on its Subject, its exit's landing once it's leaving. */
  readonly hooks: (landingOf: () => (() => void) | undefined) => Spine.AnimationHooks
  /** Its Subject has joined the scene, on gate id `id`. */
  readonly joined: (subject: object, id: string) => void
  /** `m` leaves, through its exit. */
  readonly leave: (m: Mounted) => void
  /**
   * `subject`'s mount, taken back while its exit is in flight: its exit stops where it is, and it stays in
   * the scene. None when it isn't exiting.
   */
  readonly reclaim: (subject: object) => Mounted | undefined
  /** Its owner has ended: its exit waits end once its last exit has landed. */
  readonly ended: () => void
  /** Its value for `key`, on the Subject it's on now. */
  readonly atom: (key: string) => Atom.Atom<unknown>
  /** Its exit events' waits, which outlive its owner until its last exit lands. */
  readonly exits: Waiters<ExitEvents>
}

/**
 * A Scene object's side of its ward, joining and leaving through `membership` (Q5, Q6). Each Subject
 * mounts on a gate id of its own, as one exits beside the next: the last mounted is the one `read` and
 * `atom` follow.
 */
const sceneSideOf = (parts: WardParts, membership: StageMembership): SceneSide => {
  const { id, cfg, lifecycle, gate, registry } = parts
  const exitFailed = Spine.exitVariantFailedOn(parts.runtime)
  let mounts = 0
  // Kept alive: it's set before anything reads it, and a registry drops an Atom no one holds.
  const currentId = Atom.keepAlive(Atom.make(id))
  const exits = new Waiters<ExitEvents>(EXITS_GONE)
  let leaving = 0
  let gone = false
  const endExits = (): void => {
    if (Bool.and(gone, leaving === 0)) exits.dispose()
  }
  // Each Subject whose exit is in flight, with what stops it there: given again, it's taken back.
  const inFlight = new Map<object, { readonly m: Mounted; readonly id: string; readonly stop: () => void }>()
  // Each Subject's gate id, as it joined.
  const ids = new WeakMap<object, string>()

  /** Its `exit`, as a Retarget's target on `m`'s spine: none when it has no `exit`. */
  const exitOf = (m: Mounted): Spine.Resolution | undefined =>
    untrack(() => {
      const values = cfg()
      const exit = values.exit
      if (Predicate.isUndefined(exit)) return undefined
      const exitConfig = { animate: exit, variants: values.variants, custom: values.custom, transition: values.transition } as Config.SpineConfig
      const resolution = Spine.resolutionOf(exitConfig, parts.inherited, parts.start.initialLink, NOTHING_ACTIVE, m.snapshot)
      // An exit whose resolver throws: reported each time, and it leaves without it (#979).
      return Option.match(Spine.failureOf(resolution), {
        onNone: () => resolution,
        onSome: (failure) => {
          exitFailed(failure)
          return undefined
        },
      })
    })

  /**
   * `m` leaves (Q5, a): its gestures stop, its `exit` runs on its own spine from where it is, at the
   * speed it has, past its owner, then its Subject leaves the scene. The Stage's end lands it at once.
   */
  const leave = (m: Mounted): void => {
    m.quiet()
    leaving++
    exits.tell("exitStart", () => ({ element: m.subject }))
    let landed = false
    let untracked: () => void = constVoid
    const land = (): void => {
      if (landed) return
      landed = true
      inFlight.delete(m.subject)
      untracked()
      m.dispose()
      membership.leave(m.subject)
      exits.tell("exitComplete", () => ({ element: m.subject }))
      leaving--
      endExits()
    }
    const exit = exitOf(m)
    if (Predicate.isUndefined(exit)) return land()
    m.exitWith(land)
    untracked = membership.exiting(land)
    inFlight.set(m.subject, {
      m,
      id: ids.get(m.subject) as string,
      stop: () => {
        landed = true
        untracked()
        leaving--
      },
    })
    untrack(() => m.spine.retarget(exit))
  }

  // Taken back: its exit stops, and the ward's next Retarget runs from where the exit left it.
  const reclaim = (subject: object): Mounted | undefined =>
    UndefinedOr.map(inFlight.get(subject), (known) => {
      inFlight.delete(subject)
      known.stop()
      known.m.exitWith(undefined)
      known.m.wake()
      registry().set(currentId, known.id)
      return known.m
    })

  return {
    own: (begun) => {
      mounts++
      return { id: `${id}.${mounts}`, snapshot: Spine.snapshotOf(begun), reuse: Spine.makeReuse() }
    },
    // The ward's lifecycle while it's on its Subject; once it's leaving, its exit's landing, a failed one
    // too (the spine reports the failure).
    hooks: (landingOf) => ({
      started: (resolution) => {
        if (Predicate.isUndefined(landingOf())) lifecycle.started(resolution)
      },
      settled: (resolution, previous) =>
        UndefinedOr.match(landingOf(), {
          onUndefined: () => lifecycle.settled(resolution, previous),
          onDefined: (land) => land(),
        }),
      failed: (resolution, error) =>
        UndefinedOr.match(landingOf(), {
          onUndefined: () => lifecycle.failed(resolution, error),
          onDefined: (land) => land(),
        }),
    }),
    joined: (subject, mountId) => {
      ids.set(subject, mountId)
      registry().set(currentId, mountId)
      // It joins its scene now, the ward able to start: its `initial` is the frame's to write.
      membership.join(subject)
    },
    leave,
    reclaim,
    ended: () => {
      gone = true
      endExits()
    },
    atom: (key) => Atom.make((get) => get(gate.valueOf(get(currentId), key))),
    exits,
  }
}

/**
 * A ward on `given` on `environment`: a Stage's, or, with `sideOf`, a Scene object's, which joins its
 * Subject once it can start and plays its `exit` before its Subject leaves.
 */
const wardOn = (
  environment: StageWardEnvironment,
  given: unknown,
  config: StageWardConfig,
  sideOf: ((parts: WardParts) => SceneSide) | undefined,
  joinsUnder: ((subject: object) => object | undefined) | undefined,
): SceneWard => {
    const scene = Predicate.isNotUndefined(sideOf)
    if (DEV) checkKeys(config, scene)
    const { runtime, gate } = environment
    const owner = getOwner()
    const registry = Spine.registryOf(runtime)
    const id = `wardic-stage-${stageIds++}`
    const subjectOf = subjectAccessorOf(given)
    // Its config per key (#259), as a ward's: a `WardicConfig`'s transition its own when it gives none (#434).
    const view = configuredView(WARD_VIEW.of(config, undefined), useWardicConfig())
    const cfg = (): WardConfigValues => view
    const setup = WARD_VIEW.setupOf(view)
    if (DEV && Predicate.isNotUndefined(AnimationControls.controlsOf(setup.config.animate))) throw new Error(NO_CONTROLS)
    const initialConfig = configAtSetup(setup)
    // Variants down a scene's graph (decision 17): a Variant child follows the nearest ward above its
    // Subject. A value Subject finds it now, from the parent it will join, so it registers for its stagger
    // slot before any Retarget reads one, as a ward on the page registers in its component's body.
    const graph = environment.graph
    const follower = UndefinedOr.match(graph, {
      onUndefined: (): GraphParent | undefined => undefined,
      onDefined: (on) => Bool.match(VariantTree.isVariantChild(initialConfig), { onTrue: (): GraphParent | undefined => new GraphParent(on, joinsUnder), onFalse: constUndefined }),
    })
    const node = createVariantNode(cfg, initialConfig, follower)
    UndefinedOr.map(follower, (f) => {
      if (Bool.not(Predicate.isFunction(given))) f.early(given as object)
    })
    // A ward with variants of its own provides them to the wards below its Subject, a value's from now.
    const provides = Bool.and(Predicate.isNotUndefined(graph), VariantTree.hasOwnVariants(initialConfig))
    let providing: { readonly subject: object; readonly stop: () => void } | undefined
    const stopProviding = (): void => {
      UndefinedOr.map(providing, (p) => p.stop())
      providing = undefined
    }
    const provideOn = (subject: object): void => {
      if (Bool.not(provides)) return
      if (UndefinedOr.match(providing, { onUndefined: () => false, onDefined: (p) => p.subject === subject })) return
      stopProviding()
      providing = { subject, stop: provide(graph as StageGraph, subject, node.provided as VariantTree.WardicVariantContextValue) }
    }
    if (Bool.not(Predicate.isFunction(given))) provideOn(given as object)
    if (Bool.and(Arr.contains(setup.pending, "animate"), initialConfig.initial === false)) throw new Error(STARTS_AT_PENDING)
    const start = Spine.startOf(initialConfig, node.inherited, false, untrack)
    // A variant whose resolver throws is this Subject's alone: reported once until it resolves, keeping
    // its last target (#979; ADR-0074).
    const variantFailed = Spine.variantFailedOn(runtime)
    const kept = Spine.keptResolutions(variantFailed)
    Spine.reportStart(start, variantFailed)
    const snapshot = Spine.snapshotOf(start)
    const reuse = Spine.makeReuse()
    // Where its Subject starts: the ward's start, or a fresh one for the next Subject an accessor gives.
    // A Scene object's next Subject gets a snapshot of its own, since the last may still be exiting.
    let begun = start
    const beginFresh = (): void => {
      begun = Spine.startOf(WARD_VIEW.setupOf(view).config, node.inherited, false, untrack)
      Spine.reportStart(begun, variantFailed)
      if (scene) return
      snapshot.values = { ...begun.initialValues }
      snapshot.velocities = {}
      snapshot.drawnAt = {}
    }

    const [gestureState, setGestureState] = createSignal<Gestures>(NO_GESTURES)
    const setGesture = (subject: object, layer: "hovered" | "pressed" | "dragged", on: boolean): void => {
      setGestureState((g) => {
        if (g.subject !== subject) return Bool.match(on, { onTrue: (): Gestures => ({ ...NO_GESTURES, subject, [layer]: true }), onFalse: () => g })
        if (g[layer] === on) return g
        return { ...g, [layer]: on }
      })
    }
    const gestures = (): Gestures => {
      const g = gestureState()
      if (g === NO_GESTURES) return g
      if (g.subject === subjectOf()) return g
      return NO_GESTURES
    }
    const wantsHover = (): boolean => Predicate.isNotUndefined(cfg().whileHover)
    const wantsPress = (): boolean => Predicate.isNotUndefined(cfg().whileTap)
    const wantsDrag = (): boolean => {
      const drag = cfg().drag
      return Bool.and(Predicate.isNotUndefined(drag), drag !== false)
    }
    if (DEV && Bool.and(Predicate.isUndefined(environment.drag), untrack(wantsDrag))) throw new Error(NO_DRAG)

    const target = createMemo<Spine.Resolution>(
      () => {
        const g = gestures()
        // `dragging` stays off: a scene's drag holds its keys as the Stage's `animate` does (#433), `z` among them.
        return kept(Spine.resolutionOf(cfg(), node.inherited, start.initialLink, { inView: false, focused: false, hovered: g.hovered, pressed: g.pressed, dragged: g.dragged, dragging: false }, snapshot, undefined))
      },
      { equals: sameTarget, transparent: true },
    )

    let mounted: Mounted | undefined
    const lifecycle = new Lifecycle(owner, () => {
      UndefinedOr.map(mounted, startRecognizers)
    })
    const side = UndefinedOr.map(sideOf, (of) => of({ id, cfg, inherited: node.inherited, start, lifecycle, gate, registry, runtime }))
    /** A handler's throw, reported as a fiber's failure is (ADR-0030, decision 4); the watch goes on. */
    const onDefect = (cause: Cause.Cause<never>): void => {
      runtime.runFork(Report.failure("wardic.ward: a gesture handler failed", cause))
    }
    /** Its hover and press recognizers, each once a Subject, as its config or a `next` wants them. */
    const startRecognizers = (m: Mounted): void => {
      if (Bool.and(Bool.or(untrack(wantsHover), lifecycle.wantsHover), Bool.not(m.hover))) {
        m.hover = true
        m.watch(
          Recognizer.watchHover(m.subject, {
            on: (edge) => {
              setGesture(m.subject, "hovered", edge.active)
              lifecycle.hovered(edge, asElement(m.subject))
            },
            onMove: (event) => lifecycle.hoverMoved(event, asElement(m.subject)),
            onDefect,
          }),
        )
      }
      if (Bool.and(Bool.or(untrack(wantsPress), lifecycle.wantsPress), Bool.not(m.press))) {
        m.press = true
        m.watch(
          Recognizer.watchPress(
            m.subject,
            {
              on: (press) => {
                setGesture(m.subject, "pressed", press.phase === "start")
                lifecycle.pressed(press, asElement(m.subject))
              },
              onDefect,
            },
            // A scene's object takes no keys: it has no focus.
            { keys: false },
          ),
        )
      }
      // Its drag, its Stage's (#885's PR 4): each sample told as a ward's, `whileDrag` on from its start to its end.
      if (Bool.and(untrack(wantsDrag), Bool.not(m.drag))) {
        UndefinedOr.map(environment.drag, (drags) => {
          m.drag = true
          m.watch(
            drags.watch(m.subject, () => untrack(() => dragConfigOf(config)), {
              sample: (sample) => {
                if (sample.phase === "start") setGesture(m.subject, "dragged", true)
                lifecycle.dragged(sample, false, asElement(m.subject))
                if (sample.phase === "end") setGesture(m.subject, "dragged", false)
              },
              released: () => lifecycle.released(),
              onDefect,
            }),
          )
        })
      }
    }

    const mount = (subject: object): Mounted => {
      const own = UndefinedOr.match(side, { onUndefined: (): Own => ({ id, snapshot, reuse }), onDefined: (s) => s.own(begun) })
      const mountId = own.id
      const unregister = gate.register(mountId, { target: subject })
      // Its `initial`, written before its first frame is drawn (ADR-0070 decision 5).
      if (Bool.not(Rec.isEmptyRecord(begun.initialValues))) gate.write(mountId, begun.initialValues)
      let exiting: (() => void) | undefined
      const spine = Spine.makeElementSpine({
        runtime,
        gate,
        id: mountId,
        element: subject,
        tag: undefined,
        config: cfg,
        parent: node.inherited,
        canStart: node.canStart,
        extraDelay: node.extraDelay,
        byName: node.names,
        onFrame: node.onFrame,
        reducedMotion: environment.reducedMotion,
        skipAnimations: environment.skipAnimations,
        positionalKeys: environment.positionalKeys,
        defaultTransition: environment.defaultTransition,
        ownValues: environment.ownValues,
        measuredPairs: environment.measuredPairs,
        variableValues: environment.variableValues,
        start: begun,
        snapshot: own.snapshot,
        reuse: own.reuse,
        links: baseHeld(environment.startLinksOf(subject), environment.ownValues),
        styleNow: undefined,
        live: undefined,
        presence: undefined,
        projected: false,
        dragAxis: undefined,
        handoff: undefined,
        animation: UndefinedOr.match(side, { onUndefined: (): Spine.AnimationHooks => lifecycle, onDefined: (s) => s.hooks(() => exiting) }),
      })
      // The Stage's `animate` on its Subject goes through its spine while it's on it (#433).
      let unregisterAnimatable: () => void = Imperative.registerAnimatable(subject, spine)
      // Its recognizers' Scope, made at the first: a ward with no gesture makes none.
      let watchScope: Scope.Closeable | undefined
      const watch = (made: Effect.Effect<void, never, Scope.Scope | InputSource.InputSource>): void => {
        if (Predicate.isUndefined(watchScope)) watchScope = OwnerScope.open(runtime)
        runtime.runSync(made.pipe(Effect.provideService(InputSource.InputSource, environment.input), Scope.provide(watchScope)))
      }
      const quiet = (): void => {
        unregisterAnimatable()
        unregisterAnimatable = constVoid
        UndefinedOr.map(watchScope, (scope) => OwnerScope.close(runtime, scope, "wardic.ward: a finalizer failed"))
        watchScope = undefined
      }
      const m: Mounted = {
        subject,
        spine,
        snapshot: own.snapshot,
        hover: false,
        press: false,
        drag: false,
        exitWith: (land) => {
          exiting = land
        },
        watch,
        quiet,
        wake: () => {
          unregisterAnimatable = Imperative.registerAnimatable(subject, spine)
          m.hover = false
          m.press = false
          m.drag = false
        },
        dispose: () => {
          quiet()
          spine.dispose()
          unregister()
        },
      }
      startRecognizers(m)
      UndefinedOr.map(side, (s) => s.joined(subject, mountId))
      return m
    }

    /** Off its Subject: a Stage ward's ends now, a Scene object's leaves through its exit. */
    const off = (): void => {
      const m = mounted
      mounted = undefined
      if (Predicate.isUndefined(m)) return
      UndefinedOr.match(side, {
        onUndefined: () => m.dispose(),
        onDefined: (s) => s.leave(m),
      })
    }
    onCleanup(() => {
      off()
      lifecycle.dispose()
      UndefinedOr.map(side, (s) => s.ended())
      UndefinedOr.map(follower, (f) => f.release())
      stopProviding()
    })

    // A `whileHover` or `whileTap` set later starts its recognizer then (#87).
    createEffect(
      () => Bool.some([wantsHover(), wantsPress(), wantsDrag()]),
      () => {
        UndefinedOr.map(mounted, startRecognizers)
      },
      CLIENT_ONLY_SYNC_DEFERRED,
    )

    // Its keys still loading at setup, and its Subject, read where `held` renders: its component's
    // `<Loading>` holds until they land, as a ward's style does (#257 item 1).
    const loaded = Bool.match(setup.pending.length === 0, {
      onTrue: () => constVoid,
      onFalse: () => {
        const config = cfg() as unknown as Readonly<Record<string, unknown>>
        const memo = createMemo((): true => {
          Arr.forEach(setup.pending, (key) => void config[key])
          target()
          return true
        }, CLIENT_ONLY)
        return (): void => {
          memo()
        }
      },
    })

    // Mount on its Subject, then Retarget on each change of its target or its `when` gate; a new Subject
    // takes the ward over, starting as the ward did, and the last keeps what it shows (decision 10).
    // A Scene object joins once every key still loading at setup has landed, not only its target's
    // (*Amendment (#881)*, item 2): read in the compute, so the effect waits for them.
    const open = gateOf(node)
    let mountedOnce = false
    createEffect(
      () => {
        const subject = subjectOf()
        if (Predicate.isUndefined(subject)) return undefined
        if (scene) loaded()
        return { subject, resolution: target(), open: open() }
      },
      (mounting) => {
        if (Predicate.isUndefined(mounting)) {
          off()
          return
        }
        const { subject, resolution } = mounting
        if (Predicate.isUndefined(mounted) || mounted.subject !== subject) {
          // A Stage ward's next Subject starts as the ward did; a Scene object's each enters afresh.
          const fresh = Bool.match(scene, { onTrue: () => mountedOnce, onFalse: () => Predicate.isNotUndefined(mounted) })
          off()
          // On the graph: it follows the ward above this Subject, and provides for the ones below it. A
          // follower starts from the `initial` that ward hands down.
          UndefinedOr.map(follower, (f) => f.attach(subject))
          provideOn(subject)
          // A Scene object's Subject still exiting is taken back, from where it is; any other mounts.
          mounted = UndefinedOr.match(
            UndefinedOr.map(side, (s) => s.reclaim(subject)),
            {
              onDefined: (taken) => {
                startRecognizers(taken)
                return taken
              },
              onUndefined: () => {
                if (Bool.or(fresh, Predicate.isNotUndefined(follower))) beginFresh()
                return untrack(() => mount(subject))
              },
            },
          )
          mountedOnce = true
        }
        const spine = mounted.spine
        untrack(() => spine.retarget(resolution))
      },
      CLIENT_ONLY_SYNC,
    )

    const held = (() => {
      subjectOf()
      loaded()
      return undefined
    }) as unknown as JSX.Element

    // Its value per key: the gate's output while it holds the key, else its start, else its Subject's own
    // value now (#939), so a key the ward hasn't moved reads what the Subject holds. One accessor a key.
    const reads = new Map<string, Accessor<unknown>>()
    // Its Subject's own values now (#939): one reading of each Subject it's on, for the keys it hasn't moved.
    let reading: { readonly subject: object; readonly links: Spine.StartLinks } | undefined
    const ownNow = (key: string): number | string | undefined =>
      UndefinedOr.match(subjectOf(), {
        onUndefined: constUndefined,
        onDefined: (subject) => {
          if (Predicate.isUndefined(reading) || reading.subject !== subject) reading = { subject, links: environment.startLinksOf(subject) }
          return Option.getOrUndefined(Option.flatten(ownValueOf(reading.links, key)))
        },
      })
    // A Scene object's follows the gate id of the Subject it's on now.
    const atom = (key: string): Atom.Atom<unknown> => UndefinedOr.match(side, { onUndefined: () => gate.valueOf(id, key), onDefined: (s) => s.atom(key) })
    const read = (key: string): Accessor<unknown> => {
      const known = reads.get(key)
      if (Predicate.isNotUndefined(known)) return known
      const output = atom(key)
      const started = Atom.make((get) => UndefinedOr.match(get(output), { onUndefined: () => start.initialValues[key], onDefined: identity }))
      const followed = runWithOwner(owner, () => followAtom(registry(), started))
      const made = (): unknown => UndefinedOr.match(followed(), { onDefined: identity, onUndefined: () => ownNow(key) })
      reads.set(key, made)
      return made
    }

    // A Scene object's exit events are its own waits', which outlive its owner until its last exit lands.
    const exitsFor = (name: string): Waiters<ExitEvents> | undefined => {
      if (Bool.not(isExitEvent(name))) return undefined
      return UndefinedOr.map(side, (s) => s.exits)
    }
    return {
      held,
      settled: () => lifecycle.read(),
      tapped: () => lifecycle.tapped(),
      next: (name) => UndefinedOr.match(exitsFor(name), { onUndefined: () => lifecycle.wait(name as never), onDefined: (exits) => exits.wait(name as "exitStart") }),
      each: (name) =>
        UndefinedOr.match(exitsFor(name), { onUndefined: () => lifecycle.each(name as never), onDefined: (exits) => eachOf<ExitEvents, "exitStart">(exits, name as "exitStart") }),
      when: (name) =>
        UndefinedOr.match(exitsFor(name), { onUndefined: () => lifecycle.when(name as never), onDefined: (exits) => whenOf<ExitEvents, "exitStart">(exits, name as "exitStart") }),
      read: read as SceneWard["read"],
      atom,
    } as SceneWard
  }

/**
 * The `ward` a Stage on `environment` hands out: `ward(subject, config, options?)` under a `<WardicStage>`
 * comes here, in the component that called it.
 */
export const stageWard =
  (environment: StageWardEnvironment): Stage["ward"] =>
  (given, config): StageWard =>
    wardOn(environment, given, config, undefined, undefined) as unknown as StageWard

/**
 * A Scene object's ward on `environment` (#885): `stageWard`'s, joining its Subject through `membership`
 * once it can start and playing its `exit` before its Subject leaves. An Environment's
 * `createSceneObject` calls it, with its scene's own membership.
 */
export const stageSceneObject =
  (environment: StageWardEnvironment) =>
  (given: unknown, config: StageWardConfig, membership: StageMembership): SceneWard =>
    wardOn(environment, given, config, (parts) => sceneSideOf(parts, membership), membership.parentOf)
