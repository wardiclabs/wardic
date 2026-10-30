import { CataloguePiece } from "~/examples/catalogue/Pages.tsx"

export default async function Page({ params }: PageProps<"/transitions/catalogue/[id]">) {
  return <CataloguePiece id={(await params).id} />
}
