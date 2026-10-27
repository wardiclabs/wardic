// A piece's details in Radix's tabs, a server component: it starts the piece's read and hands its
// promise to the client part.
import { getProduct } from "~/lib/store.ts"
import { DetailsTabs } from "./Client.tsx"

export default function Demo() {
  return <DetailsTabs piece={getProduct("moon-vase")} />
}
