import type { RouteSectionProps } from "@solidjs/router"
import { ExamplePage } from "~/components/ExamplePage.tsx"
import Catalogue from "~/examples/catalogue/Demo.tsx"

// A layout: its pages, the catalogue and each piece, are its outlet (`props.children`).
export default function Page(props: RouteSectionProps) {
  return <ExamplePage id="catalogue" demo={() => <Catalogue>{props.children}</Catalogue>} />
}
