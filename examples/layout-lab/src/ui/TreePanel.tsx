/**
 * The projection tree panel (#384): the engine's tree drawn with Mermaid, as the last recording left
 * it, scrubbed state by state, or as it is now, at rest.
 *
 * - **What it shows:** a recording's trees that changed (a scene's nodes make their own tree), or
 *   every tree. A Lead's edge to each Follower is labelled; a parent's is a plain arrow.
 * - **When it draws:** only from here, once a recording has ended or on a press. Nothing is drawn
 *   while a run records, so its frame checks are untouched (`lab/tree-recorder.ts`).
 * - **Mermaid** is a lab-only dependency, loaded the first time the panel draws. **Copy Mermaid**
 *   copies the text, for an issue (GitHub draws it).
 *
 * Both builds share it, so its state is plain and one signal re-renders it: on Solid 2 a signal reads
 * its last flushed value, and the drawing reads the state as it is now.
 *
 * @module
 */
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import { type JSX, useWardicProjection } from "#binding"
import { createSignal, onCleanup, Show } from "solid-js"
import { changedIds, mermaidOf, parentCycle, treesHolding } from "../lab/tree.ts"
import type { TreeRecorder, TreeRecording } from "../lab/tree-recorder.ts"

type Tree = ProjectionSystem.Tree

/** Mermaid, loaded the first time the panel draws. */
let mermaidLoad: Promise<(typeof import("mermaid"))["default"]> | undefined
const loadMermaid = (): Promise<(typeof import("mermaid"))["default"]> => {
  mermaidLoad ??= import("mermaid").then(({ default: mermaid }) => {
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "default" })
    return mermaid
  })
  return mermaidLoad
}
let renders = 0

/**
 * Reads the provider's engine into `tree`. Mount it under the `WardicProvider`. The engine is the
 * `layout` Feature's, among its own services, not the provider's runtime's (#511, #548): the binding's
 * `useWardicProjection` reads it there, building the Feature if nothing has yet (#681).
 */
export const TreeSource = (props: { readonly tree: TreeRecorder }): JSX.Element => {
  const system = useWardicProjection()
  onCleanup(props.tree.attach(() => system.toJSON()))
  return null
}

interface PanelState {
  open: boolean
  recording: TreeRecording | undefined
  index: number
  all: boolean
  atRest: Tree | undefined
  note: string
}

export const TreePanel = (props: { readonly tree: TreeRecorder }): JSX.Element => {
  const last = props.tree.last()
  const state: PanelState = { open: false, recording: last, index: (last?.states.length ?? 1) - 1, all: false, atRest: undefined, note: "" }
  const [version, bump] = createSignal(0)
  const view = (): PanelState => {
    version()
    return state
  }
  let diagram: HTMLDivElement | undefined

  const shown = (): Tree | undefined => state.atRest ?? state.recording?.states[state.index]?.snapshot
  /** The trees the recording changed, unless every tree is asked for or the tree now is shown. */
  const kept = (): ReadonlySet<string> | undefined => {
    const snapshot = shown()
    if (state.all || state.atRest !== undefined || state.recording === undefined || snapshot === undefined) return undefined
    return treesHolding(snapshot, changedIds(state.recording.states.map((s) => s.snapshot)))
  }
  const text = (): string | undefined => {
    const snapshot = shown()
    return snapshot === undefined ? undefined : mermaidOf(snapshot, kept())
  }

  const draw = (): void => {
    const target = diagram
    if (!state.open || target === undefined) return
    const source = text()
    const snapshot = shown()
    if (source === undefined || snapshot === undefined) {
      target.replaceChildren()
      return
    }
    state.note = parentCycle(snapshot) ? "The parent links make a cycle." : ""
    void loadMermaid()
      .then((mermaid) => mermaid.render(`lab-tree-${++renders}`, source))
      .then(
        ({ svg }) => {
          target.innerHTML = svg
        },
        (error: unknown) => {
          state.note = `Mermaid couldn't draw it: ${String(error)}`
          bump((v) => v + 1)
        },
      )
  }
  /** Change the panel's state, re-render it, and redraw. */
  const update = (patch: Partial<PanelState>): void => {
    Object.assign(state, patch)
    draw()
    bump((v) => v + 1)
  }

  onCleanup(props.tree.subscribe((recording) => update({ recording, index: recording.states.length - 1, atRest: undefined })))

  const copy = (): void => {
    const source = text()
    if (source === undefined) return
    if (typeof navigator.clipboard?.writeText !== "function") return update({ note: "No clipboard here: the text is in the console." })
    console.log(source)
    navigator.clipboard.writeText(source).then(
      () => update({ note: "Copied the Mermaid text." }),
      () => update({ note: "Copying failed: the text is in the console." }),
    )
  }

  const stateLine = (): string => {
    const { recording, index, atRest } = view()
    if (atRest !== undefined) return "The tree now, at rest."
    if (recording === undefined) return "No recording yet: run a scenario, or take the tree now."
    const s = recording.states[index]!
    const from = recording.states[0]!.at
    return `State ${index + 1} of ${recording.states.length} · frames ${s.fromFrame}–${s.toFrame} · +${Math.round(s.at - from)} ms`
  }

  return (
    <section class="panel tree-panel">
      <header class="panel-head">
        <h2>Projection tree</h2>
        <button type="button" class="btn secondary small" onClick={() => update({ open: !state.open })}>
          {view().open ? "Hide" : "Show"}
        </button>
      </header>
      <Show when={view().open}>
        <div class="panel-actions">
          <button type="button" class="btn secondary small" onClick={() => update({ atRest: props.tree.now() })}>
            Tree now
          </button>
          <button type="button" class="btn secondary small" onClick={copy} disabled={view().recording === undefined && view().atRest === undefined}>
            Copy Mermaid
          </button>
          <label class="tree-all">
            <input type="checkbox" checked={view().all} onChange={(event) => update({ all: event.currentTarget.checked })} />
            every tree
          </label>
        </div>
        <Show when={view().recording !== undefined && view().atRest === undefined}>
          <input
            class="tree-scrub"
            type="range"
            min="0"
            max={(view().recording?.states.length ?? 1) - 1}
            value={view().index}
            onInput={(event) => update({ index: Number(event.currentTarget.value) })}
            aria-label="Step through the recording's states"
          />
        </Show>
        <p class="panel-note">{stateLine()}</p>
        <Show when={view().note !== ""}>
          <p class="panel-note">{view().note}</p>
        </Show>
      </Show>
      <div
        class="tree-diagram"
        ref={(el: HTMLDivElement) => {
          diagram = el
        }}
        hidden={!view().open}
      />
    </section>
  )
}
