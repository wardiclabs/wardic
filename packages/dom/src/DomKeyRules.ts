/**
 * The DOM's Key rules: `display` and `visibility` hold until the run's last Frame, and an empty end grows from its Animatable none (ADR-0015, ADR-0035).
 *
 * `@wardic/dom/DomKeyRules` (#132, ADR-0041).
 */
export {
  keyRules as all,
  visibility,
  animatableNone,
} from "./internal/key-rules.ts"
