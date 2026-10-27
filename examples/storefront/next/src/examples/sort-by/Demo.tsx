// Sort the shop with Radix's select, a server component: it starts the shop's read and hands its
// promise to the client part.
import { listProducts } from "~/lib/store.ts"
import { SortBy } from "./Client.tsx"

export default function Demo() {
  return <SortBy pieces={listProducts()} />
}
