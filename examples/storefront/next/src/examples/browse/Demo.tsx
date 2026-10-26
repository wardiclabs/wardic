// The shop, filtered and switched between views, a server component: it starts the shop's read and
// hands its promise to the client part.
import { listProducts } from "~/lib/store.ts"
import { Browse } from "./Client.tsx"

export default function Demo() {
  return <Browse products={listProducts()} />
}
