/**
 * Appear animations in the Solid binding (#48, ADR-0044): a server-rendered mount animation played
 * in CSS from first paint, and taken over at mount (the **Handoff**).
 *
 * - **Both sides** describe an element's mount animation the same way ({@link MountAnimation}): its
 *   starting values, its targets, its own transition and whether motion is reduced. The rule's name
 *   is the hash of that description ({@link keyOf}), so the client tells a Handoff it can continue
 *   from one it can't.
 * - **On a server** the provider holds one render's {@link ServerAppear}. Each element that
 *   qualifies takes a slot (its inline `animation: var(--wardic-aN)`); a Variant child joins its
 *   parent's group, in render order. Once the render is done, `css()` works out each one's timing
 *   (its stagger, its `when`) and writes the head's `<style>`.
 * - **At mount** the spine finds the element's animation ({@link handoffOf}), starts its first legs
 *   that far in, and removes it in its first commit.
 */
import type * as DefaultTransition from "@wardic/core/DefaultTransition"
import * as Easing from "@wardic/core/Easing"
import type * as Frame from "@wardic/core/Frame"
import * as Machine from "@wardic/core/Machine"
import type * as ReducedMotion from "@wardic/core/ReducedMotion"
import * as Stagger from "@wardic/core/Stagger"
import type * as Values from "@wardic/core/Values"
import * as Appear from "@wardic/dom/Appear"
import * as DomDefaultTransition from "@wardic/dom/DomDefaultTransition"
import * as DomInterpolators from "@wardic/dom/DomInterpolators"
import * as DomPositionalKeys from "@wardic/dom/DomPositionalKeys"
import * as OwnValues from "@wardic/dom/OwnValues"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Order from "effect/Order"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as Result from "effect/Result"
import * as UndefinedOr from "effect/UndefinedOr"
import type { WardicTransition } from "./config.ts"
import { entriesOf, type KeyframesStart, keyframesFrom, type Leg, legsOf, runOf, type StopsByKey, transitionForKey } from "./retarget-legs.ts"
import type { Keyframes } from "./variant-target.ts"

// --- The mount animation, on both sides -------------------------------------------------------

/** An element's mount animation, described the same on the server and the client. */
export interface MountAnimation {
  /** The element's tag, for SVG's routing; `undefined` for an element whose tag isn't known. */
  readonly tag: string | undefined
  /** Each animated key's start. */
  readonly from: Values.Values
  /** Each animated key's target. */
  readonly to: Values.Values
  /** The element's own transition: its stagger isn't in it (ADR-0007). */
  readonly transition: WardicTransition | undefined
  /** Whether reduced motion is on for it (ADR-0029). */
  readonly reduced: boolean
  /**
   * Whether it's a layout node (#245): drawn through its projection at rest, as the client draws
   * it, its own translate on top (#363). Part of its rule's name (`Appear.Spec.projected`).
   */
  readonly layout: boolean
  /** Each key's Keyframes of more than two stops (#429), `from` at their first: part of its key. Left out with none. */
  readonly stops?: StopsByKey | undefined
}

/** What stands in for a function with no easing name: canonical text holding it is no key. */
const UNNAMED = "\u0000unnamed"

/**
 * A value as canonical text: JSON with each object's keys in order, `undefined`s left out, and a
 * function by its easing name (`Easing.nameOf`), else {@link UNNAMED}. Written directly, its cases
 * built once at module load: it runs per element (#69's PR 2).
 */
const textOf: (value: unknown) => string = Match.type<unknown>().pipe(
  Match.when(Predicate.isFunction, (fn) => Option.match(Easing.nameOf(fn as Easing.Easing), { onNone: () => UNNAMED, onSome: (easing) => `{"easing":${JSON.stringify(easing)}}` })),
  Match.when(Array.isArray, (items) => `[${Arr.map(items as ReadonlyArray<unknown>, (item) => textOf(item)).join(",")}]`),
  Match.when(Predicate.isObject, (record) => {
    const keys = Arr.sort(Arr.filter(Object.keys(record), (key) => Predicate.isNotUndefined((record as Record<string, unknown>)[key])), Order.String)
    return `{${Arr.map(keys, (key) => `${JSON.stringify(key)}:${textOf((record as Record<string, unknown>)[key])}`).join(",")}}`
  }),
  Match.orElse((v) => String(JSON.stringify(v))),
)

/** A value as canonical text; `None` when a function in it has no easing name. */
const canonical = (value: unknown): Option.Option<string> => Option.filter(Option.some(textOf(value)), (text) => Bool.not(text.includes(UNNAMED)))

