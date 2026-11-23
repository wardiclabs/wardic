/**
 * The storefront's examples (#908), from its registry (`@wardic/example-storefront-shared/examples`):
 * a guide's own, under it (`<Storefront guide="/guides/layout" />`), or every one, by area, on the
 * Examples page (`<Storefront />`). Each links its page on Solid 2, and on Foldkit where it has one.
 */
import { AREAS, type Example, EXAMPLES, hasExample, routeOf } from "@wardic/example-storefront-shared/examples"
import { For, Show } from "solid-js"

/** Where each storefront is served. */
export const STOREFRONTS = { solid2: "https://solid2.wardic.dev", foldkit: "https://foldkit.wardic.dev" } as const

/** An example's line: its title, linked to its first app's page, its summary, and its other app's link. */
function Entry(props: { readonly example: Example }) {
  const onSolid2 = (): boolean => hasExample("solid2", props.example)
  const onFoldkit = (): boolean => hasExample("foldkit", props.example)
  const first = (): string => (onSolid2() ? STOREFRONTS.solid2 : STOREFRONTS.foldkit)
  return (
    <li>
      <a href={`${first()}${routeOf(props.example)}`}>{props.example.title}</a>: {props.example.summary}
      <Show when={onSolid2() && onFoldkit()}>
        {" "}
        (<a href={`${STOREFRONTS.foldkit}${routeOf(props.example)}`}>on Foldkit</a>)
      </Show>
    </li>
  )
}

export function Storefront(props: { readonly guide?: string }) {
  return (
    <Show
      when={props.guide}
      fallback={
        <For each={AREAS.filter((area) => EXAMPLES.some((example) => example.area === area.id))}>
          {(area) => (
            <section class="storefront-area">
              <h2 id={area.id}>{area.title}</h2>
              <p>{area.blurb}</p>
              <ul>
                <For each={EXAMPLES.filter((example) => example.area === area.id)}>{(example) => <Entry example={example} />}</For>
              </ul>
            </section>
          )}
        </For>
      }
    >
      {(guide) => (
        <ul>
          <For each={EXAMPLES.filter((example) => example.docs === guide())}>{(example) => <Entry example={example} />}</For>
        </ul>
      )}
    </Show>
  )
}
