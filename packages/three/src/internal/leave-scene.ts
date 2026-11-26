/**
 * An object leaving its scene: out of its parent, then, with `dispose`, its geometries and materials, and
 * its descendants', disposed. A Scene object's and a scene Batch member's leave.
 *
 * @internal
 */
// ADR-0068 decision 9 (disposal opt-in), ADR-0073 decision 14. #981 (ADR-0074): an app's `removed` or
// `dispose` listener that throws skips no step, where before it skipped the disposal or every part after it.
import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import type { Object3D } from "three"

/**
 * `object` out of its parent and, with `dispose`, disposed. Every step runs though an app's listener
 * throws in one: the first throw comes out once they all have, for the caller to report.
 */
export const leaveScene = (object: Object3D, dispose: boolean): void => {
  let first: Option.Option<unknown> = Option.none()
  const keepFirst = (defect: unknown): void => {
    if (Option.isNone(first)) first = Option.some(defect)
  }
  try {
    object.removeFromParent()
  } catch (defect) {
    keepFirst(defect)
  }
  if (dispose) {
    object.traverse((node) => {
      const parts = node as unknown as { readonly geometry?: unknown; readonly material?: unknown }
      disposeOf(parts.geometry, keepFirst)
      Arr.forEach(Arr.ensure(parts.material), (material) => disposeOf(material, keepFirst))
    })
  }
  if (Option.isSome(first)) throw first.value
}

/** A part with a `dispose()`: a geometry, a material. */
const isDisposable: Predicate.Refinement<unknown, { readonly dispose: () => void }> = /*#__PURE__*/ Predicate.compose(
  /*#__PURE__*/ Predicate.hasProperty("dispose"),
  /*#__PURE__*/ Predicate.Struct({ dispose: Predicate.isFunction }),
) as Predicate.Refinement<unknown, { readonly dispose: () => void }>

/** `value`'s `dispose()`, when it has one, what it throws given to `thrown`. */
const disposeOf = (value: unknown, thrown: (defect: unknown) => void): void => {
  if (isDisposable(value)) {
    try {
      value.dispose()
    } catch (defect) {
      thrown(defect)
    }
  }
}
