"use server"
/**
 * The code panel, as a server component (#296 Q3): it highlights a demo's source on the server and
 * sends the markup, so the browser downloads neither the source nor the highlighter. The client
 * renders it through `dynamic` (`components/ExamplePage.tsx`).
 */
import { highlightOptions } from "@wardic/example-storefront-shared/code"
import { codeToHtml } from "shiki"

/** Each demo's source, read here on the server. */
const SOURCES = import.meta.glob<string>("../examples/*/Demo.tsx", { query: "?raw", import: "default", eager: true })

interface Highlighted {
  readonly path: string
  readonly html: string
}

const highlighted = async (path: string, source: string): Promise<Highlighted> => ({ path, html: await codeToHtml(source, highlightOptions(path)) })

function CodeFile(props: { readonly file: Highlighted }) {
  return (
    <div class="code-file">
      <header>{props.file.path}</header>
      <div innerHTML={props.file.html} />
    </div>
  )
}

export async function codeFiles(exampleId: string) {
  const source = SOURCES[`../examples/${exampleId}/Demo.tsx`]
  if (source === undefined) throw new Error(`No demo for "${exampleId}"`)
  const solid = await highlighted(`examples/${exampleId}/Demo.tsx`, source)
  return () => <CodeFile file={solid} />
}
