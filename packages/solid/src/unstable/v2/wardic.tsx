/**
 * `wardic.<tag>` and `wardic.create` on Solid 2 (#209, ADR-0008, ADR-0045): the **Complete element**'s
 * component forms, every Feature brought with it (#511, ADR-0067), as Motion's `motion` is. How a
 * component is made, and what the forms share, is `element.tsx`'s; `w.tsx` holds the Slim element's.
 *
 * @module
 */
import type { JSX } from "@solidjs/web"
import { type Create, createOf, formOf, type WardicComponent } from "./element.tsx"
import { COMPLETE } from "./complete.ts"

export {
  type GivenWard,
  type WardicBeside,
  type WardicComponent,
  type WardicMotion,
  type WardicProps,
  type WardicWrappable,
  type WardicWrapped,
  type WardNodeKey,
  type WardRefCallback,
} from "./element.tsx"

/** `wardic.create(tag | Component)`: a Complete element's component (`element.tsx`'s `createWith`). */
export const create: Create = createOf(COMPLETE)

/** `wardic`: `wardic.create`, and `wardic.<tag>`, a component for that element (one per tag). */
export type Wardic = { readonly create: Create } & {
  readonly [Tag in keyof JSX.IntrinsicElements]: WardicComponent<Tag>
}

/**
 * The Complete element: `wardic.div` and every other tag, with every Feature whatever its section
 * gives, and `wardic.create(Component)`. Handy for trying something out, heavy for a page: under a
 * `strict` provider it throws in development. Motion's `motion.div`.
 *
 * @example <wardic.div drag whileHover={{ scale: 1.05 }} />
 * @see https://wardic.dev/reference/solid/elements/wardic
 */
// `wardic.<tag>` is cached, so `wardic.div === wardic.div` (ADR-0067: the Complete element).
export const wardic: Wardic = formOf<Wardic>(create, {})
