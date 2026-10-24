/**
 * The wishlist every visitor shares, live (#296): its order now, then each change as it's made,
 * whoever made it. A live source is a read whose value changes: `live()` declares the server
 * function (its own module, the directive inside, as `live()` wants a server function reference).
 * Each reader holds one connection; the store's feed ends when the reader leaves.
 */
import { live } from "@solidjs/web/server-functions"
import * as Store from "@wardic/example-storefront-shared/server"
import { visitor } from "./visitor.ts"

export const sharedWishlistFeed = live(async function* () {
  "use server"
  yield* await Store.streamFor(visitor(), Store.wishlistChanges("shared"))
})
