/**
 * `createBatch()` on Solid 2 (#665): Solid 1's, its landings an async value, `settled()`, as a ward's
 * are (ADR-0046), and its targets read by an effect's compute and handed over in its apply, so a
 * compute Solid runs without its apply writes nothing (ADR-0070 decision 11, Shape B).
 *
 * @module
 */
import { isServer } from "@solidjs/web"
import type { JSX } from "@solidjs/web"
import { type Accessor, createEffect, getOwner, onCleanup, untrack } from "solid-js"
import * as Bool from "effect/Boolean"
import * as Predicate from "effect/Predicate"
import {
  type BatchConfig,
  bindBatch,
  configTransitionOf,
  handlesOf,
  isKeyed,
  keyedHandlesOf,
  type KeyedBatchConfig,
  type Member,
  type MemberProps,
  registerBatch,
  serverHandle,
  type WardicBatchLanding,
} from "../../batch.ts"
import { flightsOf } from "./flights.ts"
import { useWardicDefaultTransition, useWardicPositionalKeys, useWardicReducedMotion, useWardicRuntime, useWardicSkipAnimations } from "./provider.tsx"
import { CLIENT_ONLY_DEFERRED } from "./solid-reactivity.ts"
import type { PresenceContextValue } from "../../presence-record.ts"
import { usePresenceContext } from "./presence.tsx"
import { useWardicConfig } from "./wardic-config.tsx"
import { neverLands, serverWhen, Waiters, whenOf } from "./waiters.ts"

export type { WardicBatchKey, WardicBatchExit, WardicBatchLanding, WardicBatchSegmentTarget, WardicBatchSegmentValue, WardicBatchStop, WardicBatchSubject, WardicBatchTarget, WardicBatchTransition, WardicBatchValues } from "../../batch.ts"

/** `createBatch`'s config on Solid 2: the members, their targets and their transition. */
export interface WardicBatchConfig extends BatchConfig {}

/** `createBatch`'s keyed config on Solid 2 (#665): a list's items, each a member by its key, their targets by item and index. */
export interface WardicKeyedBatchConfig<T> extends KeyedBatchConfig<T> {}

/** A Batch's events, by name, for `next` and `when`. */
export interface WardicBatchEvents {
  /** Every member at rest again: how many set off in the flight. */
  readonly settled: WardicBatchLanding
}

/** What a member's element takes beside its handle: its own `ref`, and its own `style`, as an object. */
export type WardicBatchMemberProps<E extends Element = HTMLElement> = MemberProps<E, JSX.CSSProperties>

/** A member's handle: spread it onto the member's element. */
export type WardicBatchMember<E extends Element = HTMLElement> = Member<E, JSX.CSSProperties>

/** A Batch's landings on Solid 2, by index or keyed. */
interface BatchLandings {
  /**
   * Its last landing, `undefined` before the first: an async value, pending while any member moves, so
   * `isPending(() => grid.settled())` reads "moving".
   */
  readonly settled: () => WardicBatchLanding | undefined
  /** A promise of its next landing; it rejects with an `AbortError` once the Batch is gone. */
  readonly next: <E extends keyof WardicBatchEvents>(name: E) => Promise<WardicBatchEvents[E]>
  /** Every landing from now on, for an effect: `createEffect(grid.when("settled"), (landing) => …)`. */
  readonly when: <E extends keyof WardicBatchEvents>(name: E) => Accessor<WardicBatchEvents[E]>
}

/** A Batch on Solid 2: its members' handles, and its landings. */
export interface WardicBatch extends BatchLandings {
  /**
   * Member `i`'s handle, to spread onto its element: the element's own `ref` and `style` given beside
   * it, its `style` without the properties the Batch draws.
   */
  readonly at: <E extends Element = HTMLElement>(i: number, props?: WardicBatchMemberProps<E>) => WardicBatchMember<E>
}

/** A keyed Batch on Solid 2: each item's member's handle, by its key, and its landings. */
export interface WardicKeyedBatch<K> extends BatchLandings {
  /**
   * The handle of the member keyed `key`, to spread onto its item's element: the element's own `ref` and
   * `style` given beside it, its `style` without the properties the Batch draws.
   */
  readonly member: <E extends Element = HTMLElement>(key: K, props?: WardicBatchMemberProps<E>) => WardicBatchMember<E>
}

/** A server render's keyed Batch: its handles pass the element's own props on, and nothing animates or lands. */
/**
 * The `<AnimatePresence>` a member's handle is made under: none outside an owner (a handle made in a
 * handler, or after an `await`), where Solid 2's context read throws.
 */
const presenceHere = (): PresenceContextValue | undefined => {
  if (Predicate.isNullish(getOwner())) return undefined
  return usePresenceContext()
}

