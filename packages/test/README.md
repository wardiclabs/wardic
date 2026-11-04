# @wardic/test

Headless testing Layers for [Wardic](https://wardic.dev). Provide `TestLive` (or `testLayer(frames)`) where an app provides `DomLive`, and animation code runs without a browser:

- `TestClock`: a clock that replays the frames you give it, so every frame's values can be read in turn;
- `TestRenderer`: a renderer that records what it's asked to draw;
- `TestInput`: pointer, keyboard and focus input you push;
- `TestProbe`: the page as you script it: its boxes, viewport, scroll and what's in view.

- Docs: https://wardic.dev
- Source: https://github.com/wardiclabs/wardic/tree/main/packages/test
- Licence: MIT
