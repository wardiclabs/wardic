/**
 * **Imperative animation** (#433, CONTEXT.md; Motion's `useAnimate`), Solid-free: an **Animation
 * scope**'s `animate`, the elements it animates, and the **Playback controls** it returns. Both
 * bindings' `createAnimate()` build on it.
 *
 * - **A Wardic element** animates through its own spine, registered here while it's mounted: the
 *   call takes the keys it animates, which stay where it leaves them until the element's own target
 *   for them changes (the spine's `animate`, Motion's latest-wins).
 * - **A plain element** animates through a spine of its own (#433's Q4), with no config, presence or
 *   layout node: it starts from the element's Own value (ADR-0022) and keeps its values for the next
 *   call, velocity included. It's in the gate only while it animates, so the gate keeps nothing of an
 *   element it isn't animating.
 * - **The controls** are Motion's (`AnimationPlaybackControls`): awaitable, with `stop`, `cancel`,
 *   `complete`, `pause`, `play`, `speed`, `time` and `duration`, every element's legs run through
 *   one `Playback.Playhead`. Its `finished` resolves at a landing or `complete()`, never at a `stop()`
 *   or a `cancel()`, as Motion's.
 *
 * @module
 */
import type * as DefaultTransition from "@wardic/core/DefaultTransition"
import * as Playback from "@wardic/core/Playback"
import type * as ReducedMotion from "@wardic/core/ReducedMotion"
import type * as FlushGate from "@wardic/dom/FlushGate"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import { constVoid } from "effect/Function"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as UndefinedOr from "effect/UndefinedOr"
import type { WardicTransition, WardicVariant } from "./config.ts"
import type { WardicRuntime } from "./runtime.ts"
import { type ElementSpine, type ImperativeTrack, makeElementSpine, makeReuse, type Snapshot, startLinksOf } from "./spine.ts"
import { NO_VARIANT_STATE, resolveTarget } from "./variant-target.ts"

/** What an Imperative animation animates an element through: its spine's `animate`. */
type Animatable = Pick<ElementSpine, "animate">

/** Each mounted Wardic element's spine (Motion's `visualElementStore`). */
const wardicElements = new WeakMap<Element, Animatable>()

/**
 * Register a mounted Wardic element's spine for the Imperative animations of it (#433): until the
 * returned function, which its unmount calls.
 */
export const registerAnimatable = (element: Element, spine: Animatable): (() => void) => {
  wardicElements.set(element, spine)
  return () => {
    if (wardicElements.get(element) === spine) wardicElements.delete(element)
  }
}

/** What a scope animates plain elements with: its provider's. */
export interface AnimateEnv {
  readonly runtime: WardicRuntime
  readonly gate: FlushGate.Shape
  readonly reducedMotion: () => boolean
  readonly positionalKeys: ReducedMotion.PositionalKeys["Service"]
  readonly defaultTransition: DefaultTransition.DefaultTransition["Service"]
}

/** A plain element's spine (#433's Q4), its values, and how many of its animations run, which keep it in the gate. */
interface Plain {
  readonly spine: ElementSpine
  readonly snapshot: Snapshot
  readonly id: string
  running: number
  unregister: () => void
}

/** Each gate's plain elements: a provider's own, kept while the element is. */
const plainByGate = new WeakMap<FlushGate.Shape, WeakMap<Element, Plain>>()

/** The plain elements' gate ids, counted. */
let plainIds = 0

/** No config: a plain element's. */
const NO_CONFIG = {}

/** `element`'s plain spine under `env`'s gate, made at its first animation. */
const plainOf = (env: AnimateEnv, element: Element): Plain => {
  let byElement = plainByGate.get(env.gate)
  if (Predicate.isUndefined(byElement)) {
    byElement = new WeakMap()
    plainByGate.set(env.gate, byElement)
  }
  const known = byElement.get(element)
  if (Predicate.isNotUndefined(known)) return known
  const el = element as HTMLElement
  const id = `wardic-animate-${plainIds++}`
  const snapshot: Snapshot = { values: {}, velocities: {} }
  const spine = makeElementSpine({
    runtime: env.runtime,
    gate: env.gate,
    id,
    element: el,
    tag: undefined,
    config: () => NO_CONFIG,
    parent: undefined,
    canStart: undefined,
    extraDelay: undefined,
    onFrame: undefined,
    reducedMotion: env.reducedMotion,
    positionalKeys: env.positionalKeys,
    defaultTransition: env.defaultTransition,
    start: { initialValues: {}, initialLink: {}, startedLink: {}, quiet: false },
    snapshot,
    reuse: makeReuse(),
    links: startLinksOf(el, undefined, undefined),
    styleNow: undefined,
    live: undefined,
    presence: undefined,
    projected: false,
    dragAxis: undefined,
    handoff: undefined,
  })
  const plain: Plain = { spine, snapshot, id, running: 0, unregister: constVoid }
  byElement.set(element, plain)
  return plain
}

