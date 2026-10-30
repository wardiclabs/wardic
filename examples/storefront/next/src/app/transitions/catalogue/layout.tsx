/** The page-transitions example (#479): a layout whose pages, the catalogue and each piece, are its demo. */
import { exampleById } from "@wardic/example-storefront-shared/examples"
import { ExamplePage } from "~/components/ExamplePage.tsx"
import Catalogue from "~/examples/catalogue/Demo.tsx"

export default function Layout({ children }: LayoutProps<"/transitions/catalogue">) {
  const example = exampleById("catalogue")
  if (example === undefined) throw new Error('No example "catalogue"')
  return (
    <ExamplePage example={example}>
      <Catalogue>{children}</Catalogue>
    </ExamplePage>
  )
}
