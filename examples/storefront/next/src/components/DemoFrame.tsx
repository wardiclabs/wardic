"use client"
/** The live demo's frame: Replay remounts the demo, so its entrance plays again. */
import { Fragment, type ReactNode, useState } from "react"

export function DemoFrame({ children }: { readonly children: ReactNode }) {
  const [run, setRun] = useState(1)
  return (
    <section className="demo" aria-label="Demo">
      <div className="demo-bar">
        <span className="eyebrow">Live demo</span>
        <button className="button quiet" onClick={() => setRun(run + 1)}>
          Replay
        </button>
      </div>
      <Fragment key={run}>{children}</Fragment>
    </section>
  )
}
