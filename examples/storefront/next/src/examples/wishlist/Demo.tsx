// The shared wishlist, a server component: it starts the list's first read and the visitor's name,
// and hands their promises to the client part, which follows the list live from there.
import { getSharedWishlist, getVisitorName } from "~/lib/store.ts"
import { SharedWishlist } from "./Client.tsx"

export default function Demo() {
  return <SharedWishlist first={getSharedWishlist()} me={getVisitorName()} />
}