/**
 * An element's animation of `target`: through its spine when it's a Wardic element's, else through its
 * plain spine, in the gate while any of its animations runs.
 */
const trackOf = (env: AnimateEnv, element: Element, target: WardicVariant, transition: WardicTransition | undefined, head: Playback.Playhead, settled: () => void): ImperativeTrack => {
  const resolved = resolveTarget(target, undefined, undefined, NO_VARIANT_STATE)
  const own = wardicElements.get(element)
  const hooks = { settled, failed: constVoid }
  if (Predicate.isNotUndefined(own)) return own.animate(resolved, transition, head, hooks)
  const plain = plainOf(env, element)
  // In the gate while it runs; out once its last animation is done, after the flush of its last frame.
  let live = false
  const enter = (): void => {
    if (live) return
    live = true
    // Back in the gate with every value it holds, so a transform it draws keeps the keys it isn't animating.
    if (plain.running === 0) {
      plain.unregister = env.gate.register(plain.id, { target: element })
      if (Bool.not(Rec.isEmptyRecord(plain.snapshot.values))) env.gate.write(plain.id, plain.snapshot.values)
    }
    plain.running++
  }
  const leave = (): void => {
    if (Bool.not(live)) return
    live = false
    plain.running--
    if (plain.running === 0) env.gate.afterFlush(() => {
      if (plain.running === 0) plain.unregister()
    })
  }
  const track = plain.spine.animate(resolved, transition, head, {
    settled: () => {
      leave()
      settled()
    },
    failed: () => leave(),
  })
  return {
    run: () => {
      enter()
      track.run()
    },
    stop: () => {
      track.stop()
      leave()
    },
    cancel: () => {
      enter()
      track.cancel()
      leave()
    },
    duration: track.duration,
  }
}

/** What `animate` animates (Motion's `ElementOrSelector`): an element, a selector inside the scope, or a list of elements. */
export type WardicAnimationSubject = Element | string | ArrayLike<Element> | Iterable<Element> | null | undefined

/**
 * `animate`'s options (Motion's): a transition, its `delay` a function of each element's index and
 * their count when there are many (`stagger()` is #436), and `onComplete`, at the landing.
 */
export type WardicAnimateOptions = (WardicTransition extends infer T ? (T extends unknown ? { readonly [K in keyof T as Exclude<K, "delay">]: T[K] } : never) : never) & {
  readonly delay?: number | ((index: number, count: number) => number) | undefined
  readonly onComplete?: (() => void) | undefined
}

/** The elements of `subject`: a selector's inside `scope`, else the page's. */
const subjectsOf = (subject: WardicAnimationSubject, scope: Element | undefined): ReadonlyArray<Element> => {
  if (Predicate.isNullish(subject)) return []
  if (Predicate.isString(subject)) return Arr.fromIterable(UndefinedOr.match(scope, { onUndefined: () => document, onDefined: (el): ParentNode => el }).querySelectorAll(subject))
  if (Predicate.hasProperty(subject, "nodeType")) return [subject as Element]
  if (Predicate.isIterable(subject)) return Arr.fromIterable(subject)
  const list = subject as ArrayLike<Element>
  return Arr.makeBy(list.length, (i) => list[i] as Element)
}

/** Each element's transition: its `delay` worked out for it (Motion's `delay(i, n)`). */
const transitionFor = (options: WardicAnimateOptions | undefined, index: number, count: number): WardicTransition | undefined =>
  UndefinedOr.map(options, (given) => {
    const { delay, onComplete: _onComplete, ...rest } = given as Readonly<Record<string, unknown>>
    if (Predicate.isFunction(delay)) return { ...rest, delay: (delay as (index: number, count: number) => number)(index, count) } as WardicTransition
    if (Predicate.isUndefined(delay)) return rest as WardicTransition
    return { ...rest, delay } as WardicTransition
  })

