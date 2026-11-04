# Third-party notices

Wardic follows the API of [Motion](https://motion.dev) for React, and parts of its source are ported from Motion's: rewritten in Wardic's own style, keeping Motion's algorithms, formulas and constants so the results match. Motion is MIT licensed, and its notice follows.

## Motion

https://github.com/motiondivision/motion

Ported from Motion's source:

- `@wardic/core`:
  - `Box` and `Projection`: the projection geometry (`motion-dom`'s `projection/geometry`: `models`, `delta-calc`, `delta-apply`, `applyTreeDeltas`);
  - `Spring`: the solver for a spring's stiffness and damping from its duration and bounce (`findSpring`);
  - `Velocity`: a gesture's velocity from its points (`getVelocity`);
  - `Reorder`: moving an item, and the axis a list runs on (`moveItem`, `detectAxis`);
  - `AutoScroll`: scrolling a container while an item is dragged near its edge (`autoScrollIfNeeded`).
- `@wardic/dom`:
  - the projection transform (`buildProjectionTransform`);
  - the scroll offsets (`render/dom/scroll/offsets`).

```
The MIT License (MIT)

Copyright (c) 2024 [Motion](https://motion.dev) B.V.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
