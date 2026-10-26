// A cart drawer, a server component: it starts the cart's read and the shop's, and hands their
// promises to the client part. A change to the cart refreshes the page, which reads the cart again.
import { getCart, listProducts } from "~/lib/store.ts"
import { CartDrawer } from "./Client.tsx"

export default function Demo() {
  return <CartDrawer cart={getCart()} products={listProducts()} />
}
