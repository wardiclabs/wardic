// A product that opens into its detail view, a server component: it starts the shop's read and
// hands its promise to the client part.
import { listProducts } from "~/lib/store.ts"
import { ProductDetail } from "./Client.tsx"

export default function Demo() {
  return <ProductDetail products={listProducts()} />
}
