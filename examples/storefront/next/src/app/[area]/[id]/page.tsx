/** Each example's page (#366): the examples this app has, at the Solid apps' routes (`/<area>/<id>`). */
import { exampleById } from "@wardic/example-storefront-shared/examples"
import { notFound } from "next/navigation"
import { ExamplePage } from "~/components/ExamplePage.tsx"
import { DEMOS } from "~/examples/index.ts"

export default async function Page({ params }: PageProps<"/[area]/[id]">) {
  const { area, id } = await params
  const example = exampleById(id)
  const demo = DEMOS[id]
  if (example === undefined || example.area !== area || demo === undefined) notFound()
  return <ExamplePage example={example} demo={demo} />
}
