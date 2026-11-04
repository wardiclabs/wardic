/**
 * Wardic's docs site (#558): the router over the file routes, every page in the site's frame, under
 * one `WardicProvider`. The frame animates with the shell's Features: hover, press and focus, and
 * `layout` for the sidebar's marker, which slides to the page you're on.
 */
import "./styles/site.css"
import { DomLive } from "@wardic/dom"
import { domAnimation, layout, WardicProvider } from "@wardic/solid/unstable/v2"
import { Loading } from "solid-js"
import { Layout } from "~/components/Layout.tsx"
import { Router } from "~/router.ts"

const SHELL = [domAnimation, layout]

export default function App() {
  return (
    <WardicProvider env={DomLive} features={SHELL} strict>
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
