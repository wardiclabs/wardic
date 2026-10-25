import { ExamplePage } from "~/components/ExamplePage.tsx"
import BeforeHydration from "~/examples/before-hydration/Demo.tsx"

export default function Page() {
  return <ExamplePage id="before-hydration" demo={BeforeHydration} />
}
