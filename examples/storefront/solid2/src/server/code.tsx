"use server"
/**
 * The code panel, as a server component (#296 Q3): it highlights a demo's source on the server and
 * sends the markup, so the browser downloads neither the source nor the highlighter. The client
 * renders it through `dynamic` (`components/ExamplePage.tsx`).
 */
import { codeToHtml } from "shiki"

/** Each demo's source, read here on the server. */
const SOURCES = import.meta.glob<string>("../examples/*/Demo.tsx", { query: "?raw", import: "default", eager: true })

/** Each Motion snippet (#296 Q4), typechecked against `motion` in the shared package. */
const MOTION = import.meta.glob<string>("../../../shared/motion/*.tsx", { query: "?raw", import: "default", eager: true })

/** A Motion snippet, highlighted, for an example's "Coming from Motion" panel. */
export async function motionFile(file: string) {
  const source = MOTION[`../../../shared/motion/${file}`]
  if (source === undefined) throw new Error(`No Motion snippet "${file}"`)
  const html = await codeToHtml(source, { lang: "tsx", themes: { light: "github-light", dark: "github-dark" }, defaultColor: false })
  return () => (
    <div class="code-file">
      <header>Motion (React): {file}</header>
      <div innerHTML={html} />
    </div>
  )
}

export async function codeFile(exampleId: string) {
  const source = SOURCES[`../examples/${exampleId}/Demo.tsx`]
  if (source === undefined) throw new Error(`No demo for "${exampleId}"`)
  const html = await codeToHtml(source, { lang: "tsx", themes: { light: "github-light", dark: "github-dark" }, defaultColor: false })
  return () => (
    <div class="code-file">
      <header>examples/{exampleId}/Demo.tsx</header>
      <div innerHTML={html} />
    </div>
  )
}
