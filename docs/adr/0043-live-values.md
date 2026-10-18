# Live values

#130 gives Wardic a **Live value**: a value the user moves themselves, given in an element's `style` (CONTEXT.md). Motion has one in `useMotionValue`, `useTransform` and `useSpring`. Wardic's differs in one rule: the user's value is an input that Wardic never writes into. The element's own values come out through a separate output.

It lands in two PRs. The first adds core's `LiveValue` module and the gate's per-key outputs. The second adds the Solid surface, the transform keys in `style`, and returns that follow a moving value.

## Why

- **Motion lets a user put a value they move into `style`:** `<motion.div style={{ x, opacity }} />`. Wardic had no equivalent, and `style` didn't even take a transform key: the Base value never read one from `style` (`styleValueOf` skipped them), so a transform key's base was always its identity.
- **#79 settled the order for a static `style`:** while any entry of the Override stack sets a key, the element shows Wardic's value, and `style` is the key's fallback (ADR-0022, ADR-0034). A value that moves needed an order too, and a name.
- **In Motion there's one value, and it's the key's value.** `animate`, gestures and drag write into the same object (`VisualElement.addValue`, `value.start(…)`), so a user's `.set()` during an animation is overwritten by its next frame.

## Decisions (grilled 2026-10-18, Q1–Q8 all A)

1. **A live fallback, not a shared value (Q1).** A value in `style` is the key's `style` link (ADR-0022), live. While an entry of the Override stack sets the key, the entry wins. When none does, the element follows the value on every change, and a gesture that lets go returns the key to where the value is then.
   - **One rule for `style`, static or live:** the Override stack and the Base value stay the only model.
   - **Scroll-linked `opacity` under `whileHover` composes:** the hover wins, and on release the key returns to the scroll value. Under a shared value, the hover would overwrite the scroll value, and the scroll would overwrite the hover, every frame.
   - **The swipe card** (`drag="x"`, with `opacity` following `x`) reads drag's `x` through the output (decision 5) instead of sharing it.
   - **Other frameworks get the same rule.** It lives in core and dom, below the bindings. React still needs a value object that changes without re-renders, but as an input that Wardic never writes into. Foldkit (the Elm architecture) would take an Effect source; a shared mutable value Wardic writes into would go against its messages-only model.
   - Rejected: Motion's shared value. It ports Motion code line for line, but it makes `style` an override for those keys, against #79's rule, and lets a derived value fight a gesture.
2. **The shared form is an `effect/reactivity` `Atom` (Q2),** as core's other live data is (`Probe.viewport`, `Probe.prefersReducedMotion`). Every binding accepts an Atom in `style`, and also its framework's native reactive value (a Solid accessor or signal now). The output is an Atom too, and the helpers that derive one live value from another live in core, over Atoms.
   - **Measured, 1,000 live values each changed once a frame and forwarded to a sink** (µs a frame for all 1,000; `.tmp/130/live-cost.ts`):

     | form | Bun | Node |
     |---|---|---|
     | Solid signal → computation | 35–39 | 64 |
     | `Atom` → registry subscription | 29 | 23–24 |
     | Solid signal → `createMemo` → computation | 84 | 155 |
     | `Atom` → derived `Atom` → subscription | 180–191 | 161–166 |

     At worst about 0.2 ms of a 16.7 ms frame, so cost doesn't decide the form. A derived Atom tracks its source only once it has been read: subscribed without `{ immediate: true }`, it never fired, and that first measurement read impossibly cheap.
   - **The registry de-duplicates by identity:** an equal number or the same object doesn't notify; a new object does, even when it's structurally equal.
   - Rejected: Solid accessors only (the bindings would drift into three shapes, with nothing derived in core); Atoms only (a Solid user would wrap every signal).
3. **The name is Live value (Q3).** "Motion value" is Motion's name, for a value the engine writes into, which this isn't. The glossary's two "a Snapshot is a motion value" lines now say "a cached value", and the Hydration hold switches to its "client values", so "live" means one thing.
4. **`style` takes the transform keys, static or live (Q4).** `x`, `y`, `scale`, `rotate` and the rest are `style` links like any CSS key: `style={{ x: 100 }}` rests at 100, and a gesture that moves `x` returns there. Wardic composes them into `transform` with its own keys, through the gate. A user's own `transform` string applies only while no transform key is set. With both, the keys win and the string is dropped (Motion's rule), with a development warning. This is PR 2: `styleValueOf` reads a transform key only once the binding keeps those keys in the gate, or an `x` handed back to `style` at rest would drop to 0.
5. **The output is the element's value per key, on request (Q5).** `FlushGate.valueOf(id, key)` is an Atom set as each commit that writes the key changes it. It holds the value before the Renderer projects it (`x` as a number), is `undefined` before the key's first commit and after its release or the element's unregister, and is one Atom for an id and a key, made on first ask. A key nobody reads costs nothing; an element with no output pays one `undefined` check per commit. The binding's `ward.value(key)` (PR 2) reads it, and covers a key at rest in `style`, which the gate doesn't hold.
   - Rejected for now: Motion's `onUpdate(latest)`, a callback with every value each frame. It's a follow-up for porting code that uses it.
