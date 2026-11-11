// Fixtures for `createBatch`'s server render to hydration on Solid 1 (#665's PR 6): each export is
// rendered on the server by the `serverRender` command and hydrated from this same module, as
// `hydrate-fixtures.tsx`'s are.
import { DomLive } from "@wardic/dom"
import { AnimatePresence, createBatch, WardicProvider } from "@wardic/solid"
import { For, type JSX } from "solid-js"

const TWEEN = { type: "tween", duration: 0.3 } as const
const BOX: JSX.CSSProperties = { width: "20px", height: "20px", background: "teal" }

const Entering = (): JSX.Element => {
  const grid = createBatch({ count: 3, initial: { y: 20, opacity: 0 }, animate: (i) => ({ x: i * 50, y: 0, opacity: 1 }), transition: TWEEN })
  return <For each={[0, 1, 2]}>{(i) => <div data-k={`m${i}`} {...grid.at(i, { style: BOX })} />}</For>
}

const InPlace = (): JSX.Element => {
  const grid = createBatch({ count: 3, initial: false, animate: (i) => ({ x: i * 50, scale: 1 + i / 10 }), transition: TWEEN })
  return <For each={[0, 1, 2]}>{(i) => <div data-k={`m${i}`} {...grid.at(i, { style: BOX })} />}</For>
}

const Keyed = (): JSX.Element => {
  const items = ["a", "b"]
  const list = createBatch({ each: () => items, key: (id) => id, initial: (_, i) => ({ x: -20 * (i + 1), opacity: 0 }), animate: (_, i) => ({ y: i * 30, opacity: 1 }), transition: TWEEN })
  const quiet = createBatch({ each: () => items, key: (id) => id, initial: { opacity: 0 }, animate: (_, i) => ({ x: i * 30, opacity: 1 }), transition: TWEEN })
  return (
    <>
      <For each={items}>{(id) => <div data-k={`l-${id}`} {...list.member(id, { style: BOX })} />}</For>
      <AnimatePresence initial={false}>
        <For each={items}>{(id) => <div data-k={`q-${id}`} {...quiet.member(id, { style: BOX })} />}</For>
      </AnimatePresence>
    </>
  )
}

/** A grid by index entering from `initial`. */
export const B1 = (): JSX.Element => (
  <WardicProvider env={DomLive}>
    <Entering />
  </WardicProvider>
)

/** A grid by index at its targets: `initial: false`. */
export const B2 = (): JSX.Element => (
  <WardicProvider env={DomLive}>
    <InPlace />
  </WardicProvider>
)

/** A keyed list entering from `initial(item, i)`, and one under `<AnimatePresence initial={false}>`. */
export const B3 = (): JSX.Element => (
  <WardicProvider env={DomLive}>
    <Keyed />
  </WardicProvider>
)
