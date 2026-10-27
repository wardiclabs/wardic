// A size guide in Radix's dialog, a server component: it starts the shop's read and hands its
// promise to the client part.
import { listProducts } from "~/lib/store.ts"
import { SizeGuide } from "./Client.tsx"

export default function Demo() {
  return <SizeGuide pieces={listProducts()} />
}
