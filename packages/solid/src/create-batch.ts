/**
 * `createBatch()` on Solid 1 (#665): many elements on the same keys, animated as one Batch, for a
 * list, a grid or a chart's points that move together.
 *
 * @module
 */
import * as Bool from "effect/Boolean"
import * as UndefinedOr from "effect/UndefinedOr"
import { createRenderEffect, type JSX, on, onCleanup, untrack } from "solid-js"
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
} from "./batch.ts"
import { useWardicDefaultTransition, useWardicPositionalKeys, useWardicReducedMotion, useWardicRuntime, useWardicSkipAnimations } from "./provider.tsx"
import { isServer } from "./server.ts"
import { usePresenceContext } from "./presence.tsx"
import { useWardicConfig } from "./wardic-config.tsx"

export type { WardicBatchKey, WardicBatchExit, WardicBatchLanding, WardicBatchSegmentTarget, WardicBatchSegmentValue, WardicBatchStop, WardicBatchSubject, WardicBatchTarget, WardicBatchTransition, WardicBatchValues } from "./batch.ts"

/** A Batch's callbacks on Solid 1: a flight's start and its landing. */
interface BatchCallbacks {
  /** Called as its members set off from rest, every one at rest before. */
  readonly onAnimationStart?: () => void
  /** Called once every member is at rest again, with how many set off. */
  readonly onAnimationComplete?: (landing: WardicBatchLanding) => void
}

/** `createBatch`'s config on Solid 1 by index: `count` members, their targets and transition, and its callbacks. */
export interface WardicBatchConfig extends BatchConfig, BatchCallbacks {}

/**
 * `createBatch`'s keyed config on Solid 1 (#665): a list's items, each a member by its key, their
 * targets by item and index, its transition and callbacks.
 */
export interface WardicKeyedBatchConfig<T> extends KeyedBatchConfig<T>, BatchCallbacks {}

/** What a member's element takes beside its handle: its own `ref`, and its own `style`, as an object. */
export type WardicBatchMemberProps<E extends Element = HTMLElement> = MemberProps<E, JSX.CSSProperties>

/** A member's handle: spread it onto the member's element. */
export type WardicBatchMember<E extends Element = HTMLElement> = Member<E, JSX.CSSProperties>

/** A Batch on Solid 1: its members' handles. */
export interface WardicBatch {
  /**
   * Member `i`'s handle, to spread onto its element: the element's own `ref` and `style` given beside
   * it, its `style` without the properties the Batch draws.
   */
  readonly at: <E extends Element = HTMLElement>(i: number, props?: WardicBatchMemberProps<E>) => WardicBatchMember<E>
}

/** A keyed Batch on Solid 1: each item's member's handle, by its key. */
export interface WardicKeyedBatch<K> {
  /**
   * The handle of the member keyed `key`, to spread onto its item's element: the element's own `ref` and
   * `style` given beside it, its `style` without the properties the Batch draws.
   */
  readonly member: <E extends Element = HTMLElement>(key: K, props?: WardicBatchMemberProps<E>) => WardicBatchMember<E>
}

/** A server render's Batch: its handles pass the element's own props on, and nothing animates. */
const serverBatch: WardicBatch = { at: serverHandle<JSX.CSSProperties>() }

/** A server render's keyed Batch: its handles pass the element's own props on, and nothing animates. */
const serverKeyedBatch: WardicKeyedBatch<unknown> = { member: serverHandle<JSX.CSSProperties>() }

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
 * @see https://wardic.dev/reference/solid/animation/create-batch
 */
// #665, ADR-0070 decisions 10–15 and *Amendment (#665)*. Solid 1 has no async values, so a flight's start
// and its landing are callbacks, as a Wardic element's `onAnimationStart` and `onAnimationComplete` are.
export function createBatch<T, P extends keyof T>(config: WardicKeyedBatchConfig<T> & { readonly key: P }): WardicKeyedBatch<T[P]>
export function createBatch<T, K>(config: WardicKeyedBatchConfig<T> & { readonly key: (item: T) => K }): WardicKeyedBatch<K>
export function createBatch(config: WardicBatchConfig): WardicBatch
export function createBatch(config: WardicBatchConfig | WardicKeyedBatchConfig<unknown>): WardicBatch | WardicKeyedBatch<unknown> {
  const keyed = isKeyed(config)
  if (isServer) return Bool.match(keyed, { onTrue: () => serverKeyedBatch, onFalse: () => serverBatch })
  const configTransition = configTransitionOf(useWardicConfig())
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
        started: () => UndefinedOr.map(config.onAnimationStart, (call) => call()),
        landed: (landing) => UndefinedOr.map(config.onAnimationComplete, (call) => call(landing)),
      },
    ))
  // Its first targets were read as it was made: a change from then on is a Retarget of every member.
  createRenderEffect(on(binding.targetsOf, binding.apply, { defer: true }))
  onCleanup(binding.dispose)
  const grid: WardicBatch | WardicKeyedBatch<unknown> = Bool.match(keyed, {
    onTrue: (): WardicKeyedBatch<unknown> => ({ member: keyedHandlesOf<JSX.CSSProperties>(binding, usePresenceContext) }),
    onFalse: (): WardicBatch => ({ at: handlesOf<JSX.CSSProperties>(binding) }),
  })
  // Known to `createAnimate`'s `animate` (#665).
  registerBatch(grid, binding)
  return grid
}
