// The product grid, a server component: it starts the shop's read and hands its promise to the
// client part.
import { listProducts } from "~/lib/store.ts"
import { ProductGrid } from "./Client.tsx"

export default function Demo() {
  return <ProductGrid products={listProducts()} />
}
