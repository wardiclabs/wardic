/**
 * Wardic's docs site (#558): the router over the file routes, every page in the site's frame, under
 * one `WardicProvider`, which gives no Features: the frame's elements and the samples are Wardic
 * instances' (`lib/wardic.ts`), as an app's are (#516).
 */
import "./styles/site.css"
import { DomLive } from "@wardic/dom"
import { WardicProvider } from "@wardic/solid/unstable/v2"
import { Loading } from "solid-js"
import { Layout } from "~/components/Layout.tsx"
import { Router } from "~/router.ts"

export default function App() {
  return (
    <WardicProvider env={DomLive} strict>
      <Router>
        {(props) => (
          <Layout>
            <Loading>{props.children}</Loading>
          </Layout>
        )}
      </Router>
    </WardicProvider>
  )
}
