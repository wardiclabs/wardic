/**
 * An example's page (#296 Q3): the live demo, a line on what reduced motion does to it, why it's
 * worth reaching for, then its code, a server component highlighted on the server.
 */
import { Dynamic, dynamic } from "@solidjs/web"
import { AREAS, exampleById } from "@wardic/example-storefront-shared/examples"
import { codeParts } from "@wardic/example-storefront-shared/format"
import { type Component, createSignal, For, Loading, Show } from "solid-js"
import { codeFile } from "~/server/code.tsx"

/** Text with `backticked` code. */
export function Prose(props: { readonly text: string }) {
  return (
    <For each={codeParts(props.text)}>
      {(part) => (
        <Show when={part.code} fallback={part.text}>
          <code>{part.text}</code>
        </Show>
      )}
    </For>
  )
}

function CodePanel(props: { readonly id: string }) {
  // A server component: the server function returns a template, and `dynamic` renders it here.
  const CodeFile = dynamic(() => codeFile(props.id))
  return (
    <section class="code" aria-labelledby="code-title">
      <h2 id="code-title">The code</h2>
      <Loading fallback={<pre class="muted">Highlighting…</pre>}>
        <CodeFile />
      </Loading>
    </section>
  )
}

export function ExamplePage(props: { readonly id: string; readonly demo: Component }) {
  const example = exampleById(props.id)
  if (example === undefined) throw new Error(`No example "${props.id}"`)
  const area = AREAS.find((one) => one.id === example.area)
  if (area === undefined) throw new Error(`No area "${example.area}"`)
  // Replaying remounts the demo, so its entrance plays again.
  const [run, setRun] = createSignal(1)
  return (
    <main class="page example">
      <nav class="crumbs" aria-label="Breadcrumb">
        <a href="/">Examples</a> / {area.title}
      </nav>
      <header class="example-head">
        <p class="eyebrow">{area.title}</p>
        <h1>{example.title}</h1>
        <p class="muted">{example.summary}</p>
        <ul class="tags">
          <For each={example.uses}>{(use) => <li>{use}</li>}</For>
        </ul>
      </header>
      <section class="demo" aria-label="Demo">
        <div class="demo-bar">
          <span class="eyebrow">Live demo</span>
          <button class="button quiet" onClick={() => setRun(run() + 1)}>
            Replay
          </button>
        </div>
        <Show when={run()} keyed>
          {(_run: number) => <Dynamic component={props.demo} />}
        </Show>
      </section>
      <p class="note">
        <strong>Reduced motion:</strong> <Prose text={example.reducedMotion} />
      </p>
      <section class="why">
        <h2>Why</h2>
        <For each={example.why}>
          {(paragraph) => (
            <p>
              <Prose text={paragraph} />
            </p>
          )}
        </For>
      </section>
      <CodePanel id={props.id} />
    </main>
  )
}
