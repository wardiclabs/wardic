// Notifications you swipe away, a server component: it starts the list's read and hands its
// promise to the client part. A dismissal refreshes the page, which reads the list again.
import { getNotices } from "~/lib/store.ts"
import { Notifications } from "./Client.tsx"

export default function Demo() {
  return <Notifications notices={getNotices()} />
}
