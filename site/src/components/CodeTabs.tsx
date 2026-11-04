/**
 * A sample's code, in tabs (#558): one per binding it's written for (Solid 2, Solid 1, Motion), from
 * `samples/<name>/`, each highlighted at build, open on `show`'s tab (Solid 2's unless a page says).
 * Kobalte's tabs give the keyboard and the roles. Each sample's code is a chunk of its own, loaded by
 * the page that shows it: the server waits for it, and a page opened by a link loads it.
 */
import { Tabs } from "@kobalte/core/tabs"
import { createMemo, For, Loading } from "solid-js"

interface Highlighted {
  readonly path: string
  readonly html: string
}

const CODE = import.meta.glob<Highlighted>("../../samples/*/*.tsx", { query: "?code", import: "default" })

/** The bindings a sample can be written for, in the tabs' order: the site's own first. */
const BINDINGS = [
  { file: "solid2.tsx", label: "Solid 2" },
  { file: "solid1.tsx", label: "Solid 1" },
  { file: "motion.tsx", label: "Motion" },
] as const

/** A sample's files, each with its tab's label. */
const filesOf = (sample: string): Promise<ReadonlyArray<Highlighted & { readonly label: string }>> => {
  const present = BINDINGS.flatMap((binding) => {
    const load = CODE[`../../samples/${sample}/${binding.file}`]
    if (load === undefined) return []
    return [load().then((file) => ({ ...file, label: binding.label }))]
  })
  if (present.length === 0) throw new Error(`No sample "${sample}" in site/samples`)
  return Promise.all(present)
}

export function CodeTabs(props: { readonly sample: string; readonly show?: (typeof BINDINGS)[number]["label"] }) {
  const files = createMemo(() => filesOf(props.sample))
  return (
    <Loading fallback={<div class="code-tabs" aria-busy="true" />}>
      <Tabs class="code-tabs" defaultValue={props.show ?? "Solid 2"}>
        <Tabs.List class="code-tab-list" aria-label="The code in">
          <For each={files()}>
            {(file) => (
              <Tabs.Trigger class="code-tab" value={file.label}>
                {file.label}
              </Tabs.Trigger>
            )}
          </For>
        </Tabs.List>
        <For each={files()}>
          {(file) => (
            // Every panel stays mounted, the unselected ones hidden by the stylesheet: Kobalte's own
            // presence mounts the next before it removes the last, so both showed for a frame.
            <Tabs.Content class="code-tab-panel" value={file.label} forceMount>
              <div class="code-path">{file.path}</div>
              <div class="code-block" innerHTML={file.html} />
            </Tabs.Content>
          )}
        </For>
      </Tabs>
    </Loading>
  )
}
