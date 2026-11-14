/**
 * A sample, running (#558): `samples/<name>/solid2.tsx`'s default export, on the site's own Wardic, or
 * its `demo.tsx`'s when it has one (#665's PR 7, Q24), a page's own wrapping of the sample. It loads
 * once its frame scrolls into view, which a ward on the frame hears (`when("viewportEnter")`), so a
 * page ships no demo's code until it's wanted. Replay mounts it again, so its entrance plays again.
 * A demo that fails to load or render says so in its frame, and the page around it stays.
 * The samples shown only as code, such as a test or an app's setup, aren't demos and aren't built.
 */
import { dynamic } from "@solidjs/web"
import { w } from "~/lib/wardic.ts"
import type { Component } from "solid-js"
import { createEffect, createMemo, createSignal, Errored, For, Loading, Show } from "solid-js"
import { demoFileOf } from "~/components/demo-file.ts"
import { Failed } from "~/components/Failed.tsx"

const DEMOS = import.meta.glob<{ readonly default: Component }>([
  "../../samples/*/{demo,solid2}.tsx",
  "!../../samples/{testing,observability}/*",
])

/** A sample's demo: its `demo.tsx`'s default export when it has one, else its Solid 2 file's. */
const demoOf = async (sample: string): Promise<Component> => {
  const file = demoFileOf(sample, (path) => path in DEMOS)
  if (file === undefined) throw new Error(`No Solid 2 sample "${sample}" in site/samples`)
  return (await DEMOS[file]()).default
}

export function Demo(props: { readonly sample: string }) {
  const [seen, setSeen] = createSignal(false)
  const [run, setRun] = createSignal(1)
  // The frame's ward listens for its entry into view, a little before it's on screen.
  const frame = w.ward({ viewport: { once: true, margin: "200px" } })
  createEffect(frame.when("viewportEnter"), () => {
    setSeen(true)
  })
  // Loaded in the browser only, once it's in view: never on the server, which couldn't send it.
  const demo = createMemo(() => (seen() ? demoOf(props.sample) : undefined))
  // Rendered again from scratch each Replay (#618, S2: `dynamic()` in place of the deprecated `<Dynamic>`).
  const Shown = dynamic(() => demo())
  return (
    <div class="demo" {...frame}>
      <div class="demo-bar">
        <span class="demo-label">Live demo</span>
        <button class="demo-replay" type="button" onClick={() => setRun(run() + 1)}>
          Replay
        </button>
      </div>
      <div class="demo-stage">
        <Show when={seen()}>
          {/* #618 (S3): with no boundary, a demo's error reached the page's. */}
          <Errored fallback={(error, reset) => <Failed what="The demo" error={error()} retry={reset} />}>
            <Loading>
              <For each={[run()]}>{() => <Shown />}</For>
            </Loading>
          </Errored>
        </Show>
      </div>
    </div>
  )
}
