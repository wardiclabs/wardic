// A pointer the test pushes with its own timestamps, for the browser tests whose drags must not depend
// on when the runner's real mouse events land: H7, DR1 (#206), FL5 (#729) and the pushed drags of the
// gesture, layout and batch-driver tests (#734). Kept out of browser-helpers.ts, which every browser
// test imports, so only these load @wardic/test and DomLive through it.

import * as InputSource from "@wardic/core/InputSource"
import { DomLive } from "@wardic/dom"
import { TestInput } from "@wardic/test"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type { WardicEnv } from "../src/runtime.ts"

/** A pushed pointer: the Environment its events reach, and how to push them. */
export interface PushedPointer {
  /** The Environment with the pushed InputSource in it, for the `WardicProvider`'s `env`. */
  readonly env: WardicEnv
  /** Push a `type` event at `x` (`y` 0), `after` ms after the one before, or after 0 for the first. */
  readonly push: (type: InputSource.PointerLikeEvent["type"], x: number, after?: number) => void
}

/**
 * A pointer whose events the test pushes over `over` (`DomLive` by default), each `step` ms (20 by
 * default) after the one before unless its push says otherwise. Each pointer keeps its own time, from 0.
 */
export const pushedPointer = ({ step = 20, over = DomLive }: { readonly step?: number; readonly over?: WardicEnv } = {}): PushedPointer => {
  const input = Effect.runSync(TestInput.pushable())
  let t = 0
  return {
    env: input.layer.pipe(Layer.provideMerge(over)),
    push: (type, x, after = step) => {
      t += after
      Effect.runSync(input.push(InputSource.makePointerLikeEvent({ type, x, y: 0, timeStamp: t })))
    },
  }
}
