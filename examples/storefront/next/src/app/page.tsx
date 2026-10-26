/** The gallery (#296 Q3): each area, with its examples, in Motion. */
import { AREAS, examplesIn, routeOf } from "@wardic/example-storefront-shared/examples"
import { ExampleCard } from "~/components/ExampleCard.tsx"
import { summaryOf } from "~/components/ExamplePage.tsx"

export default function Home() {
  const areas = AREAS.map((area) => ({ area, examples: examplesIn(area.id) }))
  return (
    <main className="page">
      <section className="hero">
        <div className="hero-badges">
          <p className="eyebrow">The examples in</p>
          <span className="badge badge-motion">Motion · Next.js</span>
        </div>
        <h1>The shop&apos;s examples, as Motion would write them.</h1>
        <p>
          Each of Wardic&apos;s examples, written with <code>motion/react</code> on Next.js (App Router), running here. Every example&apos;s page in the Solid apps
          shows this code beside Wardic&apos;s, and links here to try it.
        </p>
      </section>
      {areas.map(({ area, examples }) => (
        <section key={area.id} className="area" aria-labelledby={`area-${area.id}`}>
          <div className="area-head">
            <h2 id={`area-${area.id}`}>{area.title}</h2>
            <p className="muted">{area.blurb}</p>
          </div>
          <div className="example-cards">
            {examples.map((example) => (
              <ExampleCard key={example.id} href={routeOf(example)} title={example.title} summary={summaryOf(example)} />
            ))}
          </div>
        </section>
      ))}
    </main>
  )
}
