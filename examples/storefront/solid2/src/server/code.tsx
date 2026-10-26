"use server"
/**
 * The code panel, as a server component (#296 Q3): it highlights a demo's source on the server and
 * sends the markup, so the browser downloads neither the source nor the highlighter. The client
 * renders it through `dynamic` (`components/ExamplePage.tsx`). Where the Next.js app has the
 * example in Motion (#366), its files sit beside the demo's, in a tab.
 */
import { getRequestEvent } from "@solidjs/web"
import { APPS, appUrl } from "@wardic/example-storefront-shared/apps"
import { highlightOptions, inShowingOrder } from "@wardic/example-storefront-shared/code"
import { exampleById, routeOf } from "@wardic/example-storefront-shared/examples"
import { For } from "solid-js"
import { codeToHtml } from "shiki"

/** Each demo's source, read here on the server. */
const SOURCES = import.meta.glob<string>("../examples/*/Demo.tsx", { query: "?raw", import: "default", eager: true })

/** Each example's Motion version (#366): every file in its folder in the Next.js app. */
const MOTION = import.meta.glob<string>("../../../next/src/examples/*/*.{ts,tsx}", { query: "?raw", import: "default", eager: true })
const MOTION_SRC = "../../../next/src/"

interface Highlighted {
  readonly path: string
  readonly html: string
}

const highlighted = async (path: string, source: string): Promise<Highlighted> => ({ path, html: await codeToHtml(source, highlightOptions(path)) })

/** An example's Motion files, by their path in the Next.js app, its `Demo.tsx` first: none until it has one. */
const motionOf = (exampleId: string): Promise<ReadonlyArray<Highlighted>> => {
  const keys = inShowingOrder(Object.keys(MOTION).filter((key) => key.startsWith(`${MOTION_SRC}examples/${exampleId}/`)))
  return Promise.all(keys.map((key) => highlighted(key.slice(MOTION_SRC.length), MOTION[key] as string)))
}

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
  const example = exampleById(exampleId)
  if (source === undefined || example === undefined) throw new Error(`No demo for "${exampleId}"`)
  const solid = await highlighted(`examples/${exampleId}/Demo.tsx`, source)
  const motion = await motionOf(exampleId)
  if (motion.length === 0) return () => <CodeFile file={solid} />
  // Motion's version runs in the Next.js app, on the host this page was asked for.
  const run = appUrl(APPS.next, routeOf(example), getRequestEvent()?.request.headers.get("host"), process.env)
  return () => (
    <>
      <div class="code-tabs" role="radiogroup" aria-label="The code in">
        <input type="radio" class="code-tab-solid" name="code" id="code-solid" checked />
        <label for="code-solid">Solid 2</label>
        <input type="radio" class="code-tab-motion" name="code" id="code-motion" />
        <label for="code-motion">Motion · Next.js</label>
      </div>
      <div class="code-pane code-pane-solid">
        <CodeFile file={solid} />
      </div>
      <div class="code-pane code-pane-motion">
        <For each={motion}>{(file) => <CodeFile file={file} />}</For>
        <a class="code-run" href={run}>
          Run Motion's version →
        </a>
      </div>
    </>
  )
}
