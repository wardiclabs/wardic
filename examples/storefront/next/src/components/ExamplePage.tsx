/**
 * An example's page (#366 Q8): the live demo, a line on what reduced motion does to it, what differs
 * from Wardic's, and its code, with links to the same example in the two Solid apps. A server
 * component.
 */
import { APPS, appUrl } from "@wardic/example-storefront-shared/apps"
import { AREAS, type Example, routeOf } from "@wardic/example-storefront-shared/examples"
import { codeParts } from "@wardic/example-storefront-shared/format"
import { headers } from "next/headers"
import { type ReactNode, Suspense } from "react"
import { BackLink } from "./BackLink.tsx"
import { CodeFiles } from "./CodeFiles.tsx"
import { DemoFrame } from "./DemoFrame.tsx"

/** An example's title, Motion's own where the example's doesn't hold for it (#387). */
export const titleOf = (example: Example): string => example.motion?.title ?? example.title

/** An example's summary, Motion's own where the example's doesn't hold for it. */
export const summaryOf = (example: Example): string => example.motion?.summary ?? example.summary

/** Text with `backticked` code. */
function Prose({ text }: { readonly text: string }) {
  return codeParts(text).map((part, i) => (part.code ? <code key={i}>{part.text}</code> : part.text))
}

/** An example's gains and costs (#526 Q6), where it has them: two short lists. */
function Tradeoffs({ gains, costs }: { readonly gains: ReadonlyArray<string>; readonly costs: ReadonlyArray<string> }) {
  return (
    <section className="tradeoffs" aria-label="Gains and costs">
      <div className="gains">
        <h3>Gains</h3>
        <ul>
          {gains.map((gain) => (
            <li key={gain}>
              <Prose text={gain} />
            </li>
          ))}
        </ul>
      </div>
      <div className="costs">
        <h3>Costs</h3>
        <ul>
          {costs.map((cost) => (
            <li key={cost}>
              <Prose text={cost} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/** An example's page around its demo: the example's `Demo`, or a layout's pages (#479). */
export async function ExamplePage({ example, children }: { readonly example: Example; readonly children: ReactNode }) {
  const area = AREAS.find((one) => one.id === example.area)
  if (area === undefined) throw new Error(`No area "${example.area}"`)
  // The Solid apps, on the host this page was asked for.
  const host = (await headers()).get("host")
  const wardic = [APPS.solid1, APPS.solid2].map((app) => ({ app, href: appUrl(app, routeOf(example), host, process.env) }))
  return (
    <main className="page example">
      <nav className="crumbs" aria-label="Breadcrumb">
        <BackLink /> / {area.title}
      </nav>
      <header className="example-head">
        <div className="hero-badges">
          <p className="eyebrow">{area.title}</p>
          <span className="badge badge-motion">Motion · Next.js</span>
        </div>
        <h1>{titleOf(example)}</h1>
        <p className="muted">{summaryOf(example)}</p>
        <p className="other-apps">
          With Wardic:{" "}
          {wardic.map(({ app, href }, i) => (
            <span key={app.id}>
              {i > 0 && " · "}
              <a href={href}>{app.label}</a>
            </span>
          ))}
        </p>
      </header>
      <DemoFrame>{children}</DemoFrame>
      <p className="note">
        <strong>Reduced motion:</strong> <Prose text={example.reducedMotion} />
      </p>
      {(example.motion !== undefined || example.tradeoffs !== undefined) && (
        <section className="why">
          <h2>Beside Wardic</h2>
          {example.motion !== undefined && (
            <p>
              <Prose text={example.motion.note} />
            </p>
          )}
          {/* Wardic's gains and costs (#526 Q6), where the example has them. */}
          {example.tradeoffs !== undefined && <Tradeoffs gains={example.tradeoffs.gains} costs={example.tradeoffs.costs} />}
        </section>
      )}
      <section className="code" aria-labelledby="code-title">
        <h2 id="code-title">The code</h2>
        <Suspense fallback={<pre className="muted">Highlighting…</pre>}>
          <CodeFiles id={example.id} />
        </Suspense>
      </section>
    </main>
  )
}
