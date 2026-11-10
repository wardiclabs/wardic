/**
 * `createBatch()` on Solid 1 (#665): many elements on the same keys, animated as one Batch, for a
 * list, a grid or a chart's points that move together.
 *
 * @module
 */
import * as UndefinedOr from "effect/UndefinedOr"
import { createRenderEffect, type JSX, on, onCleanup, untrack } from "solid-js"
import { type BatchConfig, bindBatch, configTransitionOf, handlesOf, type Member, type MemberProps, registerBatch, serverHandle, type WardicBatchLanding } from "./batch.ts"
import { useWardicDefaultTransition, useWardicPositionalKeys, useWardicReducedMotion, useWardicRuntime, useWardicSkipAnimations } from "./provider.tsx"
import { isServer } from "./server.ts"
import { useWardicConfig } from "./wardic-config.tsx"

export type { WardicBatchKey, WardicBatchLanding, WardicBatchSegmentTarget, WardicBatchSegmentValue, WardicBatchStop, WardicBatchSubject, WardicBatchTarget, WardicBatchTransition, WardicBatchValues } from "./batch.ts"

/** `createBatch`'s config on Solid 1: the members, their targets and transition, and its callbacks. */
export interface WardicBatchConfig extends BatchConfig {
  /** Called as its members set off from rest, every one at rest before. */
  readonly onAnimationStart?: () => void
  /** Called once every member is at rest again, with how many set off. */
  readonly onAnimationComplete?: (landing: WardicBatchLanding) => void
}

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

/** A server render's Batch: its handles pass the element's own props on, and nothing animates. */
const serverBatch: WardicBatch = { at: serverHandle<JSX.CSSProperties>() }

/**
 * Animates many elements on the same keys as one Batch: `count` members, each given to `at(i)`'s
 * handle, turned toward `animate(i)` whenever what it reads changes, all in one run. For a list, a grid
 * or a chart's points: a change of a thousand members costs about what a change of one element does.
 * Its keys are the transforms and `opacity`; a member has no gestures, variants or layout of its own.
 * Call it in a component under a `WardicProvider`.
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
export function createBatch(config: WardicBatchConfig): WardicBatch {
  if (isServer) return serverBatch
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
  const grid: WardicBatch = { at: handlesOf<JSX.CSSProperties>(binding) }
  // Known to `createAnimate`'s `animate` (#665).
  registerBatch(grid, binding)
  return grid
}
