/**
 * The DOM's Key rules, for the keys it blends by name. `visibility` keeps `display` and `visibility` at
 * their start until an animation's last frame when they're hiding the element, and `animatableNone`
 * grows a shadow, a filter or a fill from nothing when one end is empty. `all` is both, in the order
 * they're asked.
 *
 * @example
 * import * as DomKeyRules from "@wardic/dom/DomKeyRules"
 *
 * const registry = yield* InterpolatorRegistry.make(DomInterpolators.all, [DomKeyRules.visibility])
 */
// `@wardic/dom/DomKeyRules` (#132, ADR-0041): ADR-0015, ADR-0035.
export {
  keyRules as all,
  visibility,
  animatableNone,
} from "./internal/key-rules.ts"
