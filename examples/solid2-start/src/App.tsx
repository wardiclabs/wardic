// The app root: the router, with every page under one `<Loading>` (a page waiting on data shows the
// fallback the first time).
import { Loading } from "solid-js"
import { Router } from "./router.ts"

export default function App() {
  return <Router>{(props) => <Loading fallback={<main>Loading…</main>}>{props.children}</Loading>}</Router>
}
