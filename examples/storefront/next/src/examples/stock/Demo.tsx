// Stock that fills in as it arrives, a server component: it starts the first count and hands its
// promise to the client part.
import { getStock } from "~/lib/store.ts"
import { Stock } from "./Client.tsx"

export default function Demo() {
  return <Stock now={getStock("now")} />
}
