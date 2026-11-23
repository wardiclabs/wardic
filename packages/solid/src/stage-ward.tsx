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
import * as Imperative from "@wardic/core/unstable/Imperative"
import type * as OwnValues from "@wardic/core/unstable/OwnValues"
import * as Report from "@wardic/core/unstable/Report"
import * as Spine from "@wardic/core/unstable/Spine"
import * as OwnerScope from "@wardic/dom/unstable/OwnerScope"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import type * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import { constVoid, identity } from "effect/Function"
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
import type { Stage, StageWard } from "./stage.ts"
import { createVariantNode } from "./variant-node.ts"
import { configAtSetup, configuredView, gateOf, sameTarget, STARTS_AT_PENDING, WARD_VIEW, type WardConfig, type WardConfigValues, type WardRead } from "./ward.tsx"
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
}

/** The keys a ward on a Stage's Subject takes: any other is the page's, or a Scene object's (decision 5). */
const STAGE_KEYS: ReadonlySet<string> = new Set(["initial", "animate", "transition", "variants", "whileHover", "whileTap", "custom", "inherit"])

/** A key of the page's alone: a scene has no focus or viewport. */
const PAGE_ONLY: ReadonlySet<string> = new Set(["whileFocus", "whileInView", "viewport"])

/** Animation controls given as its `animate`, which a ward on a Stage's Subject doesn't follow. */
const NO_CONTROLS = "ward(subject, config): a ward on a Stage's Subject doesn't follow Animation controls. Give its `animate` a target, or call the Stage's `animate`."

/** In development: a key a ward on a Stage's Subject doesn't take, named. */
const checkKeys = (config: WardConfig): void =>
  Arr.forEach(Rec.keys(config as Readonly<Record<string, unknown>>), (key) => {
    if (STAGE_KEYS.has(key)) return
    if (PAGE_ONLY.has(key)) throw new Error(`ward(subject, config): \`${key}\` is the page's: a scene has no focus or viewport. Give it to a ward on an element.`)
    throw new Error(`ward(subject, config): a ward on a Stage's Subject takes initial, animate, transition, variants, whileHover, whileTap and custom; \`${key}\` is a ward on an element's.`)
  })

/** Its hover and press, on the Subject they were heard on: a state recorded on another reads as none. */
interface Gestures {
  readonly subject: object | undefined
  readonly hovered: boolean
  readonly pressed: boolean
}
const NO_GESTURES: Gestures = { subject: undefined, hovered: false, pressed: false }

