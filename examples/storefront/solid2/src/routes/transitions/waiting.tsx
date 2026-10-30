import type { RouteSectionProps } from "@solidjs/router"
import { ExamplePage } from "~/components/ExamplePage.tsx"
import Waiting from "~/examples/waiting/Demo.tsx"

// A layout: its pages, the catalogue and each piece, are its outlet (`props.children`).
export default function Page(props: RouteSectionProps) {
  return <ExamplePage id="waiting" demo={() => <Waiting>{props.children}</Waiting>} />
}