const serverKeyedBatch: WardicKeyedBatch<unknown> = {
  member: serverHandle<JSX.CSSProperties>(),
  settled: () => undefined,
  next: () => neverLands(),
  when: <E extends keyof WardicBatchEvents>() => serverWhen<WardicBatchEvents[E]>(),
}

/** A server render's Batch: its handles pass the element's own props on, and nothing animates or lands. */
const serverBatch: WardicBatch = {
  at: serverHandle<JSX.CSSProperties>(),
  settled: () => undefined,
  next: () => neverLands(),
  when: <E extends keyof WardicBatchEvents>() => serverWhen<WardicBatchEvents[E]>(),
}

/**
 * Animates many elements on the same keys as one Batch: `count` members, each given to `at(i)`'s
 * handle, turned toward `animate(i)` whenever what it reads changes, all in one run. For a list, a grid
 * or a chart's points: a change of a thousand members costs about what a change of one element does.
 * Its keys are the transforms and `opacity`; a member has no gestures, variants or layout of its own.
 * Call it in a component under a `WardicProvider`.
 *
 * Keyed, it takes a list, `each`, and each item's `key`: an item's member enters as its element
 * arrives, from `initial`, and leaves as the item leaves the list. A change of the list, or of its
 * order, turns every member once, each toward `animate(item, i)` at its index now.
 *
 * @example
 * const list = createBatch({ each: () => todos(), key: "id", initial: { opacity: 0 }, animate: (_, i) => ({ y: i * 48, opacity: 1 }) })
 * <For each={todos()}>{(todo) => <li {...list.member(todo.id)}>{todo.title}</li>}</For>
 *
 * @example
 * const grid = createBatch({
 *   count: 100,
 *   animate: (i) => ({ x: (i % 10) * 48, y: Math.floor(i / 10) * 48 }),
 *   transition: { type: "spring", visualDuration: 0.4, bounce: 0.2, delay: stagger(0.005) },
 * })
 * <For each={cells}>{(i) => <div class="cell" {...grid.at(i)} />}</For>
 * <p>{isPending(() => grid.settled()) ? "Moving…" : "Ready"}</p>
 * @see https://wardic.dev/reference/solid/animation/create-batch
 */
// #665, ADR-0070 decisions 10–15 and *Amendment (#665)*.
export function createBatch<T, P extends keyof T>(config: WardicKeyedBatchConfig<T> & { readonly key: P }): WardicKeyedBatch<T[P]>
export function createBatch<T, K>(config: WardicKeyedBatchConfig<T> & { readonly key: (item: T) => K }): WardicKeyedBatch<K>
export function createBatch(config: WardicBatchConfig): WardicBatch
export function createBatch(config: WardicBatchConfig | WardicKeyedBatchConfig<unknown>): WardicBatch | WardicKeyedBatch<unknown> {
  const keyed = isKeyed(config)
  if (isServer) return Bool.match(keyed, { onTrue: () => serverKeyedBatch, onFalse: () => serverBatch })
  const configTransition = configTransitionOf(useWardicConfig())
  const flights = flightsOf<WardicBatchLanding>()
  const events = new Waiters<WardicBatchEvents>("The Batch was disposed before its next event.")
  // Its first targets and starts read untracked, wherever it's called: what tracks them is its own effect.
  const binding = untrack(() =>
    bindBatch(
      {
        runtime: useWardicRuntime(),
        reducedMotion: useWardicReducedMotion(),
        skipAnimations: useWardicSkipAnimations(),
        positionalKeys: useWardicPositionalKeys(),
        defaultTransition: useWardicDefaultTransition(),
        configTransition,
        untrack,
      },
      config,
      {
        started: () => flights.started(),
        landed: (landing) => {
          flights.ended(landing)
          events.tell("settled", () => landing)
        },
      },
    ))
  // Its first targets were read as it was made: from then on the compute reads them, and the apply,
  // which Solid runs only for a compute it keeps, turns every member.
  createEffect(binding.targetsOf, binding.apply, CLIENT_ONLY_DEFERRED)
  onCleanup(() => {
    binding.dispose()
    events.dispose()
  })
  const landings: BatchLandings = {
    settled: flights.read,
    next: (name) => events.wait(name),
    when: (name) => whenOf(events, name),
  }
  const grid: WardicBatch | WardicKeyedBatch<unknown> = Bool.match(keyed, {
    onTrue: (): WardicKeyedBatch<unknown> => ({ member: keyedHandlesOf<JSX.CSSProperties>(binding, presenceHere), ...landings }),
    onFalse: (): WardicBatch => ({ at: handlesOf<JSX.CSSProperties>(binding), ...landings }),
  })
  // Known to `createAnimate`'s `animate` (#665).
  registerBatch(grid, binding)
  return grid
}
