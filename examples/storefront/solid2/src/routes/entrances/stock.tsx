import { ExamplePage } from "~/components/ExamplePage.tsx"
import Stock from "~/examples/stock/Demo.tsx"

export default function Page() {
  return <ExamplePage id="stock" demo={Stock} />
}