/** Each mount animation's canonical starts, targets and transition, by its `from`: both its plays share one. */
const baseKeys = new WeakMap<Values.Values, Option.Option<string>>()

/**
 * The mount animation's key: its starts, targets and transition as one canonical text, and whether
 * motion is reduced. `None` when the transition holds a function with no easing name
 * (`Easing.nameOf`): the server can't tell it from another, so the element keeps its Starting style.
 */
export const keyOf = (m: MountAnimation): Option.Option<string> => {
  const base = Option.getOrElse(Option.fromUndefinedOr(baseKeys.get(m.from)), () => {
    const computed = canonical({ from: m.from, to: m.to, transition: UndefinedOr.match(m.transition, { onUndefined: () => null, onDefined: (t: WardicTransition) => t }), stops: m.stops })
    baseKeys.set(m.from, computed)
    return computed
  })
  return Option.map(base, (text) => `${text}|reduced:${m.reduced}`)
}

/** Whether a transition repeats for ever: a tween's `repeat: Infinity`, a tween as it runs (ADR-0051). */
export const repeatsForever = (transition: WardicTransition | undefined): boolean =>
  UndefinedOr.match(runOf(transition), { onUndefined: () => false, onDefined: (run) => Bool.and(run.type === "tween", (run as Machine.AnimateOptions).repeat === Number.POSITIVE_INFINITY) })

/** A transition's own delay, 0 without one. */
const ownDelayOf = (transition: WardicTransition | undefined): number =>
  UndefinedOr.match(transition, { onUndefined: () => 0, onDefined: ({ delay = 0 }) => delay })

/**
 * The seconds a rule holds before it moves, of the delay the client counts: a transition's own
 * delay is in its rule, except a forever-repeating one's, whose rule is a cycle and whose own delay
 * goes in `animation-delay` with the stagger.
 */
const heldInRule = (transition: WardicTransition | undefined): number =>
  Bool.match(repeatsForever(transition), { onTrue: () => 0, onFalse: () => ownDelayOf(transition) })

/**
 * The transition a server samples: as given, but for one that repeats for ever, two runs and the
 * delay that follows them, with no delay before (one cycle of the CSS, played `infinite`). Two
 * runs, so a cycle is exact for every `repeatType`, `reverse` and `mirror` included.
 */
const sampledTransition = (transition: WardicTransition | undefined): WardicTransition | undefined =>
  Bool.match(repeatsForever(transition), {
    onTrue: () => ({ ...transition, delay: 0, repeat: 1 }) as WardicTransition,
    onFalse: () => transition,
  })

/**
 * One machine of a Retarget's legs, run together: each step steps every leg not yet settled, and
 * merges their values; it settles with the last. What a server samples. Built with the DOM's
 * Interpolators (a server projects with the DOM's `project`, ADR-0021 decision 2).
 */
const together = (legs: ReadonlyArray<Leg>): Machine.Machine<Frame.Frame<Values.Values>> => {
  const machines = Effect.runSync(
    Effect.all(Arr.map(legs, (leg): Effect.Effect<Machine.Machine<Frame.Frame<unknown>>, never, never> => machineOfLeg(leg))).pipe(
      Effect.provide(DomInterpolators.layer),
    ),
  )
  return Machine.make({
    settles: true,
    span: { name: "wardic.appear", attributes: { legs: legs.length } },
    start: () => {
      const runs = Arr.map(machines, (machine, i) => ({ step: machine.start(), key: keyOfLeg(legs[i] as Leg), last: Option.none<Frame.Frame<unknown>>() }))
      return (dt) => {
        const value: Record<string, number | string> = {}
        const done = Arr.reduce(runs, true, (all, run) => {
          const frame = Option.getOrElse(Option.filter(run.last, (last) => last.done), () => run.step(dt))
          run.last = Option.some(frame)
          Option.match(run.key, {
            onNone: () => Object.assign(value, frame.value as Values.Values),
            onSome: (key) => Object.assign(value, { [key]: frame.value as number }),
          })
          return Bool.and(all, frame.done)
        })
        return { value, done }
      }
    },
  })
}

/** A leg's machine, built: a Blend's through the Interpolators. */
const machineOfLeg = (leg: Leg): Effect.Effect<Machine.Machine<Frame.Frame<unknown>>, never, never> =>
  Bool.match(leg._tag === "Blend", {
    onTrue: () => (leg as Extract<Leg, { _tag: "Blend" }>).machine().pipe(Effect.provide(DomInterpolators.layer)),
    onFalse: () => Effect.sync(() => (leg as Exclude<Leg, { _tag: "Blend" }>).machine() as Machine.Machine<Frame.Frame<unknown>>),
  })

