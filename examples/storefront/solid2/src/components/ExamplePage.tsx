/**
 * An example's page (#296 Q3): the live demo, a line on what reduced motion does to it, why it's
 * worth reaching for, then its code, a server component highlighted on the server.
 */
import { dynamic } from "@solidjs/web"
import { AREAS, DOCS_ORIGIN, DOCS_PAGES, exampleById } from "@wardic/example-storefront-shared/examples"
import { codeParts } from "@wardic/example-storefront-shared/format"
import { BACK } from "@wardic/example-storefront-shared/micro"
import { w } from "~/lib/wardic.ts"
import { type Component, createSignal, For, Loading, Show } from "solid-js"
import { codeFiles } from "~/server/code.tsx"

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

/** The demo's code, highlighted on the server. */
function CodePanel(props: { readonly id: string }) {
  // A server component: the server function returns a template, and `dynamic` renders it here.
  const CodeFiles = dynamic(() => codeFiles(props.id))
  return (
    <section class="code" aria-labelledby="code-title">
      <h2 id="code-title">The code</h2>
      <Loading fallback={<pre class="muted">Highlighting…</pre>}>
        <CodeFiles />
      </Loading>
    </section>
  )
}

/** An example's gains and costs (#526 Q6), where it has them: two short lists. */
function Tradeoffs(props: { readonly gains: ReadonlyArray<string>; readonly costs: ReadonlyArray<string> }) {
  return (
    <section class="tradeoffs" aria-label="Gains and costs">
      <div class="gains">
        <h3>Gains</h3>
        <ul>
          <For each={props.gains}>
            {(gain) => (
              <li>
                <Prose text={gain} />
              </li>
            )}
          </For>
        </ul>
      </div>
      <div class="costs">
        <h3>Costs</h3>
        <ul>
          <For each={props.costs}>
            {(cost) => (
              <li>
                <Prose text={cost} />
              </li>
            )}
          </For>
        </ul>
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
  const Demo = dynamic(() => props.demo)
  return (
    <main class="page example">
      <nav class="crumbs" aria-label="Breadcrumb">
        <w.a href="/" initial="rest" animate="rest" whileHover="hover" whileFocus="hover">
          <w.span class="glyph" variants={BACK}>
            ←
          </w.span>{" "}
          Examples
        </w.a>{" "}
        / {area.title}
      </nav>
      <header class="example-head">
        <div class="hero-badges">
          <p class="eyebrow">{area.title}</p>
          <span class="badge badge-binding">Solid 2</span>
        </div>
        <h1>{example.title}</h1>
        <p class="muted">{example.summary}</p>
        <ul class="tags">
          <For each={example.uses}>{(use) => <li>{use}</li>}</For>
        </ul>
      </header>
      {/* Packages not on npm yet (#934): the code below can't be installed until their release. */}
      <Show when={example.release}>
        {(release) => (
          <p class="note release-note">
            <strong>Ships in Wardic {release()}.</strong> The packages this page runs on aren't on npm yet: until then, it runs them from Wardic's repository.
          </p>
        )}
      </Show>
      <section class="demo" aria-label="Demo">
        <div class="demo-bar">
          <span class="eyebrow">Live demo</span>
          <button class="button quiet" onClick={() => setRun(run() + 1)}>
            Replay
          </button>
        </div>
        <Show when={run()} keyed>
          {(_run: number) => <Demo />}
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
        <Show when={example.tradeoffs}>{(tradeoffs) => <Tradeoffs gains={tradeoffs().gains} costs={tradeoffs().costs} />}</Show>
        {/* The docs' page on what it shows (#908). */}
        <p class="guide-link">
          In the docs: <a href={`${DOCS_ORIGIN}${example.docs}`}>{DOCS_PAGES[example.docs]}</a>
        </p>
      </section>
      <CodePanel id={props.id} />
    </main>
  )
}
