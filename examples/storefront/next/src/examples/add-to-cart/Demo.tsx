// Add to cart, a server component: it starts the piece's read and hands its promise to the client part.
import { getProduct } from "~/lib/store.ts"
import { AddToCart } from "./Client.tsx"

export default function Demo() {
  return <AddToCart piece={getProduct("poppy-plate")} />
}
