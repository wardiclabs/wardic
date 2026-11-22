/**
 * The property writer: Wardic's values written onto a plain object's properties, by their names, as
 * they are (`object[key] = value`), once a frame, in the frame that computed them. `layer` is what
 * `WardicObject` provides; `GATE` is what its Flush gate reads of an object.
 *
 * @example
 * import * as ObjectRenderer from "@wardic/object/ObjectRenderer"
 *
 * ObjectRenderer.commit(material, { opacity: 0.5 }) // material.opacity === 0.5
 */
// `@wardic/object/ObjectRenderer` (#882, ADR-0068 decision 2; ADR-0073, *Amendment (#882)*, Q5): core's
// `Renderer`, as ADR-0041 names an Environment's implementations. No grouping: `x` is the property `x`
// (three's keys are `@wardic/three`'s, step 2).
import * as Renderer from "@wardic/core/Renderer"
import type * as FlushGate from "@wardic/core/unstable/FlushGate"
import * as Layer from "effect/Layer"

/**
 * What the gate saves of a property before its first write, to put back if the key ever drops out:
 * nothing. A plain object's values stay where Wardic leaves them, so a commit skips a key given this.
 */
const NOTHING_SAVED = ""

/** A plain object's patch: its values as they are, one property each. */
export const project = (values: Readonly<Record<string, unknown>>): Renderer.Patch => values as Renderer.Patch

/** `patch` written onto `target`'s properties: each key's value, a key the gate puts back with nothing saved left as it is. */
// Per frame: a plain loop over the patch's keys.
export const commit = (target: unknown, patch: Renderer.Patch): void => {
  const object = target as Record<string, unknown>
  for (const key in patch) {
    const value = patch[key]
    if (value === NOTHING_SAVED) continue
    object[key] = value
  }
}

/** The Flush gate's reads of an object: nothing saved before a write, and a template key no object has. */
export const GATE: FlushGate.GateEnvironment = { valueBeforeOf: () => NOTHING_SAVED, templateKey: "@wardic/object/template" }

/** The property writer as the Environment's `Renderer`. */
export const layer: Layer.Layer<Renderer.Renderer> = /*#__PURE__*/ Layer.succeed(Renderer.Renderer, { project, commit })
