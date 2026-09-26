/**
 * The lab shell: a header with the scheduler mode, the scenario cards, and a
 * sidebar with the flash counter, the timeline, the frame-stretch control and the
 * copy-log.
 *
 * Layout isolation: the cards scroll with the page (Wardic folds page scroll out
 * of its measurements, so scrolling between runs never seeds a spurious FLIP), and
 * the sidebar is a separate fixed-width sticky column that scrolls on its own. No
 * panel update can move or resize a `.stage`: panels live in the sidebar, and each
 * card's result row has a fixed height.
 *
 * Reactivity: every signal here is written from `lab.subscribe` (once per
 * completed run) or from user input, never per frame. Props passed down are
 * static values, kept reactive by Solid's prop getters.
 *
 * @module
 */
import { WardicProvider } from "@wardic/solid"
import { batch, createSignal, For, type JSX, onCleanup } from "solid-js"
import { makeLabEnv } from "../env.ts"
import type { Lab } from "../lab/lab.ts"
import { currentLabScheduler } from "../probe/timeline.ts"
import { CopyLog } from "./CopyLog.tsx"
import { FlashCounter } from "./FlashCounter.tsx"
import { FrameStretch } from "./FrameStretch.tsx"
import { ScenarioCard } from "./ScenarioCard.tsx"
import { TimelinePanel, type TimelineSelection } from "./TimelinePanel.tsx"

/** How far before the trigger a run's captured timeline slice reaches, in ms. */
const WINDOW_LEAD_MS = 50

/** Renders the whole lab. */
export const App = (props: { readonly lab: Lab }): JSX.Element => {
  const lab = props.lab
  // Built once: WardicProvider reads `env` a single time.
  const env = makeLabEnv(lab.timeline)

  // Each scenario's last run, with the timeline slice captured when it ended (so
  // an older run stays drawable after the ring buffers move on).
  const [lastRuns, setLastRuns] = createSignal<Readonly<Record<string, TimelineSelection>>>({})
  const [latestId, setLatestId] = createSignal<string | undefined>(undefined)
  // The card picked for the timeline; `undefined` follows the latest run.
  const [pickedId, setPickedId] = createSignal<string | undefined>(undefined)
  const [counts, setCounts] = createSignal(lab.flashCounts())
  const [stretchMs, setStretchMs] = createSignal(0)

  onCleanup(
    lab.subscribe((run) => {
      const window = lab.timeline.window(run.triggerAt - WINDOW_LEAD_MS, run.endedAt)
      batch(() => {
        setLastRuns((prev) => ({ ...prev, [run.scenarioId]: { run, window } }))
        setLatestId(run.scenarioId)
        setCounts(lab.flashCounts())
      })
    }),
  )

  const shownId = (): string | undefined => pickedId() ?? latestId()
  const selection = (): TimelineSelection | undefined => {
    const id = shownId()
    return id === undefined ? undefined : lastRuns()[id]
  }

  const resetCounts = (): void => {
    lab.resetCounts()
    setCounts(lab.flashCounts())
  }

  return (
    <WardicProvider env={env}>
      <div class="lab">
        <LabHeader />
        <main class="cards">
          <For each={lab.scenarios}>
            {(def) => (
              <ScenarioCard
                def={def}
                ctx={lab.context(def)}
                lastRun={lastRuns()[def.id]?.run}
                selected={shownId() === def.id}
                onSelect={() => setPickedId(def.id)}
              />
            )}
          </For>
        </main>
        <aside class="sidebar">
          <FlashCounter scenarios={lab.scenarios} counts={counts()} onReset={resetCounts} />
          <TimelinePanel
            selection={selection()}
            following={pickedId() === undefined}
            onFollowLatest={() => setPickedId(undefined)}
          />
          <FrameStretch ticker={lab.ticker} value={stretchMs()} onChange={(ms) => setStretchMs(ms)} />
          <CopyLog lab={lab} frameStretchMs={stretchMs()} />
        </aside>
      </div>
    </WardicProvider>
  )
}

/**
 * The header: what the lab is for, the active scheduler mode, and a link that
 * reloads the page in the other mode (the mode is fixed per page load, because
 * Effect picks its scheduler when its module is first evaluated).
 */
const LabHeader = (): JSX.Element => {
  const mode = currentLabScheduler()
  const path = location.pathname
  return (
    <header class="lab-header">
      <div class="lab-heading">
        <h1>Wardic layout lab</h1>
        <p>
          Does each layout-trigger path paint the destination box before Wardic's measure pass? Press Run on a card.
        </p>
      </div>
      <div class="lab-scheduler">
        <span class={`pill scheduler-${mode}`}>
          {mode === "microtask" ? "scheduler: microtask (test-harness timing)" : "scheduler: default (real-app timing)"}
        </span>
        <a class="lab-switch" href={mode === "microtask" ? path : `${path}?scheduler=microtask`}>
          {mode === "microtask" ? "Reload with real-app timing" : "Reload with test-harness timing"}
        </a>
      </div>
    </header>
  )
}
