// Fixtures for `Reorder.BatchGroup`'s server render to hydration on Solid 1 (#712's PR 3, Q37, Q39): each export
// is rendered on the server by the `serverRender` command and hydrated from this same module.
import { DomLive } from "@wardic/dom"
import * as Bool from "effect/Boolean"
import * as UndefinedOr from "effect/UndefinedOr"
import { Reorder, WardicProvider } from "@wardic/solid"
import { For, type JSX } from "solid-js"

const VALUES = ["a", "b", "c", "d", "e"]
const LOOK: JSX.CSSProperties = { background: "teal", "box-sizing": "border-box" }

const list = (props: { readonly axis: "x" | "y" | "xy"; readonly width?: number; readonly direction?: "rtl"; readonly padding?: number; readonly fades?: boolean; readonly plain?: boolean }) => (
  <Reorder.BatchGroup
    values={VALUES}
    onReorder={() => {}}
    axis={props.axis}
    itemSize={{ width: 80, height: 50 }}
    gap={10}
    direction={props.direction}
    {...Bool.match(props.fades === true, { onTrue: () => ({ initial: { opacity: 0 } }), onFalse: () => ({}) })}
    style={{
      margin: "0",
      padding: `${props.padding ?? 0}px`,
      ...UndefinedOr.match(props.width, { onUndefined: () => ({}), onDefined: (width) => ({ width: `${width}px` }) }),
    }}
  >
    <For each={VALUES}>
      {(value) => (
        <Reorder.BatchItem value={value} data-k={value} {...Bool.match(props.plain === true, { onTrue: () => ({}), onFalse: () => ({ style: LOOK }) })}>
          {value}
        </Reorder.BatchItem>
      )}
    </For>
  </Reorder.BatchGroup>
)

/** A column. */
export const R1 = (): JSX.Element => <WardicProvider env={DomLive}>{list({ axis: "y" })}</WardicProvider>

/** A grid with no `columns` in a 300 px group: CSS grid on the server, its places on the client. */
export const R2 = (): JSX.Element => <WardicProvider env={DomLive}>{list({ axis: "xy", width: 300 })}</WardicProvider>

/** A row, right to left. */
export const R3 = (): JSX.Element => <WardicProvider env={DomLive}>{list({ axis: "x", direction: "rtl" })}</WardicProvider>

/** A grid with no `columns`, padded 12 px, its items fading in from `initial`. */
export const R4 = (): JSX.Element => <WardicProvider env={DomLive}>{list({ axis: "xy", width: 300, padding: 12, fades: true })}</WardicProvider>

/** A column, padded 12 px. */
export const R5 = (): JSX.Element => <WardicProvider env={DomLive}>{list({ axis: "y", padding: 12 })}</WardicProvider>

/** A grid with no `columns` in a 300 px group, its items with no style of their own: the group's alone (Q47). */
export const R6 = (): JSX.Element => <WardicProvider env={DomLive}>{list({ axis: "xy", width: 300, plain: true })}</WardicProvider>

/** A padded column, its items the group's alone. */
export const R7 = (): JSX.Element => <WardicProvider env={DomLive}>{list({ axis: "y", padding: 12, plain: true })}</WardicProvider>

/** Each item's own size (#714): by its value. */
const WIDTHS: Readonly<Record<string, number>> = { a: 80, b: 120, c: 60, d: 100, e: 40 }
const HEIGHTS: Readonly<Record<string, number>> = { a: 40, b: 70, c: 50, d: 90, e: 60 }

/** A column of items each their own height, from a function (#714), padded 12 px. */
export const R8 = (): JSX.Element => (
  <WardicProvider env={DomLive}>
    <Reorder.BatchGroup values={VALUES} onReorder={() => {}} itemSize={(value) => ({ width: 200, height: HEIGHTS[value]! })} gap={10} style={{ margin: "0", padding: "12px" }}>
      <For each={VALUES}>{(value) => <Reorder.BatchItem value={value} data-k={value} style={LOOK}>{value}</Reorder.BatchItem>}</For>
    </Reorder.BatchGroup>
  </WardicProvider>
)

/** A grid of items each their own size in a 280 px group (#714): `flex-wrap` on the server, its places on the client. */
export const R9 = (): JSX.Element => (
  <WardicProvider env={DomLive}>
    <Reorder.BatchGroup values={VALUES} onReorder={() => {}} axis="xy" itemSize={(value) => ({ width: WIDTHS[value]!, height: HEIGHTS[value]! })} gap={10} style={{ margin: "0", padding: "0", width: "280px" }}>
      <For each={VALUES}>{(value) => <Reorder.BatchItem value={value} data-k={value} style={LOOK}>{value}</Reorder.BatchItem>}</For>
    </Reorder.BatchGroup>
  </WardicProvider>
)

/** A column, its content box 300 px and padded 12 px, whose items take its width (#714, Q10): by CSS, on the server too. */
export const R10 = (): JSX.Element => (
  <WardicProvider env={DomLive}>
    <Reorder.BatchGroup values={VALUES} onReorder={() => {}} itemSize={{ height: 50 }} gap={10} style={{ margin: "0", padding: "12px", width: "300px" }}>
      <For each={VALUES}>{(value) => <Reorder.BatchItem value={value} data-k={value} style={LOOK}>{value}</Reorder.BatchItem>}</For>
    </Reorder.BatchGroup>
  </WardicProvider>
)