/** The key a Follow leg's single value is: its own. */
const keyOfLeg = (leg: Leg): Option.Option<string> =>
  Bool.match(leg._tag === "Follow", { onTrue: () => Option.some((leg as Extract<Leg, { _tag: "Follow" }>).key), onFalse: () => Option.none() })

/** The DOM's Positional keys, which a server's reduced rule snaps (ADR-0029, ADR-0036). */
const DOM_POSITIONAL: ReducedMotion.PositionalKeys["Service"] = { isPositional: DomPositionalKeys.isPositional }

/** The DOM's Default transition, which a key with no transition defined samples as the client runs it (ADR-0051). */
const DOM_DEFAULTS: DefaultTransition.DefaultTransition["Service"] = { transitionFor: DomDefaultTransition.transitionFor, keyframes: DomDefaultTransition.keyframes }

/**
 * Whether a value's own transition drives one of its keys while anything repeats for ever (#301): one
 * CSS cycle can't hold a key that stops beside one that repeats, nor two cycles' lengths. With every
 * key on the transition's own fields (a `layout` entry alone), it plays as before.
 */
const foreverByValue = (m: MountAnimation): boolean => {
  const entries = entriesOf(m.transition)
  if (Predicate.isUndefined(entries)) return false
  const runsOn = Arr.map(Rec.keys(m.to), (key) => transitionForKey(m.transition, key))
  if (Arr.every(runsOn, (transition) => transition === entries.own)) return false
  return Bool.or(repeatsForever(m.transition), Arr.some(runsOn, repeatsForever))
}

/** A mount animation's spec for the DOM's sampler, or why it has none. */
export const specOf = (m: MountAnimation): Result.Result<Appear.Spec, string> =>
  Option.match(keyOf(m), {
    onNone: () => Result.fail("its transition holds a function with no easing name"),
    onSome: (key) => {
      if (foreverByValue(m)) return Result.fail("a value's own transition repeats for ever beside another")
      const transition = sampledTransition(m.transition)
      const repeatDelay = UndefinedOr.match(m.transition, { onUndefined: () => 0, onDefined: (t) => Option.getOrElse(Option.fromUndefinedOr((t as Machine.AnimateOptions).repeatDelay), () => 0) })
      return Result.succeed({
        key,
        tag: m.tag,
        infinite: repeatsForever(m.transition),
        projected: m.layout,
        machine: () =>
          Bool.match(repeatsForever(m.transition), {
            onTrue: () => Machine.holdAfter(together(legsOf(m.from, m.to, transition, m.reduced, DOM_POSITIONAL, DOM_DEFAULTS, {}, undefined, m.stops)), repeatDelay),
            onFalse: () => together(legsOf(m.from, m.to, transition, m.reduced, DOM_POSITIONAL, DOM_DEFAULTS, {}, undefined, m.stops)),
          }),
      })
    },
  })

/**
 * Why a mount animation can't play before hydration, or `None` when it can (decision 4): a key
 * starting from anything but `initial`, a value the DOM reads from the element (`auto`, `var()`),
 * or a start that can't take its target's shape (a length pair in two units).
 */
export const unplayable = (initial: Values.Values, to: Values.Values): Option.Option<string> =>
  Arr.findFirst(Rec.toEntries(to), ([key, target]) =>
    Option.match(Option.fromUndefinedOr(initial[key]), {
      onNone: () => Option.some(`${key} starts from the element's own value (no initial)`),
      onSome: (start) =>
        Bool.match(Bool.or(readsElement(start), readsElement(target)), {
          onTrue: () => Option.some(`${key} is a value the DOM reads from the element`),
          onFalse: () =>
            // A start that can't take its target's shape, a length in another unit among them (ADR-0024).
            Bool.match(Option.isNone(OwnValues.valueLike(start, target)), {
              onTrue: () => Option.some(`${key}'s start and target don't take one shape`),
              onFalse: () => Option.none(),
            }),
        }),
    }))

