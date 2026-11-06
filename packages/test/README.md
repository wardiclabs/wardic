# @wardic/test

Headless testing Layers for [Wardic](https://wardic.dev)'s core and for a new Environment: animation code runs with no page at all.

- `TestClock`: a clock that replays the frames you give it, so every frame's values can be read in turn;
- `TestRenderer`: a renderer that records what it's asked to draw (`TestRenderer.make()`);
- `TestInput`: pointer, keyboard and focus input you push;
- `TestProbe`: the page as you script it: its boxes, viewport, scroll and what's in view.

`TestLive` (or `testLayer(frames)`) is all four together. It draws nothing on a page, and its clock moves only through the frames it's given, so an element rendered under it stays at its starting style. To test an app's components, render them with `DomLive` in jsdom or happy-dom, under your test runner's fake timers: see https://wardic.dev/guides/testing.

- Docs: https://wardic.dev
- Source: https://github.com/wardiclabs/wardic/tree/main/packages/test
- Licence: MIT