/** The Subject it's on: its spine, its gate registration, and which of its recognizers run. */
interface Mounted {
  readonly subject: object
  readonly spine: Spine.ElementSpine
  hover: boolean
  press: boolean
  readonly watch: (watch: Effect.Effect<void, never, Scope.Scope | InputSource.InputSource>) => void
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

/**
 * The `ward` a Stage on `environment` hands out: `ward(subject, config, options?)` under a `<WardicStage>`
 * comes here, in the component that called it.
 */
export const stageWard =
  (environment: StageWardEnvironment): Stage["ward"] =>
  (given, config): StageWard => {
    if (DEV) checkKeys(config)
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
    // Its own variants (decision 5): a scene's graph handing them down is step 4's.
    const node = createVariantNode(cfg, initialConfig, undefined)
    if (Bool.and(Arr.contains(setup.pending, "animate"), initialConfig.initial === false)) throw new Error(STARTS_AT_PENDING)
    const start = Spine.startOf(initialConfig, node.inherited, false, untrack)
    const snapshot = Spine.snapshotOf(start)
    const reuse = Spine.makeReuse()
    // Where its Subject starts: the ward's start, or a fresh one for the next Subject an accessor gives.
    let begun = start
    const beginFresh = (): void => {
      begun = Spine.startOf(WARD_VIEW.setupOf(view).config, node.inherited, false, untrack)
      snapshot.values = { ...begun.initialValues }
      snapshot.velocities = {}
      snapshot.drawnAt = {}
    }

    const [gestureState, setGestureState] = createSignal<Gestures>(NO_GESTURES)
    const setGesture = (subject: object, layer: "hovered" | "pressed", on: boolean): void => {
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

    const target = createMemo<Spine.Resolution>(
      () => {
        const g = gestures()
        return Spine.resolutionOf(cfg(), node.inherited, start.initialLink, { inView: false, focused: false, hovered: g.hovered, pressed: g.pressed, dragged: false, dragging: false }, snapshot, undefined)
      },
      { equals: sameTarget, transparent: true },
    )

    let mounted: Mounted | undefined
    const lifecycle = new Lifecycle(owner, () => {
      UndefinedOr.map(mounted, startRecognizers)
    })
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
    }

    const mount = (subject: object): Mounted => {
      const unregister = gate.register(id, { target: subject })
      // Its `initial`, written before its first frame is drawn (ADR-0070 decision 5).
      if (Bool.not(Rec.isEmptyRecord(begun.initialValues))) gate.write(id, begun.initialValues)
      const spine = Spine.makeElementSpine({
        runtime,
        gate,
        id,
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
        snapshot,
        reuse,
        links: baseHeld(environment.startLinksOf(subject), environment.ownValues),
        styleNow: undefined,
        live: undefined,
        presence: undefined,
        projected: false,
        dragAxis: undefined,
        handoff: undefined,
        animation: lifecycle,
      })
      // The Stage's `animate` on its Subject goes through its spine while it's on it (#433).
      const unregisterAnimatable = Imperative.registerAnimatable(subject, spine)
      // Its recognizers' Scope, made at the first: a ward with no gesture makes none.
      let watchScope: Scope.Closeable | undefined
      const watch = (made: Effect.Effect<void, never, Scope.Scope | InputSource.InputSource>): void => {
        if (Predicate.isUndefined(watchScope)) watchScope = OwnerScope.open(runtime)
        runtime.runSync(made.pipe(Effect.provideService(InputSource.InputSource, environment.input), Scope.provide(watchScope)))
      }
      const m: Mounted = {
        subject,
        spine,
        hover: false,
        press: false,
        watch,
        dispose: () => {
          unregisterAnimatable()
          spine.dispose()
          UndefinedOr.map(watchScope, (scope) => OwnerScope.close(runtime, scope, "wardic.ward: a finalizer failed"))
          unregister()
        },
      }
      startRecognizers(m)
      return m
    }
    const unmount = (): void => {
      UndefinedOr.map(mounted, (m) => m.dispose())
      mounted = undefined
    }
    onCleanup(() => {
      unmount()
      lifecycle.dispose()
    })

    // A `whileHover` or `whileTap` set later starts its recognizer then (#87).
    createEffect(
      () => Bool.or(wantsHover(), wantsPress()),
      () => {
        UndefinedOr.map(mounted, startRecognizers)
      },
      CLIENT_ONLY_SYNC_DEFERRED,
    )

    // Mount on its Subject, then Retarget on each change of its target or its `when` gate; a new Subject
    // takes the ward over, starting as the ward did, and the last keeps what it shows (decision 10).
    const open = gateOf(node)
    createEffect(
      () => {
        const subject = subjectOf()
        if (Predicate.isUndefined(subject)) return undefined
        return { subject, resolution: target(), open: open() }
      },
      (mounting) => {
        if (Predicate.isUndefined(mounting)) {
          unmount()
          return
        }
        const { subject, resolution } = mounting
        if (Predicate.isUndefined(mounted) || mounted.subject !== subject) {
          const wasOn = Predicate.isNotUndefined(mounted)
          unmount()
          if (wasOn) beginFresh()
          mounted = untrack(() => mount(subject))
        }
        const spine = mounted.spine
        untrack(() => spine.retarget(resolution))
      },
      CLIENT_ONLY_SYNC,
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
    const held = (() => {
      subjectOf()
      loaded()
      return undefined
    }) as unknown as JSX.Element

    // Its value per key: the gate's output while it holds the key, else its start. One accessor a key.
    const reads = new Map<string, Accessor<unknown>>()
    const atom = (key: string): Atom.Atom<unknown> => gate.valueOf(id, key)
    const read = (key: string): Accessor<unknown> => {
      const known = reads.get(key)
      if (Predicate.isNotUndefined(known)) return known
      const output = atom(key)
      const own = Atom.make((get) => UndefinedOr.match(get(output), { onUndefined: () => start.initialValues[key], onDefined: identity }))
      const made = runWithOwner(owner, () => followAtom(registry(), own))
      reads.set(key, made)
      return made
    }

    return {
      held,
      settled: () => lifecycle.read(),
      tapped: () => lifecycle.tapped(),
      next: (name) => lifecycle.wait(name),
      each: (name) => lifecycle.each(name),
      when: (name) => lifecycle.when(name),
      read: read as WardRead<WardConfig>,
      atom,
    } as StageWard
  }
