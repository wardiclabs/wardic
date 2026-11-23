/**
 * `createBatch` in a scene (#885's PR 5; ADR-0073 decision 16, *Amendment (#885)* Q9): a config with
 * `object` or `instances` goes to the Stage in context, whose `batch` adds, moves and removes its members.
 * Its landings and its members' gestures are told here, as a page's Batch's are, and its targets are read
 * by an effect's compute and handed over in its apply (ADR-0070 decision 11, Shape B).
 *
 * @module
 */
// #885's PR 5: the DOM's `createBatch` carries only the check that comes here.
import { isServer } from "@solidjs/web"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import { createEffect, DEV, onCleanup, untrack, useContext } from "solid-js"
import { flightsOf } from "./flights.ts"
import { CLIENT_ONLY } from "./solid-reactivity.ts"
import { type StageBatch, type StageBatchEvents, type StageCountBatchConfig, type StageKeyedBatchConfig, WardicStage } from "./stage.ts"
import { neverLands, serverWhen, Waiters, whenOf } from "./waiters.ts"

/** Whether a Batch's config is a scene's: its members `object`s or `instances`. */
export const isStageBatch = (config: object): boolean => Predicate.hasProperty(config, "object") || Predicate.hasProperty(config, "instances")

/** No Stage above that makes Batches. */
const NO_STAGE_BATCH =
  "createBatch({ object | instances }): no Stage above it makes a scene's Batches: put it under a <WardicStage value={stage}> whose Stage has `batch`. With `@wardic/three/solid`, give `createStage` the feature: `createStage({ …, features: [stageBatches] })`."

/** The gesture each event is: what asking for one watches. */
const GESTURE_OF: Readonly<Record<keyof StageBatchEvents, "hover" | "press" | undefined>> = {
  settled: undefined,
  hoverStart: "hover",
  hoverEnd: "hover",
  pressStart: "press",
  tap: "press",
  tapCancel: "press",
}

/** A Batch that moves nothing: a server's, where a scene draws nothing. */
const INERT: StageBatch = {
  settled: () => undefined,
  next: () => neverLands(),
  when: <E extends keyof StageBatchEvents>() => serverWhen<StageBatchEvents[E]>(),
}

/** A scene's Batch, made by the Stage in context. */
export const stageBatchOf = (config: StageKeyedBatchConfig<unknown> | StageCountBatchConfig): StageBatch => {
  if (isServer) return INERT
  const stage = useContext(WardicStage)
  const batch = UndefinedOr.match(Option.getOrUndefined(Option.fromNullishOr(stage)), { onUndefined: () => undefined, onDefined: (given) => given.batch })
  if (Predicate.isUndefined(batch)) {
    if (DEV) throw new Error(NO_STAGE_BATCH)
    return INERT
  }
  const flights = flightsOf<StageBatchEvents["settled"]>()
  const events = new Waiters<StageBatchEvents>("The Batch was disposed before its next event.")
  // Its first targets read untracked, wherever it's called: what tracks them is its own effect.
  const binding = untrack(() =>
    batch(config, {
      started: () => flights.started(),
      landed: (landing) => {
        flights.ended(landing)
        events.tell("settled", () => landing)
      },
      gesture: (name, info) => events.tell(name, () => info as never),
    }),
  )
  if (Predicate.isNotUndefined(config.whileHover)) binding.listen("hover")
  if (Predicate.isNotUndefined(config.whileTap)) binding.listen("press")
  /** Asking for `name`: its gesture watched from now on, if it's one. */
  const asked = (name: keyof StageBatchEvents): void => {
    UndefinedOr.map(GESTURE_OF[name], binding.listen)
  }
  // Applied from its first run, at mount: its members are its own to make, as a Scene object joins then.
  createEffect(binding.targetsOf, binding.apply, CLIENT_ONLY)
  onCleanup(() => {
    binding.dispose()
    events.dispose()
  })
  return {
    settled: flights.read,
    next: (name) => {
      asked(name)
      return events.wait(name)
    },
    when: (name) => {
      asked(name)
      return whenOf(events, name)
    },
  }
}
