// Tabs on a product page, a server component: it starts the piece's read and hands its promise to
// the client part.
import { getProduct } from "~/lib/store.ts"
import { ProductTabs } from "./Client.tsx"

export default function Demo() {
  return <ProductTabs piece={getProduct("lagoon-vase")} />
}
