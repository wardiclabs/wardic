# Per-value transitions

A transition drove every key of its animation alike. Motion lets one transition hold a value's own (`.reference/motion` at `16c6122`):

```tsx
<motion.div animate={{ x: 100, opacity: 1 }} transition={{ duration: 1, opacity: { duration: 0.2 }, default: { ease: "linear" } }} />
```

- **The lookup** is `getValueTransition(transition, key)`: `transition[key] ?? transition.default ?? transition` (`animation/utils/get-value-transition.ts`).
- **An entry with `inherit: true`** is laid over the transition it sits in (`resolveTransition`).
- **The type** is `TransitionWithValueOverrides` (`animation/types.ts:626`): an entry under every style, SVG and `--var` name, plus `default` and `layout`.
- **A layout animation** reads `getValueTransition(layoutTransition, "layout")` (`create-projection-node.ts`).
- **The orchestration** (`staggerChildren`, `when` and the rest) is read from the top level.

Wardic had the `layout` entry alone (ADR-0009 *Amendment (#171)*, its Q3: "no other per-key transitions, so no `default` key"). #301 was filed from #297's Q2, the user asking whether `{ transition: { opacity: { duration: 0.2 } } }` works.

## Decisions (grilled 2026-10-23)

1. **Motion's shape, on the transition itself, typed** (Q1: A). An entry sits under a value's name, beside the transition's own fields: `transition={{ type: "tween", duration: 1, opacity: { type: "tween", duration: 0.2 } }}`. The user added: "I'd definitely like the available options to be inferred if possible". So in PR 2, an entry's name completes from the keys the element animates (*Inferred names*).
   - Rejected: B, the entries nested under a `values` field (no clash with a transition's fields, but not Motion's); C, a separate `transitionFor` prop.
2. **Motion's lookup** (Q2: A). A key runs on its entry, else `default`, else the transition's own fields. An entry with `inherit: true` is laid over the own fields, its own winning. A key with no entry runs on `default`, never on the own fields when there is a `default`.
   - Rejected: B, every entry inheriting the own fields (simpler to write, but code ported from Motion would change meaning); C, `default` laid over the own fields.
3. **`layout` is one more entry** (Q3: A): a layout animation runs on `layout`, else `default`, else the own fields, else Motion's 0.45 s tween, as Motion reads it. Against #171 this changes only a transition with a `default` entry and no `layout` one, and `default` is new with this ADR.
   - Rejected: B, `layout` else the own fields, as #171 had it.
4. **Everywhere a transition goes** (Q4: A): the element's, a variant's own (each name's in a list, ADR-0007 *Amendment (#297)*), a gesture target's own (*Amendment (#291)*), an exit's (ADR-0048). The orchestration stays the whole transition's, as Motion reads it. **A stagger's delay is added to each entry's own delay,** so every key of a child waits its slot.
   - Rejected: B, the element's transition only.
5. **Two PRs** (Q5: A):
   - **PR 1, the runtime:** the lookup everywhere, and `layout` through it. Its types are Motion's: an entry under every value's name.
   - **PR 2, the inference:** a generic `wardic.*`, and `ward()` / `createWard` with their configs checked. It measures the typecheck cost on the examples and the lab.
   - Rejected: one PR; the inference alone first.

**Defaults, stated rather than asked:**
- **What's an entry:** a field holding a plain object (not an array, not a function), apart from the orchestration's. A value's name, `default` and `layout` are the only ones the types allow.
- **An entry is a spring or a tween** (`WardicValueTransition`), `inherit` too, but no orchestration. A duration needs `type: "tween"`, as on a whole transition.
- **The reduced-motion opt-out is the whole transition's,** like the orchestration (ADR-0029's `respectReducedMotion`, which Motion doesn't have). An entry without its own takes the top level's: `{ respectReducedMotion: false, x: {…} }` doesn't snap `x`. One with its own keeps it. A layout animation reads its `layout` entry's the same way.
- **No cost without entries:** a transition's entries are worked out once per transition object and kept (a `WeakMap`), so a transition with none costs one lookup per Retarget. Each entry is resolved once too, so every key on it runs on the same object. Those keys then share their legs, and #66's decode cache hits.
- **Exits, lists and gestures split by entry as they split by layer:** a group's transition, whichever layer or name gave it, splits its keys by entry when its legs are built.
- **No value's name is one of a transition's own fields:** a type test pins it (VK1), so an entry is never read as an option.
- **Entry names are checked against the keys the element animates** (PR 2). A config typed wide (`WardConfig`) accepts every value's name.
- **An Appear animation that mixes entries with a forever repeat isn't played by the server** (ADR-0044). A rule that repeats for ever is one CSS cycle; it can't hold a key that stops beside one that repeats, nor two cycles of different lengths. So when an entry drives one of the keys and the own fields, or any key's transition, repeat for ever, the spec fails: the element keeps its Starting style, and the client runs the animation after hydration, as for any element the server can't play. When every key runs on the own fields (a `layout` entry alone), it cycles as before.

## Built (PR 1)

- **Types** (`config.ts`):
  - `WardicTransitionEntries` replaces `WardicLayoutKey`, on both arms of `WardicTransition`. It holds `default`, `layout`, and an entry under every `WardicValueKey` (a style, a transform shorthand, an SVG attribute, a `--var`).
  - Each entry is a `WardicValueTransition`: a spring or a tween arm with `WardicReducedMotion` and `WardicInherit`.
  - All exported from both bindings.
- **The lookup** (`retarget-legs.ts`):
  - `entriesOf` finds a transition's entries once per object (`ENTRIES`).
  - `transitionForKey` and `forKey` give the transition a key runs on (Q2).
  - `resolvedEntry` lays an `inherit` entry over the own fields, or carries the own fields' reduced-motion opt-out into one that doesn't inherit.
- **The legs:**
  - `legsOf` splits a Retarget's keys by the transition each runs on, and builds each group's legs as before (`legsWith`).
  - A transition with no entry, or with only `default` and `layout`, builds one group as before.
  - Every caller goes through it: the spine's single and split legs, the presence's exits and exit groups, and a server's Appear sampling.
- **Delays:**
  - `delayedBy` adds a stagger, or an exit's #290 delay, to the own `delay` and each entry's. An `inherit` entry with no delay of its own takes the own fields' (Q4).
  - The spine's `staggeredOf` and the presence use it; the presence's own copy is gone.
  - `sameFields` (#66's reuse) compares entries a level down, as a stagger makes them anew.
- **Layout** (`layout-member.ts`): `toLayoutTransition` reads `transitionForKey(transition, "layout")` (Q3), and so does the layout animation's reduced-motion opt-out.
- **Appear** (ADR-0044): a server samples the per-key legs, so a rule times each key on its entry. The rule's key already holds the entries (its canonical text recurses).
  - `specOf` refuses a spec that mixes entries with a forever repeat (`foreverByValue`).
  - A probe found the need. With the own fields repeating for ever and a once-only `opacity` entry, the server wrote one `infinite` cycle that replayed `opacity`'s fade every cycle, where the client fades it once.

**Breaking, in types only:**
- `WardicLayoutKey` is gone.
- A `layout` entry can't hold orchestration fields, which it never used.
- A transition typed `Record<string, unknown>` no longer assigns to `WardicTransition`: the `--var` entries are a template-literal index signature, which an `unknown` index doesn't fit. Two tests on each binding typed one so, and now use `WardicTransition`.

## Tests (PR 1)

- **The lookup, pure** (`retarget-legs.ssr.test.tsx`, PV1–PV6):
  - PV1: an entry drives its value, the rest on the own fields.
  - PV2: `default` over the own fields; a spring entry in a tween.
  - PV3: `inherit` takes the own fields' delay; an entry without it stands alone.
  - PV4: one object resolves to the same transitions every time; `layout` and `default` alone build one group.
  - PV5: a delay goes on the own fields and each entry, `inherit` with none taking the own fields'.
  - PV6: the reduced-motion opt-out carried into an entry, and an entry's own.
  - PV7: a stagger's transition, its entries made anew, is reused while their fields are the same.
- **Solid 1, real frames** (`value-transitions.browser.test.tsx`, VT1–VT8):
  - VT1: the element's transition;
  - VT2: `default`;
  - VT3: `inherit`;
  - VT4: a variant's own;
  - VT5: a gesture target's own;
  - VT6: a list's names;
  - VT7: an exit's own;
  - VT8: a stagger's delay holding an entry;
  - VT9: an exit's stagger inside a leaving child (#290) holding one too.
- **Solid 2** (`v2/value-transitions.browser.test.tsx`, TV1–TV8): the same, and `default` driving layout.
- **Layout:** `layout-transition.browser.test.tsx` LTS4: `default` drives layout with no `layout` entry, and a `layout` entry wins over `default`.
- **Reduced motion:** `reduced-motion.browser.test.tsx` RM-L3: a layout entry's own opt-out, and the transition's carried into it.
- **Appear:**
  - Both bindings' `appear.ssr.test.tsx` (AR16 on Solid 1, AR17 on Solid 2): an entry times its key in the rule.
  - Solid 1's AR17: no rule where an entry meets a forever repeat; a `layout` entry alone still cycles.
- **Types** (`value-transition-types.ssr.test.tsx`, VK1–VK4):
  - VK1: no collision with a transition's own fields;
  - VK2: an entry is a spring or a tween, without orchestration;
  - VK3: every value's name, `default` and `layout` take an entry, and an unknown name is rejected;
  - VK4: a variant's own transition takes entries too.

**Mutation-checked:** seventeen single-point mutations, each run against the tests meant for it, all caught:
- the legs ignoring entries;
- no `default` fallback;
- `inherit` ignored, or the own fields winning over it;
- the `layout`-and-`default`-only shortcut on the own fields;
- each key resolving its entry anew;
- a delay leaving the entries, or shifting an `inherit` entry's twice;
- the reduced-motion opt-out not carried, or an entry's own ignored;
- layout ignoring the entries, or reading the top level's opt-out;
- the reuse comparing entries by identity;
- Appear cycling beside entries, refusing a `layout` entry's cycle, or missing the own fields' repeat;
- the presence's exit delays leaving the entries.

Two needed tests added:
- **The own fields' repeat beside `default`:** survived at first, as AR17's elements each had a key on the own fields.
- **The exit delay:** added before the run (VT9), as VT7's exit had none.
