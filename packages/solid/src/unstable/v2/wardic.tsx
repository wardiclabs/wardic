/**
 * `wardic.<tag>` and `wardic.create` on Solid 2 (#209, ADR-0008, ADR-0045): the **Complete element**'s
 * component forms, every Feature brought with it (#511, ADR-0067), as Motion's `motion` is. How a
 * component is made, and what the forms share, is `element.tsx`'s; `w.tsx` holds the Slim element's.
 *
 * @module
 */
import type { JSX } from "@solidjs/web"
import { type Create, createOf, formOf, type WardicComponent } from "./element.tsx"
import { COMPLETE } from "./ward.tsx"

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

/** `wardic.<tag>` (cached, so `wardic.div === wardic.div`) and `wardic.create`: the Complete element's. */
export const wardic: Wardic = formOf<Wardic>(create, {})
