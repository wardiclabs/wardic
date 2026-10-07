// SVG animation (ADR-0014) end-to-end through the `wardic.*` proxy in a REAL
// browser: `wardic.circle`/`rect`/`path` create real SVGElements (Solid's Dynamic
// namespaces SVG tags), and the signal-sink routes each frame to the right DOM
// channel — geometry/colour → setAttribute, transform → CSS style w/ transform-box.
import { cleanup, render } from "@solidjs/testing-library"
import { wardic, WardicProvider } from "@wardic/solid"
import { DomLive } from "@wardic/dom"
import { afterEach, expect, it } from "vitest"
import { until } from "./browser-helpers.ts"
import { sampleFrames } from "./reorder-harness.tsx"

afterEach(cleanup)

it("animates an SVG geometry attribute (cx) as an ATTRIBUTE, never an inline style", async () => {
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <svg width="200" height="200">
        <wardic.circle data-c cx={10} cy={50} r={20} initial={{ cx: 10 }} animate={{ cx: 80 }} />
      </svg>
    </WardicProvider>
  ))
  const circle = container.querySelector("[data-c]") as SVGCircleElement
  expect(circle).toBeInstanceOf(SVGElement) // proxy produced a real SVG element
  await until(() => Math.abs(Number(circle.getAttribute("cx")) - 80) < 1)
  expect(Number(circle.getAttribute("cx"))).toBeGreaterThan(79)
  expect(circle.style.getPropertyValue("cx")).toBe("") // routed as an attribute, not style
})

it("applies an SVG transform as a CSS transform with transform-box: fill-box", async () => {
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <svg width="200" height="200">
        <wardic.rect data-r x={10} y={10} width={40} height={40} animate={{ rotate: 45 }} />
      </svg>
    </WardicProvider>
  ))
  const rect = container.querySelector("[data-r]") as SVGRectElement
  await until(() => rect.style.transform.includes("rotate(45"))
  expect(rect.style.getPropertyValue("transform-box")).toBe("fill-box")
  expect(rect.style.getPropertyValue("transform-origin")).toContain("50%")
})

it("animates fill as a colour attribute (red → blue)", async () => {
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <svg width="200" height="200">
        <wardic.circle
          data-c
          cx={50}
          cy={50}
          r={20}
          initial={{ fill: "rgb(255, 0, 0)" }}
          animate={{ fill: "rgb(0, 0, 255)" }}
        />
      </svg>
    </WardicProvider>
  ))
  const circle = container.querySelector("[data-c]") as SVGCircleElement
  await until(() => {
    const m = (circle.getAttribute("fill") ?? "").match(/rgba?\(([^)]+)\)/)
    if (m === null) return false
    const [r, , b] = m[1]!.split(",").map((n) => Number.parseFloat(n))
    return b! > 200 && r! < 60
  })
  expect(circle.getAttribute("fill")).toMatch(/rgb/)
})

it("draws a path via pathLength → stroke-dasharray", async () => {
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <svg width="200" height="200">
        <wardic.path
          data-p
          d="M0,0 L100,0 L100,100"
          fill="none"
          stroke="black"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
        />
      </svg>
    </WardicProvider>
  ))
  const path = container.querySelector("[data-p]") as SVGPathElement
  // The dash array's first term (the drawn portion) climbs from 0 toward 1.
  await until(() => Number.parseFloat(path.getAttribute("stroke-dasharray") ?? "0") > 0.95)
  expect(Number.parseFloat(path.getAttribute("stroke-dasharray") ?? "0")).toBeGreaterThan(0.9)
  expect(path.getAttribute("pathLength")).toBe("1") // normalised
})

it("morphs a same-structure path `d` end-to-end (complex interpolator → setAttribute)", async () => {
  // Same command structure (M_,_ L_,_), so the complex interpolator (ADR-0015)
  // blends the coordinates and the applier writes the tweened `d` attribute.
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <svg width="200" height="200">
        <wardic.path
          data-p
          fill="none"
          stroke="black"
          initial={{ d: "M10,10 L20,20" }}
          animate={{ d: "M10,10 L80,80" }}
        />
      </svg>
    </WardicProvider>
  ))
  const path = container.querySelector("[data-p]") as SVGPathElement
  // Before #56 the string leg started at its target, so the `d` snapped; it now morphs from
  // `initial` under the spring (ADR-0024), so sample it and wait for it to land.
  const lOf = (): number => Number.parseFloat((path.getAttribute("d") ?? "").match(/L([\d.]+),/)?.[1] ?? "NaN")
  const s = sampleFrames(lOf)
  await until(() => path.getAttribute("d") === "M10,10 L80,80")
  const ls = s.stop().map((f) => f.v)
  expect(ls.filter((l) => l > 21 && l < 79).length, "the path is painted mid-morph").toBeGreaterThanOrEqual(3)
  expect(path.getAttribute("d")).toBe("M10,10 L80,80")
})
