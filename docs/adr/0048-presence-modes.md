# AnimatePresence: many children, then Motion's modes, `custom` and the presence hooks

`<AnimatePresence>` covered Motion's basic case: one child, usually behind `<Show>`, kept in the DOM until its `exit` ends. Motion's has more (`.reference/motion` at `16c6122`, `components/AnimatePresence/types.ts`):
- many keyed children, each exiting on its own;
- `mode="wait"` and `mode="popLayout"`;
- `custom`, handed to a leaver's dynamic variants;
- `propagate`;
- the presence hooks: `usePresence()`, `useIsPresent()` and `usePresenceData()`.

#277 brings them, in five PRs, in this order (Q1):
1. **Many children** (*Many children*, *Built (PR 1)*).
2. `mode="wait"`.
3. `mode="popLayout"`.
4. `custom`, with dynamic (function) variants.
5. The presence hooks and `propagate`.

Both bindings share the work in `packages/solid/src/presence-controller.ts`, so each PR lands there first.

## Why

- **A list where items leave is the common ask** after a single conditional child: a to-do list, notifications, search results. Wardic's presence retained one node, and dropped any other.
- **Many children comes first** because the others build on it: `wait` holds an entering child back while the leavers finish, and `popLayout` takes them out of the flow. Built on the single-child controller, each would be rebuilt with PR 1.
  - Rejected: `mode="wait"` first, the other common ask (a route or tab switch).

## Many children (grilled 2026-10-22, PR 1)

1. **A child is its DOM node** (Q2: C). A child that leaves is a node that left the resolved children, whatever made it: a `<Show>`'s branch, a `<For>`'s item, a `<Switch>`'s match. Each such node exits on its own.
   - **A child back mid-exit is a new node.** Solid has no keys on children, and its `<For>` makes a new node for an item added again. The new one enters beside the leaver, as Motion shows two children whose keys differ.
   - **The cost:** Motion reuses a leaver that comes back under its key, reversing its exit where it is. An optional key would do the same, filed as #286.
   - Rejected: A, a `key` prop on each child (Motion's, but a required prop Solid code doesn't need anywhere else); B, the presence covering only a `<For>`'s items, keyed by item (no `<Show>` or `<Switch>`).
2. **One rule for every child: a leaver finishes its exit** (Q3: A). This holds even beside a new child, and even for a lone `<Show>` child that comes back mid-exit. Before, a re-entry interrupted every stale exit and removed its node: the old one vanished, and the new one entered alone.
   - **Why:** a list item and a `<Show>` child are the same thing to the controller now, and one rule keeps them the same to the app. It's also Motion's: two children whose keys differ both stay until the leaver's exit ends.
   - **What it changes:** a `<Show>` toggled back mid-exit shows the old node finishing its exit beside the new one entering. The Solid 1 `onExitComplete` and Solid 2's `next("exitComplete")` now come once the leaver is gone, where the interrupt completed nothing. `exiting()` stays on until then.
   - **The cost:** a layout that can't hold two (a full-size panel) shows both for the exit's length. That is what `mode="wait"` and `mode="popLayout"` (PRs 2 and 3) are for, as in Motion.
   - Rejected: B, the interrupt kept for a lone child; C, the interrupt for every child.
3. **Defaults stated, not asked:**
   - **A leaver keeps its place in the DOM** while it exits, between the siblings it was between, so the others don't move until it's gone. Leavers side by side keep their order.
   - **Each leaver runs its own exit,** from where it is drawn, as a lone child's did.
   - **`onExitComplete` comes once no leaver is left,** the last by completing, as Motion's (ADR-0046's "complete"). On Solid 2, `next("exitComplete")` likewise, and `exiting()` is on while any child exits.
   - **`<AnimatePresence initial={false}>`** starts every child of the first render at its `animate` (ADR-0007 *Amendment (#134)*). A child added later animates in from its `initial`.
   - **A plain child** (not a Wardic element) leaves at once, as before.
   - **A leaver hands back its twins** (ADR-0010 *Amendment (#181)*) and crossfades as a twin (`handleLeave`), each on its own, as a lone child did.

## Built (PR 1)

- **The controller tracks the children present at each change**, each with where it was then: its parent and next sibling (`Placed`). `present(current)` takes what the binding's `children()` resolved: one node, a flat array of them, or none.
- **Each node that left is retained and exits** (`left`), unless it's exiting already:
  - put back where it was, if the framework took it out, before its exit starts: a leaver's exit, and its twins' hand-back, read its box where it is drawn (PH3 caught a put-back after);
  - **the leavers of one change go back last first,** each before its old next sibling. A next sibling that left too is back already, so neighbours that leave together keep their order (MC2).
- **A leaver's place is kept until its exit ends** (`places`). At every change the controller puts back any leaver the framework has taken out since: Solid clears a `<For>`'s parent wholesale when its list empties, and that took out an item already mid-exit (MC8).
- **No interrupt at a re-entry** (decision 2). An exit ends only at its end, or at the presence's teardown.
- **Both bindings unchanged but for their docs:** each already resolved its children with `children()` and handed the result to the controller, which now reads all of it.

## Consequences

- **A behaviour change:** a lone child toggled back mid-exit no longer cuts its leaver short. ADR-0046's "an exit a re-entry interrupts doesn't complete" and ADR-0010 *Amendment (#181)*'s "presence's re-entry interrupts a stale exit" no longer hold: see their *Note (#277)*.
- **No new API.** `<AnimatePresence>` takes the same props on both bindings.
- **Per change:** a set of the present nodes, and a record per present node. A list of N items costs N records at each change of the list.

## Pinned by

- **solid (Solid 1):** `test/presence-many.browser.test.tsx` MC1–MC9, around a `<For>`:
  - an item removed from the middle exits in its place, and a later change doesn't bring it back;
  - two neighbours removed together, in their order;
  - the list emptied;
  - exits that overlap, completed once;
  - an item added while another exits;
  - an item removed and added back, two nodes;
  - a plain item;
  - an item mid-exit when the list is emptied;
  - `initial={false}`.
- **solid (Solid 1):** `test/presence-exit-complete.browser.test.tsx` EC2: a child back mid-exit, completed once the leaver is gone.
- **solid (Solid 2):**
  - `test/v2/presence.browser.test.tsx` P9 (the old node finishes beside the new one) and P10 (a `<For>`, items removed one after the other, in order);
  - `test/v2/presence-handle.browser.test.tsx` PX2 (`exiting()` on until the leaver is gone, which completes it) and PX9 (two items leaving one after the other, one completion).
- **Mutation-checked:** six single-point mutations, each caught:
  - leavers put back in document order (MC2);
  - no put-back at later changes (MC8);
  - no put-back as a leaver leaves (PH3);
  - a re-entry interrupting the leavers (EC2, MC5, P9, PX2);
  - one child only (MC1, MC2);
  - a finished leaver's place kept (MC1).
