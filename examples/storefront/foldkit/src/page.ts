/**
 * What an example's page is to the app (#795): a module with its first paint's `Data` and the `load`
 * that reads it from the `Shop` (on the server, for the Flags; in the browser, after a link), its own
 * Model, Messages, `update` and `view` as a Foldkit submodel, and the Messages it sends the app
 * (the cart changed, a piece on its way to it). The app keeps each page's Model under the route and
 * wraps its Messages. Each is typed by its three Schemas.
 */
import type * as Effect from "effect/Effect"
import type * as Schema from "effect/Schema"
import type { View as SubmodelView } from "foldkit/submodel"
import type { Subscriptions } from "foldkit/subscription"
import type * as Update from "foldkit/update"
import type * as Wardic from "@wardic/foldkit/Wardic"
import type { Cart } from "@wardic/example-storefront-shared/server"
import type { Shop, ShopError } from "~/shop.ts"

/**
 * What a page tells the app (Foldkit's OutMessage): the cart changed, so the header's count follows;
 * a piece is on its way to the cart's icon, its photo's twin to appear there (Saved for later, #526),
 * or the store refused it, so the twin goes and the photo flies back.
 */
export type PageOut =
  | { readonly _tag: "CartChanged"; readonly cart: Cart }
  | { readonly _tag: "Arriving"; readonly id: string; readonly src: string }
  | { readonly _tag: "Recalled"; readonly id: string }

export const cartChanged = (cart: Cart): PageOut => ({ _tag: "CartChanged", cart })
export const arriving = (id: string, src: string): PageOut => ({ _tag: "Arriving", id, src })
export const recalled = (id: string): PageOut => ({ _tag: "Recalled", id })

/**
 * What the app gives a page at each update and render: whether motion is reduced, by the system or
 * the header's switch (#388), the visitor's name, the piece under the example's route where the route
 * names one (the catalogue's), and the URL's query (the before-hydration page's `?hydrate=`).
 */
export interface PageEnv {
  readonly reduceMotion: boolean
  readonly visitorName: string
  readonly piece: string | null
  readonly query: string
}

/** What a page's Commands may reach: the store, and Wardic's service (`Wardic.animateLayout`, `Wardic.animate`). */
export type PageServices = Shop | Wardic.Wardic

/** What a page's `update` returns: its Model, its Commands, and what it tells the app. */
export type PageReturn<Model, Message> = Update.ReturnWithOutMessage<Model, Message, PageOut, PageServices>

/** A Message union's Schema, as `defineMessageUnion` makes one. */
export interface MessageSchema extends Schema.Top {
  readonly Type: { readonly _tag: string }
}

export interface Page<D extends Schema.Top, Mo extends Schema.Top, Me extends MessageSchema> {
  /** The example's id (`shared/src/examples.ts`). */
  readonly id: string
  /** What the page shows at first paint. JSON, since the server encodes it into the page: no `undefined` in it (a `NullOr`, not an `UndefinedOr`). */
  readonly Data: D
  readonly Model: Mo
  readonly Message: Me
  /** Reads `Data` from the store. */
  readonly load: Effect.Effect<D["Type"], ShopError, Shop>
  readonly init: (data: D["Type"]) => Mo["Type"]
  readonly update: (model: Mo["Type"], message: Me["Type"], env: PageEnv) => PageReturn<Mo["Type"], Me["Type"]>
  readonly view: SubmodelView<Mo["Type"], Me["Type"], PageEnv>
  readonly subscriptions?: Subscriptions<Mo["Type"], Me["Type"], PageServices> | undefined
}

/** A page, its types erased for the app's registry. */
// `any`: a page's `init` takes its own Data, which the registry can't name.
export type AnyPage = Page<any, any, any>

export const definePage = <D extends Schema.Top, Mo extends Schema.Top, Me extends MessageSchema>(page: Page<D, Mo, Me>): Page<D, Mo, Me> => page