/** A **Playback controls**'s state (Motion's `AnimationPlayState`). */
export type WardicPlayState = "idle" | "running" | "paused" | "finished"

/** What an Imperative animation returns (#433, Motion's `AnimationPlaybackControls`): awaitable. */
export interface WardicPlaybackControls extends PromiseLike<void> {
  /** Seconds played, a delay included. Set, it seeks: each key starts again there, holding while paused. */
  time: number
  /** How fast it plays: 1 as given, 2 twice as fast, 0 held, below 0 backwards. */
  speed: number
  /** How long it runs, in seconds: its longest element's longest key, a spring's to rest. */
  readonly duration: number
  readonly state: WardicPlayState
  /** Resolves when it lands, or at `complete()`; never at `stop()` or `cancel()`, as Motion's. */
  readonly finished: Promise<void>
  /** Play it on: from where it's paused, or again from its start once it's finished or cancelled. Not after `stop()`. */
  readonly play: () => void
  /** Hold it where it is. */
  readonly pause: () => void
  /** End it where it is, for good: its keys stay there. */
  readonly stop: () => void
  /** End it, and put its keys back where it started them. */
  readonly cancel: () => void
  /** Jump to its end, and finish. */
  readonly complete: () => void
}

/** What a scope hears of its animations: each one's start and its end, however it ended. */
export interface AnimationWatch {
  readonly started: (controls: WardicPlaybackControls) => void
  /** It's no longer in flight: `landed` when it finished. */
  readonly ended: (controls: WardicPlaybackControls, landed: boolean) => void
}

/** Playback controls over `tracks`, all run through `head`, started now. */
const controlsOf = (tracks: ReadonlyArray<ImperativeTrack>, head: Playback.Playhead, watch: AnimationWatch, onComplete: (() => void) | undefined): {
  readonly controls: WardicPlaybackControls
  readonly settledOne: () => void
} => {
  let state: WardicPlayState = "running"
  let stopped = false
  let landed = 0
  let resolve: (() => void) | undefined
  let finished: Promise<void> | undefined
  let isResolved = false
  let duration: number | undefined
  const durationNow = (): number => {
    if (Predicate.isUndefined(duration)) duration = Arr.reduce(tracks, 0, (longest, track) => Math.max(longest, track.duration()))
    return duration
  }
  const runAll = (): void => {
    landed = 0
    Arr.forEach(tracks, (track) => track.run())
  }
  const fresh = (): void => {
    finished = undefined
    resolve = undefined
    isResolved = false
  }
  const end = (how: WardicPlayState, landedNow: boolean): void => {
    const was = state
    state = how
    if (Bool.or(was === "running", was === "paused")) watch.ended(controls, landedNow)
  }
  const restart = (): void => {
    const was = state
    state = "running"
    if (Bool.or(was === "finished", was === "idle")) watch.started(controls)
  }
  const controls: WardicPlaybackControls = {
    get time() {
      return head.time
    },
    set time(at: number) {
      Playback.seek(head, at)
      // A seek of one that isn't running holds where it goes, as Motion's.
      if (state !== "running") {
        head.paused = true
        if (Bool.or(state === "finished", state === "idle")) {
          fresh()
          watch.started(controls)
        }
        state = "paused"
      }
      runAll()
    },
    get speed() {
      return head.speed
    },
    set speed(speed: number) {
      head.speed = speed
    },
    get duration() {
      return durationNow()
    },
    get state() {
      return state
    },
    get finished() {
      if (Predicate.isUndefined(finished)) {
        finished = Bool.match(isResolved, {
          onTrue: () => Promise.resolve(),
          onFalse: () =>
            new Promise<void>((done) => {
              resolve = done
            }),
        })
      }
      return finished
    },
    then: (onResolve, onReject) => controls.finished.then(onResolve, onReject),
    play: () => {
      if (stopped) return
      if (state === "paused") {
        head.paused = false
        state = "running"
        return
      }
      if (state === "running") return
      // Again from its start: its end when it plays backwards.
      fresh()
      head.paused = false
      Playback.seek(head, Bool.match(head.speed < 0, { onTrue: durationNow, onFalse: () => 0 }))
      restart()
      runAll()
    },
    pause: () => {
      if (stopped) return
      head.paused = true
      if (state === "running") state = "paused"
    },
    stop: () => {
      stopped = true
      Arr.forEach(tracks, (track) => track.stop())
      end("idle", false)
    },
    cancel: () => {
      Arr.forEach(tracks, (track) => track.cancel())
      Playback.seek(head, 0)
      end("idle", false)
    },
    complete: () => {
      if (stopped) return
      if (state !== "running") restart()
      head.paused = false
      Playback.seek(head, durationNow())
      runAll()
    },
  }
  // Each element's legs landed: the last lands the animation.
  const settledOne = (): void => {
    landed++
    if (landed < tracks.length) return
    isResolved = true
    UndefinedOr.map(resolve, (done) => done())
    UndefinedOr.map(onComplete, (complete) => complete())
    end("finished", true)
  }
  return { controls, settledOne }
}