6. **A return to a moving Live value follows it (Q6).** A spring return reads its target afresh each frame (`Machine.chase`'s step), and a tween return eases toward the current value, so it lands exactly on it. On settle the key goes back to the Live value with no jump. This is PR 2.
   - Rejected: aiming at the value when the return starts (a snap at hand-back during a fast scroll); no return animation for a live key.
7. **Two helpers, in core, over Atoms (Q7):** `LiveValue.transform` and `LiveValue.spring`, wrapped in Solid as `createTransform` and `createSpring` (PR 2).
   - **`transform(source, input, output, { clamp })`** maps ranges, each pair of outputs blended through the `InterpolatorRegistry` (resolved once), so colours and unit strings map as `animate` blends them. Clamped by default, as Motion's `useTransform` is.
   - **`spring(source, options)`** starts where its source is. From each change on, a `Machine.chase` toward the source runs on the Frame loop until it rests there: the run then ends (superseded, ADR-0027 *Amendment (#200)*), and the next change starts another from where it rests. A change mid-flight keeps the run it's on, chasing the new value with its velocity. The run and the subscription end with the Scope. Measured: 1,000 live springs on the loop cost 117–119 µs a frame, against 59–61 µs for the same 1,000 chase runs, so about 0.06 µs a spring per frame for the Atom read and write.
   - Follow-ups: `velocity`, `scroll` (needs a scroll source in the Environment) and `time`.
8. **This ADR, in two PRs (Q8).** ADR-0022 (the Base value) and ADR-0034 (the gate) point here.

## Consequences

- **`FlushGateServices` gains `AtomRegistry`.** `DomLive` provides it already. A binding that builds its own gate provides one, and the gate's own tests got one.
- **Motion code ports with one change:** a value Wardic animates is read from its output (`ward.value("x")`), not shared.
- **The order is the same in every binding,** since it lives below them.

## Pinned by

- `packages/test/test/live-value.test.ts`:
  - TR1–TR5 (`transform`): a blend between stops, clamped ends, `clamp: false`, unit strings, a subscriber per change, and the length checks;
  - SP1–SP5 (`spring`): idle until its source moves; a run Frame for Frame `Machine.spring`'s that ends at rest; a change mid-flight keeping its run and velocity; a new run after a rest; a Scope close ending both.
- `packages/dom/test/gate.node.test.ts` GV1–GV6 (`valueOf`): `undefined` before the first commit, then the value before projection; one notification per change; `undefined` after a release and after an unregister; asked before the element registers; no change to an element with no output.
- **Mutations,** each caught: the gate never setting an output (GV1, GV3, GV4); `spring` not ending its run at rest (SP2, SP4); `transform` ignoring `clamp` (TR1). Dropping the gate's unchanged-value check is not caught, and needs no test: the registry ignores an equal value anyway, so the check only saves a `set`.

## Implementation

**PR 1** (core and dom): `packages/core/src/LiveValue.ts`; `FlushGate.valueOf` in `packages/dom/src/internal/gate.ts`, with `inert`'s; the glossary's Live value.
EOF
python3 - <<'EOF'
import re
def append(p, text):
    s=open(p).read().rstrip('\n')+'\n'+text
    open(p,'w').write(s)
append('docs/adr/0022-base-value.md' if __import__('os').path.exists('docs/adr/0022-base-value.md') else [f for f in __import__('glob').glob('docs/adr/0022-*.md')][0], '''
## Note (#130, 2026-10-18): a Live value is a `style` link

ADR-0043 makes a value the user moves, given in `style`, the key's `style` link, live: the element follows it while no entry of the Override stack sets the key, and a return goes to where it is then. `style` also takes the transform keys from #130's PR 2. See ADR-0043.
''')
append([f for f in __import__('glob').glob('docs/adr/0034-*.md')][0], '''
## Note (#130, 2026-10-18): the gate's live outputs

ADR-0043 decision 5: `FlushGate.valueOf(id, key)` is an Atom of the value the gate last committed for the key, set as a commit changes it. An element with no output pays one `undefined` check per commit. Live values themselves are written upstream of the gate, as its notes for #130 above expected.
''')
EOF
ls docs/adr/0022-* docs/adr/0034-*; tail -4 docs/adr/0022-*.md | cut -c1-120