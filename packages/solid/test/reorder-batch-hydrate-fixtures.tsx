// Fixtures for `Reorder.BatchGroup`'s server render to hydration on Solid 1 (#712's PR 3, Q37, Q39): each export
// is rendered on the server by the `serverRender` command and hydrated from this same module.
import { DomLive } from "@wardic/dom"
import * as UndefinedOr from "effect/UndefinedOr"
import { Reorder, WardicProvider } from "@wardic/solid"
import { For, type JSX } from "solid-js"

const VALUES = ["a", "b", "c", "d", "e"]
const LOOK: JSX.CSSProperties = { background: "teal", "box-sizing": "border-box" }

const list = (props: { readonly axis: "x" | "y" | "xy"; readonly width?: number; readonly direction?: "rtl" }) => (
  <Reorder.BatchGroup
    values={VALUES}
    onReorder={() => {}}
    axis={props.axis}
    itemSize={{ width: 80, height: 50 }}
    gap={10}
    direction={props.direction}
    style={{ margin: "0", padding: "0", ...UndefinedOr.match(props.width, { onUndefined: () => ({}), onDefined: (width) => ({ width: `${width}px` }) }) }}
  >
    <For each={VALUES}>
      {(value) => (
        <Reorder.BatchItem value={value} data-k={value} style={LOOK}>
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