/** Whether a value is one the DOM reads from the element: `auto`, or a custom property. */
const readsElement = (value: number | string): boolean => Predicate.isString(value) && /\bauto\b|var\(/.test(value)

/** Whether an `initial` value, coerced to its target's shape, is that target: its key starts no leg (#448). */
const atTarget = (start: number | string | undefined, target: number | string): boolean =>
  Option.exists(OwnValues.valueLike(start, target), (like) => like === target)

// --- The server --------------------------------------------------------------------------------

/** A variant parent's orchestration, on a server: its children in render order, its stagger and `when`. */
export interface AppearGroup {
  readonly leader: Entry
  readonly stagger: { readonly amount: number; readonly delayChildren: number; readonly from: Stagger.Origin; readonly direction: 1 | -1 }
  readonly when: "beforeChildren" | "afterChildren" | undefined
  readonly children: Array<Entry>
}

/** One element's place in a server render's Appear animations. */
export interface Entry {
  /** Its mount animation per motion setting, or why it has none; `None` when nothing animates. */
  readonly plays: { readonly normal: Option.Option<Result.Result<MountAnimation, string>>; readonly reduced: Option.Option<Result.Result<MountAnimation, string>> }
  readonly slot: Option.Option<Appear.Slot>
  /** The group it staggers in, as a Variant child. */
  readonly group: Option.Option<AppearGroup>
  /** Why it was ruled out after it rendered: its user style, read when `ward()` is called (ADR-0044, decision 4). */
  readonly vetoes: Array<string>
}

/** One server render's Appear animations: the provider's (ADR-0044, decisions 3 and 5). */
export interface ServerAppear {
  /** The provider's reduced motion: which rules the head holds. */
  readonly reducedMotion: ReducedMotion.Config
  /** An element's entry, and its inline `animation` when it plays. */
  readonly enter: (
    animation: { readonly normal: Option.Option<Result.Result<MountAnimation, string>>; readonly reduced: Option.Option<Result.Result<MountAnimation, string>> },
    group: Option.Option<AppearGroup>,
  ) => {
    readonly entry: Entry
    readonly animation: Option.Option<string>
    /**
     * Entered after the shell was flushed, so in a chunk a stream sends later (#245), and no late
     * element around it: the chunk's root, which puts the chunk's `<style>` after itself.
     */
    readonly chunkRoot: boolean
    readonly late: boolean
  }
  /** A variant parent's group, its children to come. */
  readonly group: (leader: Entry, transition: WardicTransition | undefined) => AppearGroup
  /**
   * The head's CSS, once the shell is done: every element entered so far, its timing worked out,
   * and the rules. Called once, by the provider's `useAssets`: what enters after is late (#245).
   */
  readonly css: () => string
  /** Render a late element's subtree: an element inside it isn't a chunk's root (#245). */
  readonly within: <A>(late: boolean, render: () => A) => A
  /**
   * A late chunk's CSS (#245): the rules and timings of every element entered since the last
   * write, those the head sent left out; "" for none. The Solid 2 binding hands it to `useHead`,
   * which streams it with the chunk as a head patch (#209 PR 4a).
   */
  readonly chunkCss: () => string
  /**
   * A late chunk's `<style>` (#245), as server text: {@link chunkCss} in a `<style>`. The Solid 1
   * binding's chunk root's thunk asks for it once the chunk has rendered.
   */
  readonly chunk: () => string
  /** Why each element that doesn't play doesn't: for the debug log. */
  readonly reasons: () => ReadonlyArray<string>
}

/** No transition: no orchestration. */
const NO_TRANSITION: WardicTransition = {}

/** A server render's Appear animations, for a provider whose reduced motion is `reducedMotion`. */
export const serverAppear = (reducedMotion: ReducedMotion.Config): ServerAppear => {
  const sheet = Appear.sheet()
  const entries: Array<Entry> = []
  const reasons: Array<string> = []
  // The shell is flushed once the head's CSS is asked for: what enters after is late (#245).
  let flushed = false
  // The entries written so far, and how deep the render is in late elements.
  let written = 0
  let lateDepth = 0
  /** The entries since the last write, now written. */
  const nextBatch = (): ReadonlyArray<Entry> => {
    const batch = entries.slice(written)
    written = entries.length
    return batch
  }
  /** A batch's timing, each slot defined, and the sheet's CSS for them (decision 5). */
  const write = (batch: ReadonlyArray<Entry>): string => {
    const resolve = (pick: "normal" | "reduced") => timings(batch, pick)
    const normal = Bool.match(reducedMotion === "always", { onTrue: () => resolve("reduced"), onFalse: () => resolve("normal") })
    const reduced = Bool.match(reducedMotion === "user", { onTrue: () => Option.some(resolve("reduced")), onFalse: () => Option.none<Timings>() })
    const settings = Arr.prepend(Option.toArray(reduced), normal)
    // Most renders write no SVG geometry: no group pass.
    const supports = Bool.match(Arr.some(settings, (byEntry) => byEntry.geometry), {
      onTrue: () => groupSupports(batch, settings),
      onFalse: () => () => NO_SUPPORTS,
    })
    Arr.forEach(batch, (entry) =>
      Option.map(entry.slot, (slot) => {
        const play = UndefinedOr.getOrThrow(normal.get(entry))
        const reducedPlay = Option.map(reduced, (byEntry) => UndefinedOr.getOrThrow(byEntry.get(entry)))
        const defined = Result.flatMap(play, (p) =>
          Option.match(reducedPlay, {
            onNone: () => slot.define(p, undefined, supports(entry)),
            onSome: (r) => Result.flatMap(r, (rp) => slot.define(p, rp, supports(entry))),
          }))
        Result.match(defined, { onFailure: (reason) => reasons.push(reason), onSuccess: () => undefined })
      }))
    return sheet.css()
  }
  const plays = (animation: Entry["plays"]): boolean =>
    Bool.or(Option.exists(animation.normal, Result.isSuccess), Option.exists(animation.reduced, Result.isSuccess))
  const chunkCss = (): string => write(nextBatch())
  return {
    reducedMotion,
    enter: (animation, group) => {
      Arr.forEach([animation.normal, animation.reduced], (play) =>
        Option.map(Option.flatMap(play, (p) => Result.getFailure(p)), (reason) => reasons.push(reason)))
      const slot = Option.liftPredicate(animation, plays).pipe(Option.map(() => sheet.slot()))
      const entry: Entry = { plays: animation, slot, group, vetoes: [] }
      entries.push(entry)
      Option.map(group, (g) => g.children.push(entry))
      return { entry, animation: Option.map(slot, (s) => s.animation), late: flushed, chunkRoot: Bool.and(flushed, lateDepth === 0) }
    },
    within: (late, render) => {
      // Per element on a server: a guard, no allocation.
      if (Bool.not(late)) return render()
      lateDepth++
      try {
        return render()
      } finally {
        lateDepth--
      }
    },
    chunkCss,
    chunk: () => Appear.chunkStyle(chunkCss()),
    group: (leader, transition) => {
      const { staggerChildren = 0, delayChildren = 0, from = "first", staggerDirection = 1, when } = UndefinedOr.match(transition, {
        onUndefined: () => NO_TRANSITION,
        onDefined: (t: WardicTransition) => t,
      })
      return { leader, stagger: { amount: staggerChildren, delayChildren, from, direction: staggerDirection }, when, children: [] }
    },
    css: () => {
      flushed = true
      return write(nextBatch())
    },
    reasons: () => reasons,
  }
}

/**
 * Each entry's play for one motion setting: its spec and its delay, or why it has none. A Variant
 * child starts after its stagger (`delayChildren` plus its place, ADR-0007), and after its parent
 * settles under `when: "beforeChildren"`; a parent under `"afterChildren"` starts once its last
 * child settles. A start that depends on an element with no rule has none.
 *
 * Timed a batch at a time (#245): the shell's, then each late chunk's, whose CSS starts when the
 * chunk lands. A late Variant child of a group led earlier is a fresh mount from then: its stagger
 * is among that group's children in its batch, and it doesn't wait on the leader (decision 5 of
 * *Amendment (#245)*). The shell's batch is every entry, so nothing changes for it.
 */
const timings = (entries: ReadonlyArray<Entry>, pick: "normal" | "reduced"): Timings => {
  const memo = new Map<Entry, Result.Result<{ readonly play: TimedPlay; readonly settled: number }, string>>()
  let geometry = false
  const inBatch = new Set(entries)
  // Each group's children in this batch, once a group.
  const batchChildren = new Map<AppearGroup, ReadonlyArray<Entry>>()
  const childrenOf = (g: AppearGroup): ReadonlyArray<Entry> =>
    Option.getOrElse(Option.fromUndefinedOr(batchChildren.get(g)), () => {
      const children = Arr.filter(g.children, (child) => inBatch.has(child))
      batchChildren.set(g, children)
      return children
    })
  /** An entry's spec and rule, or why it has none; a missing play (nothing animates) is a rule of 0 s. */
  const ruleOf = (entry: Entry): Result.Result<Option.Option<{ readonly spec: Appear.Spec; readonly rule: Appear.Keyframes }>, string> =>
    Arr.match(entry.vetoes, {
      onNonEmpty: (vetoes) => Result.fail(vetoes.join("; ")),
      onEmpty: () => playOf(entry),
    })
  const playOf = (entry: Entry): Result.Result<Option.Option<{ readonly spec: Appear.Spec; readonly rule: Appear.Keyframes }>, string> =>
    Option.match(entry.plays[pick], {
      onNone: () => Result.succeed(Option.none()),
      onSome: (animation) =>
        Result.flatMap(Result.flatMap(animation, specOf), (spec) => Result.map(Appear.keyframes(spec), (rule) => Option.some({ spec, rule }))),
    })
  /** The seconds from first paint to when `entry` starts, and its play. */
  const timingOf = (entry: Entry): Result.Result<{ readonly play: TimedPlay; readonly settled: number }, string> =>
    Option.getOrElse(Option.fromUndefinedOr(memo.get(entry)), () => {
      const computed = Result.flatMap(ruleOf(entry), (rule) =>
        Result.map(startOf(entry), (start) => {
          const spec = Option.match(rule, { onNone: () => undefined, onSome: (r) => r.spec })
          // A forever-repeating rule is a cycle: its own delay plays before it, and it never settles.
          const transition = Option.match(entry.plays[pick], { onNone: () => undefined, onSome: (p) => Result.match(p, { onFailure: () => undefined, onSuccess: (m) => m.transition }) })
          const forever = repeatsForever(transition)
          const before = Bool.match(forever, { onTrue: () => ownDelayOf(transition), onFalse: () => 0 })
          const settled = Option.match(rule, { onNone: () => 0, onSome: (r) => Bool.match(forever, { onTrue: () => Number.POSITIVE_INFINITY, onFalse: () => r.rule.settled }) })
          const supports = Option.match(rule, { onNone: () => NO_SUPPORTS, onSome: (r) => r.rule.supports })
          geometry = Bool.or(geometry, Arr.isReadonlyArrayNonEmpty(supports))
          return { play: { spec: spec as Appear.Spec, delay: start + before, supports }, settled: start + before + settled }
        }))
      memo.set(entry, computed)
      return computed
    })
  /** When `entry` starts: its stagger, after its parent under `beforeChildren`, after its children under `afterChildren`. */
  const startOf = (entry: Entry): Result.Result<number, string> =>
    Result.flatMap(afterParent(entry), (afterLeader) => Result.map(afterChildren(entry), (afterKids) => Math.max(afterLeader, afterKids) + staggerOf(entry, childrenOf)))
  // A leader written earlier started at first paint: a late child doesn't wait on it.
  const afterParent = (entry: Entry): Result.Result<number, string> =>
    Option.match(Option.filter(entry.group, (g) => Bool.and(g.when === "beforeChildren", inBatch.has(g.leader))), {
      onNone: () => Result.succeed(0),
      onSome: (g) =>
        Result.flatMap(
          Result.mapError(Result.map(timingOf(g.leader), (t) => t.settled), (reason) => `its parent has no rule (${reason})`),
          (settled) => Bool.match(Number.isFinite(settled), { onTrue: () => Result.succeed(settled), onFalse: () => Result.fail("its parent never settles") }),
        ),
    })
  const afterChildren = (entry: Entry): Result.Result<number, string> =>
    Option.match(Option.fromUndefinedOr(groupsLed.get(entry)), {
      onNone: () => Result.succeed(0),
      onSome: (g) =>
        Bool.match(g.when === "afterChildren", {
          onFalse: () => Result.succeed(0),
          onTrue: () =>
            Result.mapError(
              Result.map(Result.all(Arr.map(childrenOf(g), timingOf)), (kids) => Arr.reduce(kids, 0, (latest, t) => Math.max(latest, t.settled))),
              (reason) => `a child has no rule (${reason})`,
            ),
        }),
    })
  const groupsLed = new Map<Entry, AppearGroup>()
  Arr.forEach(entries, (entry) => Option.map(entry.group, (g) => groupsLed.set(g.leader, g)))
  const plays = new Map(Arr.map(entries, (entry) => [entry, Result.flatMap(timingOf(entry), (t) => Bool.match(Predicate.isUndefined(t.play.spec), {
    onTrue: () => Result.fail("nothing animates"),
    onFalse: () => Result.succeed(t.play),
  }))] as const))
  return Object.assign(plays, { geometry })
}

/** Each entry's play for one motion setting, and whether any of their rules writes SVG geometry. */
type Timings = Map<Entry, Result.Result<TimedPlay, string>> & { readonly geometry: boolean }

/** An element's play, with the SVG geometry properties its rule writes (#245, `Appear.Keyframes.supports`). */
interface TimedPlay extends Appear.Play {
  readonly supports: ReadonlyArray<string>
}

const NO_SUPPORTS: ReadonlyArray<string> = []

/**
 * The SVG geometry properties each entry's orchestrated group writes, over every play (#245,
 * `Appear.Keyframes.supports`): the whole tree a top leader orchestrates is defined under one
 * `@supports`, so a browser without them keeps all of it at its Starting style, not part of it
 * (decision 4: an element qualifies whole, and so does what it orchestrates). Per element on a
 * server: a render whose rules write none (most) pays a look at each play.
 */
const groupSupports = (
  entries: ReadonlyArray<Entry>,
  settings: ReadonlyArray<Map<Entry, Result.Result<TimedPlay, string>>>,
): ((entry: Entry) => ReadonlyArray<string>) => {
  /** The leader at the top of an entry's orchestration: itself, outside any group. */
  const topOf = (entry: Entry): Entry => Option.match(entry.group, { onNone: () => entry, onSome: (g) => topOf(g.leader) })
  /** What an entry's own rules write, over every play. */
  const own = (entry: Entry): ReadonlyArray<string> =>
    Arr.flatMap(settings, (byEntry) =>
      Option.match(Option.fromUndefinedOr(byEntry.get(entry)), {
        onNone: () => NO_SUPPORTS,
        onSome: (play) => Result.match(play, { onFailure: () => NO_SUPPORTS, onSuccess: (p) => p.supports }),
      }))
  const byTop = new Map<Entry, ReadonlyArray<string>>()
  Arr.forEach(entries, (entry) =>
    Arr.match(own(entry), {
      onEmpty: () => undefined,
      onNonEmpty: (mine) => {
        const top = topOf(entry)
        byTop.set(top, Arr.appendAll(Option.getOrElse(Option.fromUndefinedOr(byTop.get(top)), () => NO_SUPPORTS), mine))
      },
    }))
  return (entry) =>
    Bool.match(byTop.size === 0, {
      onTrue: () => NO_SUPPORTS,
      onFalse: () => Option.getOrElse(Option.fromUndefinedOr(byTop.get(topOf(entry))), () => NO_SUPPORTS),
    })
}

/**
 * A Variant child's stagger: its parent's `delayChildren` plus its place (ADR-0007), as the client
 * works it out, among the group's children in its batch (`childrenOf`, #245).
 */
const staggerOf = (entry: Entry, childrenOf: (g: AppearGroup) => ReadonlyArray<Entry>): number =>
  Option.match(entry.group, {
    onNone: () => 0,
    onSome: (g) => {
      const children = childrenOf(g)
      const n = children.length
      const i = children.indexOf(entry)
      const index = Bool.match(g.stagger.direction === -1, { onTrue: () => n - 1 - i, onFalse: () => i })
      return g.stagger.delayChildren + Stagger.make(g.stagger.amount, { from: g.stagger.from })(index, n)
    },
  })

/** What the server knows of an element when it renders it. */
export interface ServerElement {
  /** The element's own `appear` (the provider's is the render's {@link ServerAppear}). */
  readonly appear: boolean | undefined
  readonly tag: string | undefined
  /** Its starting values: `initial`, an inherited `initial` name, or `animate` under `initial={false}`. */
  readonly initial: Values.Values
  /** Its targets at mount: `animate`, or an inherited variant name resolved against its `variants`; `None` with neither. */
  readonly to: Option.Option<Values.Values>
  /** Its targets' Keyframes (#429), each such key's value in `to` their last stop; `undefined` with none. */
  readonly keyframes: Keyframes | undefined
  /** Whether its mount starts at its `animate` (#448, `startsQuiet`): nothing plays, its Keyframes included (#429). */
  readonly quiet: boolean
  /** Its own transition, else the one it inherits (ADR-0007). */
  readonly transition: WardicTransition | undefined
  /** Whether it's a layout node (`layout` or `layoutId`): drawn through its projection at rest (#245). */
  readonly layout: boolean
  /** The group it staggers in, as a Variant child: its parent's (`node.inherited`). */
  readonly group: Option.Option<AppearGroup>
  /** Whether it orchestrates its Variant children: it has variants of its own (ADR-0007). */
  readonly leads: boolean
  /** Its own transition, whose stagger and `when` its Variant children follow. */
  readonly ownTransition: WardicTransition | undefined
}

/**
 * An element's entry in a server render's Appear animations: its inline `animation` when it plays
 * one, and the group its Variant children join when it leads one.
 */
export const enterServer = (
  appear: ServerAppear,
  el: ServerElement,
): {
  readonly animation: Option.Option<string>
  readonly group: Option.Option<AppearGroup>
  readonly veto: (reason: string) => void
  /** Rendered after the shell (#245): in a late chunk, and that chunk's root when no late element is around it. */
  readonly late: boolean
  readonly chunkRoot: boolean
} => {
  // Its starts and targets once, both plays sharing them (and so their key's text, `keyOf`). A key
  // already at its target, coerced to its shape, is left out, as the client's first Retarget starts
  // it no leg (#448); a Keyframes key never is, and starts at its first stop, unless the mount starts
  // at its `animate`, when nothing plays (#429, Motion's).
  const mount = Option.flatMap(el.to, (to) => {
    const moving = Rec.filter(to, (target, key) =>
      Bool.match(hasStops(el.keyframes, key), { onTrue: () => Bool.not(el.quiet), onFalse: () => Bool.not(atTarget(el.initial[key], target)) }))
    return Bool.match(Rec.isEmptyRecord(moving), {
      onTrue: () => Option.none(),
      onFalse: () => Option.some(Result.map(playable(el, moving), (prepared): KeyframesStart & { readonly to: Values.Values } => startedOf(prepared, el.keyframes))),
    })
  })
  const play = (reduced: boolean): Option.Option<Result.Result<MountAnimation, string>> =>
    Option.map(mount, (prepared) =>
      Result.map(prepared, ({ from, to, stops }): MountAnimation => ({ tag: el.tag, from, to, transition: el.transition, reduced, layout: el.layout, stops })))
  const { entry, animation: inline, late, chunkRoot } = appear.enter({ normal: play(false), reduced: play(true) }, el.group)
  return {
    late,
    chunkRoot,
    animation: inline,
    group: Option.liftPredicate(entry, () => el.leads).pipe(Option.map((leader) => appear.group(leader, el.ownTransition))),
    veto: (reason) => {
      entry.vetoes.push(reason)
    },
  }
}

/** Whether `key` has Keyframes in `keyframes` (#429). */
const hasStops = (keyframes: Keyframes | undefined, key: string): boolean => {
  if (Predicate.isUndefined(keyframes)) return false
  return Object.hasOwn(keyframes, key)
}

/** A mount's starts with its Keyframes resolved (#429, `keyframesFrom`), as the client's first Retarget resolves them. */
const startedOf = (prepared: { readonly from: Values.Values; readonly to: Values.Values }, keyframes: Keyframes | undefined): KeyframesStart & { readonly to: Values.Values } =>
  UndefinedOr.match(keyframes, {
    onUndefined: () => ({ from: prepared.from, to: prepared.to, stops: undefined }),
    onDefined: (byKey) => ({ ...keyframesFrom(prepared.from, prepared.to, byKey), to: prepared.to }),
  })

/** An element's starts and targets, or why its mount animation can't play before hydration (decision 4). */
const playable = (el: ServerElement, to: Values.Values): Result.Result<{ readonly from: Values.Values; readonly to: Values.Values }, string> => playableMatch({ el, to })

/** {@link playable}'s cases, built once at module load: it runs per element (#69's PR 2). */
const playableMatch: (input: { readonly el: ServerElement; readonly to: Values.Values }) => Result.Result<{ readonly from: Values.Values; readonly to: Values.Values }, string> =
  Match.type<{ readonly el: ServerElement; readonly to: Values.Values }>().pipe(
    Match.when({ el: { appear: false } }, () => Result.fail("appear={false}")),
    Match.orElse(({ el, to }) =>
      Option.match(unplayable(el.initial, to), {
        onSome: (reason): Result.Result<{ readonly from: Values.Values; readonly to: Values.Values }, string> => Result.fail(reason),
        onNone: () => Result.succeed({ from: Rec.map(to, (target, key) => Option.getOrThrow(OwnValues.valueLike(el.initial[key] as number | string, target))), to }),
      })),
  )

/** Whether a user style sets an `animation` of its own: the element's one CSS animation would be taken. */
export const setsAnimation: (css: object | string | undefined) => boolean = Match.type<object | string | undefined>().pipe(
  Match.when(Predicate.isString, (text) => /(^|;)\s*animation(-name)?\s*:/i.test(text)),
  Match.when(Predicate.isObject, (record) => Bool.or(Object.hasOwn(record, "animation"), Object.hasOwn(record, "animationName"))),
  Match.orElse(() => false),
)

// --- The Handoff -------------------------------------------------------------------------------

/** An element's Appear animation, found at mount: the spine starts its first legs as far in as it has got. */
export interface Handoff {
  readonly animation: Animation
}

/** The element's Appear animation, if a server started one (decision 6). */
export const handoffOf = (element: Element): Option.Option<Handoff> => Option.map(Appear.find(element), (animation) => ({ animation }))

/**
 * How far into its own run the client's first legs start, in seconds, read at their first tick:
 * where the CSS has got, less what the CSS waited that the client waits for itself. The CSS waited
 * its `animation-delay` and its rule's hold; the client's legs hold their transition's delay
 * (`clientDelay`, the stagger in it). The difference is a `when` wait, which the client has already
 * waited.
 */
export const startAtOf = (handoff: Handoff, ownTransition: WardicTransition | undefined, clientDelay: number) => (): number =>
  Appear.elapsedOf(handoff.animation) - Appear.delayOf(handoff.animation) - heldInRule(ownTransition) + clientDelay
