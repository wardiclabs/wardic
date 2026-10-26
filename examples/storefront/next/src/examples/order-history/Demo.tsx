// Order history, a server component: it starts the two reads and hands their promises to the
// client part, which shows them as they arrive.
import { getOrders, listProducts } from "~/lib/store.ts"
import { OrderHistory } from "./Client.tsx"

export default function Demo() {
  return <OrderHistory orders={getOrders()} products={listProducts()} />
}
