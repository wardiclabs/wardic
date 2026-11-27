---
"@wardic/core": patch
"@wardic/dom": patch
---

An app's code that throws inside a layout animation no longer stops every layout animation on the page (#979).

```tsx
<WardicProvider scaleCorrectors={{ borderRadius: { correct: (latest, info) => radiusFor(latest, info) } }}> {/* radiusFor throws for one element */}
// before: every layout animation under the provider froze where it was, and the next layout change made them jump
// now: that element's radius keeps its last value, every layout animation lands, and "wardic.projection: a scale corrector failed" is logged once until it returns
```

- **A layout transition's `ease` that throws:** its element stays where its last `ease` put it, and lands on its target on time. Logged once as `wardic.projection: a layout animation's ease failed`, until it returns.
- **An app's scale corrector that throws for an element:** that corrector's keys keep their last value, and the element's other keys and every other element go on. Logged once per element and corrector, `wardic.projection: a scale corrector failed`, annotated with its key. Before, one that threw as a layout change began also left that change's elements unanimated.
- **A leaving element's `transformTemplate`,** while a layout animation carries it: that element keeps what it drew, and the rest go on. Logged once, `wardic.projection: a leaving node's write failed`.
- **A `transformTemplate` that throws while Wardic measures the layout:** its element is measured as its template last drew it, and every element's transform comes back. Before, the elements measured before it were left without their own transform for good (a `rotate` lost), and the layout change wasn't animated. Logged once, `wardic.projection: a transformTemplate failed at a Measure pass`.
- **An exit's `transformTemplate` that throws while its Measured pairs are measured** (an exit's `x` to `"100%"`, say): those keys switch, and every other element's pairs in that batch are measured. Logged each time, `wardic.presence: an exit's Measured pairs failed`. Before, the throw was uncaught, every pair in the batch jumped, and some elements were left with their targets written inline.
