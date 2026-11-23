/**
 * `TestStage` as a Stage (ADR-0073 decision 26): `@wardic/three/TestStage`'s scene on frames the test
 * pumps, with no renderer, that is also the `Stage` its hooks find. A test mounts its tree under it and
 * drives the scene through it:
 *
 * ```tsx
 * const stage = TestStage.make({ scene, camera, size: { width: 800, height: 600 } })
 * render(() => <WardicStage value={stage}><Crate mesh={crate} /></WardicStage>)
 * stage.pointer.over(crate)
 * stage.frame()
 * expect(crate.scale.x).toBeCloseTo(1.08)
 * ```
 *
 * @module
 */
// #885's PR 1 (ADR-0073, *Amendment (#885)*, Q10): the Solid entry's, so `@wardic/three/TestStage` stays free of Solid.
import type { Stage } from "@wardic/solid"
import * as UndefinedOr from "effect/UndefinedOr"
import * as Plain from "../TestStage.ts"
import { stageOver } from "./stage.ts"

export type { Options, TestPointer } from "../TestStage.ts"

/** A test's scene that's also a Stage: `@wardic/three/TestStage`'s, with the `Stage` the hooks under it find. */
export type TestStage = Plain.TestStage & Stage

/** A test's scene, on a stand-in canvas of `options.size`, that's also a Stage. */
export const make = (options: Plain.Options): TestStage => {
  const plain = Plain.make(options)
  // A TestStage is made with its stand-in canvas, so it always has its input.
  return { ...plain, ...stageOver(plain as never, UndefinedOr.getOrThrow(plain.input)) } as TestStage
}
