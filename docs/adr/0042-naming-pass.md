# Naming pass

#193 gives `@wardic/solid`'s Tier 1 one naming pass: one set of rules, then a rename to fit them.
- **The theme reaches only the names Wardic owns.** Motion's props and components keep Motion's names, `createX` keeps Solid's convention, and the plumbing, Tier 2 and the glossary's other terms stay as they are.
- **Themed nouns, plain verbs.** The theme lives in two brand words:
  - a **ward** is one element's motion binding;
  - **Wardic** is the adjective for Wardic's elements and everything else of Wardic's.

  A name that does something keeps a verb that says what it does.

It lands in one PR, with no aliases (#93's rule).

## Why

- **Half the vocabulary was already themed, without rules.** `use:ward`, `ward()`, `useWardic`, `Ward` and `WardProps` played on the name, while most of the API is Motion's (`AnimatePresence`, `layoutId`, `whileDrag`) or plain (`createDrag`, `animateLayout`). #4's grill (ADR-0038, decision 11) left `animateLayout` for this pass, with `transfigure(fn)` as a themed candidate.
- **"Ward" meant two things.** The `Ward` type was the callable `useWardic` returns, and the `ward` export was the function behind the `use:ward` directive. A component that used both shadowed the import:

  ```tsx
  const ward = useWardic({ animate: { x: 100 } })
  return <div {...ward()}><span use:ward={{ animate: { opacity: 1 } }} /></div>
  ```

  Solid compiles `use:ward` to a bare `ward(el, () => cfg)`, so it called the local callable, which returns props and attaches nothing. It failed silently.
- **`useWardic` broke Solid's convention.** solid-primitives' guideline is `create*` for a primitive that owns computations and `use*` for one that reads context. The binding follows it everywhere else: `createDrag` and `createReorderGroup` create, while `useAnimateLayout` and `usePresenceContext` read the provider. `useWardic` creates a spine under the current owner.
- **Two exports named one component.** `Reorder.Group` / `Reorder.Item` were also exported as `ReorderGroup` / `ReorderItem`, which nothing in the repo used, and `create` repeated `wardic.create`.

## Decisions (grilled 2026-10-17, Q1–Q8 all A)

1. **The theme reaches only names Wardic owns** (Q1): the provider, the element factory, the binding's callable and directive, the Declared layout change, and their types.
   - **Motion's names stay:**
     - the props: `initial`, `animate`, `exit`, `variants`, `transition`, the `while*` props, the layout props, `drag` and its options;
     - the components: `AnimatePresence`, `LayoutGroup`, `Reorder.Group` / `Reorder.Item`.

     A Motion user finds them where they look, and the parity work (#5–#9) and the lab compare against Motion by those names.
   - **Solid's convention stays:** `createDrag`, `createHover`, `createReorderGroup`.
   - **The rest stays plain:**
     - the Effect bridges (`useWardicRuntime`, `useWardicGate`, `useWardicFiber`, `runScoped`, `fromAtom`, `streamToSignal`);
     - Tier 2 (`@wardic/dom`, `@wardic/core`);
     - the glossary's terms. Binding authors and ADRs need the precise words (**Measure pass**, **Crossfade**, **Declared layout change**).
   - Rejected:
     - Motion's components themed too;
     - everything themed, props included;
     - no theming beyond what existed.
2. **Themed nouns, plain verbs** (Q2). `animateLayout` / `useAnimateLayout` keep their names: a reader who has never seen the docs knows what `animateLayout(fn)` does. `transfigure(fn)` says only that something changes form.
   - Rejected:
     - a spell vocabulary, a magic verb per Wardic action, with its JSDoc stating the plain meaning;
     - themed verbs judged name by name.
3. **A ward is one element's motion binding** (Q3): its config, Recognizers, Override stack, Legs and Snapshot, however it's attached. `wardic.div`, `createWard`'s spread and `use:wardic` are three ways to put one on an element, and an element with one is a **Wardic element**. Both terms are in the glossary.
   - Rejected:
     - a ward as the callable only;
     - no glossary term.
4. **`useWardic` → `createWard`** (Q4). It's Solid's convention for a primitive that owns computations, and what it creates is a ward. solid-motionone's `createMotion` makes the same choice.
   - Rejected:
     - `useWard`, since `use` would say it reads context;
     - keeping `useWardic`.
5. **`use:ward` → `use:wardic`, on the `wardic` export** (Q5). `wardic` is now callable as the directive, with `wardic.div` and `wardic.create` as its properties.
   - One import covers every surface but `createWard`.
   - It reads as the glossary does: `use:wardic` makes a Wardic element, as `wardic.div` is one.
   - Nobody names a local Ward `wardic`, so the shadowing in *Why* can't happen.
   - Rejected:
     - keeping `use:ward` and documenting the shadowing;
     - a third word (`use:warded`).
6. **`Ward…` for a ward's own shapes, `Wardic…` for the rest** (Q6).
   - A ward's own: `Ward`, `WardProps`, `WardUserProps`, and `WardConfig`, which was `WardicConfig`.
   - Everything else keeps the brand prefix, which also keeps them off core's `Values` and `Transition`: `WardicValues`, `WardicTransition`, `WardicDragTransition`, `WardicReducedMotion`, `WardicTransformShorthands`, `WardicEnv`, `WardicRuntime`, `WardicServices`, `Wardic`, `WardicProps`, `WardicMotionProps`, `WardicVariantContext`.
   - Rejected:
     - all `Ward…` (a ward's environment or runtime mislabels provider-level things);
     - no change.
7. **A Reorder group's headless result is a `ReorderGroup<V>`** (Q7). A group's element runs no spine, so it isn't a ward.
   - `ReorderGroupWard<V>` → `ReorderGroup<V>`, the glossary's **Reorder group**.
   - `ReorderGroupWardProps` → `ReorderGroupSpread`, pairing with `ReorderItemSpread`.
   - The group's spread takes its own `ReorderGroupUserProps` (`ref`, `style`) rather than `WardUserProps`.
   - The `ReorderGroup` / `ReorderItem` component aliases go. `Reorder.Group` / `Reorder.Item` remain.
   - An item keeps `ReorderItemWard`: it is a Wardic element.
   - Rejected:
     - keeping the aliases, with `ReorderGroupControl<V>`;
     - keeping `ReorderGroupWard`.
8. **One PR, no aliases, this ADR, and a README section** (Q8).
   - **Code, tests, the lab, the README, JSDoc and the glossary move to the new names.**
   - **Older ADRs, `docs/plans/` and `docs/research/` stay as written:** they record what was decided against the names of their time, as ADR-0006 and ADR-0031 still say `makeFlushGate` after ADR-0041. The table below maps them.
   - **The README's *Coming from Motion*** lists what's Motion's as it is, and the few names that differ.
   - Rejected:
     - several PRs for mechanical renames;
     - rewriting old ADRs to the new names.

Derived from these, not asked:
- **`WardicProvider` stays:** it's provider-level, so it takes the adjective (decision 6).
- **`ward.Provider` stays:** it's a ward's own variant context.
- **The bare `create` export goes:** it was a second name for `wardic.create`, as decision 7's aliases were, and it said nothing about what it creates.
- **The Reorder group's a11y props** (`keyboard`, `announcements`, `instructions`) stay plain nouns (decision 2).

## The rename

| Before | After |
|---|---|
| `useWardic(config)` | `createWard(config)` |
| `<div use:ward={config}>`, `import { ward }` | `<div use:wardic={config}>`, `import { wardic }` |
| `WardicConfig` | `WardConfig` |
| `ReorderGroupWard<V>` | `ReorderGroup<V>` |
| `ReorderGroupWardProps` | `ReorderGroupSpread` |
| (the group's `WardUserProps`) | `ReorderGroupUserProps` |
| `ReorderGroup`, `ReorderItem` (components) | `Reorder.Group`, `Reorder.Item` |
| `create(tag)` | `wardic.create(tag)` |

Files followed: `use-wardic.tsx` is `create-ward.tsx`. The hook's tests are `create-ward.browser.test.tsx`, and the directive's are `use-wardic.browser.test.tsx`.

## Consequences

- **A user's code breaks once,** before 1.0, with no aliases. The table above is the whole change.
- **`wardic` is a function.** It's a Proxy over the directive, an arrow function, so it carries no non-configurable `prototype` for the Proxy to keep. Its `get` trap serves `wardic.create` and the cached `wardic.<tag>` components as before, and `typeof wardic` is `"function"`.
- **The glossary has a *Binding* section:** **Ward** and **Wardic element**.

## Pinned by

- **solid:**
  - `test/wardic-create.browser.test.tsx`: `wardic` is callable, and its components are still cached;
  - `test/use-wardic.browser.test.tsx`: the directive end to end, through the `wardic` import;
  - every test that used the old names, now on the new ones.
- **lab:** `bunx tsc --noEmit -p .` and its tests, on the new names.

## Implementation

- **The declaration diff** of `@wardic/solid`'s `index.d.ts` against main `969f85b` is the table above and nothing else.
  - **Gone:** `useWardic`, `ward`, `create`, `WardicConfig`, `ReorderGroupWard`, `ReorderGroupWardProps`, the `ReorderItem` component.
  - **New:** `createWard`, `WardConfig`, `ReorderGroupSpread`, `ReorderGroupUserProps`.
  - **`ReorderGroup`** is now the type, not the component.
- **Gates:** typecheck, lint, unit (963), browser (1009), and the lab's tsc and vitest (208). No "optimized dependencies changed".
- **Lab** (5173, restarted on this branch):
  - smoke 0 errors;
  - crossfade board 54 runs, 0 fails;
  - held 30 runs, 0 off;
  - scenario 15, 14 runs clean;
  - scenario 7 `passes 1 (1 seeding)`;
  - scenario 17 as main;
  - keyboard reorder announced;
  - real-mouse drags 0.00 px, 0 frames behind.
