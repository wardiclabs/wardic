/**
 * An example's page (#296 Q3): the live demo, a line on what reduced motion does to it, why it's
 * worth reaching for, then its code, highlighted on the server.
 */
import { A, createAsync } from "@solidjs/router"
import { AREAS, exampleById } from "@wardic/example-storefront-shared/examples"
import { codeParts } from "@wardic/example-storefront-shared/format"
import { type Component, createSignal, For, Show, Suspense } from "solid-js"
import { Dynamic } from "solid-js/web"
import { highlighted } from "~/lib/store.ts"

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
  const html = createAsync(() => highlighted(props.id))
  return (
    <section class="code" aria-labelledby="code-title">
      <h2 id="code-title">The code</h2>
      <div class="code-file">
        <header>examples/{props.id}/Demo.tsx</header>
        <Suspense fallback={<pre>Highlighting…</pre>}>
          <div innerHTML={html()} />
        </Suspense>
      </div>
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
        <A href="/">Examples</A> / {area.title}
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