/** An animation of no element: finished at once (a server's, or a subject that matched none). */
const finishedControls = (): WardicPlaybackControls => {
  const done = Promise.resolve()
  return {
    time: 0,
    speed: 1,
    duration: 0,
    state: "finished",
    finished: done,
    then: (onResolve, onReject) => done.then(onResolve, onReject),
    play: constVoid,
    pause: constVoid,
    stop: constVoid,
    cancel: constVoid,
    complete: constVoid,
  }
}

/** A scope's `animate` (#433, Motion's): `subject`'s elements to `target`, on `options`, through one Playhead. */
export type WardicAnimate = (subject: WardicAnimationSubject, target: WardicVariant, options?: WardicAnimateOptions) => WardicPlaybackControls

/**
 * An **Animation scope**'s `animate` (#433): selectors looked up inside `scope()`, each animation
 * told to `watch` as it starts and ends. Every element's legs start in the call, on the loop by
 * the end of its task.
 */
export const scopedAnimate = (env: AnimateEnv, scope: () => Element | undefined, watch: AnimationWatch): WardicAnimate => (subject, target, options) => {
  const elements = subjectsOf(subject, scope())
  if (Arr.isReadonlyArrayEmpty(elements)) return finishedControls()
  const head = Playback.make()
  let settledOne = constVoid
  const count = elements.length
  const tracks = Arr.map(elements, (element, index) => trackOf(env, element, target, transitionFor(options, index, count), head, () => settledOne()))
  const made = controlsOf(tracks, head, watch, UndefinedOr.map(options, (given) => given.onComplete))
  settledOne = made.settledOne
  watch.started(made.controls)
  Arr.forEach(tracks, (track) => track.run())
  return made.controls
}

/** A server's `animate`: nothing to animate. */
export const serverAnimate: WardicAnimate = () => finishedControls()

/** An **Animation scope** (#433, Motion's `AnimationScope`): the element its selectors are looked up in, given as its `ref`. */
export interface WardicAnimationScope<T extends Element = HTMLElement> {
  /** Give it as the element's `ref`. */
  (element: T): void
  /** The element, once it's mounted. */
  readonly current: T | undefined
  /** Its animations in flight: started, and neither finished, stopped nor cancelled. */
  readonly animations: ReadonlyArray<WardicPlaybackControls>
}

/**
 * An Animation scope's ref and what it hears of its animations (#433): each in `animations` while in
 * flight, and `also` told too (Solid 2's `settled()`). `stopAll` stops them, at its owner's cleanup.
 */
export const scopeOf = <T extends Element>(also?: AnimationWatch): {
  readonly scope: WardicAnimationScope<T>
  readonly watch: AnimationWatch
  readonly stopAll: () => void
} => {
  let current: T | undefined
  let animations: ReadonlyArray<WardicPlaybackControls> = []
  const ref = (element: T): void => {
    current = element
  }
  const scope = Object.defineProperties(ref, {
    current: { get: () => current },
    animations: { get: () => animations },
  }) as WardicAnimationScope<T>
  const watch: AnimationWatch = {
    started: (controls) => {
      animations = Arr.append(animations, controls)
      UndefinedOr.map(also, (more) => more.started(controls))
    },
    ended: (controls, landed) => {
      animations = Arr.filter(animations, (one) => one !== controls)
      UndefinedOr.map(also, (more) => more.ended(controls, landed))
    },
  }
  return { scope, watch, stopAll: () => Arr.forEach(animations, (controls) => controls.stop()) }
}
