---
"@wardic/core": patch
"@wardic/dom": patch
---

A key a tween, keyframes or a spring's string keys move carries the speed it moved at into what takes it over, even right after a tick delivered late (#865). Its velocity was its last step over the time between its last two ticks as they were delivered, so a tick that ran late behind other work in its frame lowered it: by about half after a 16 ms delay, and a spring taking the key over started slower than the key had moved. It's over the time the step covered now, as Motion's is. For it, a `FrameLoop.Sink` is handed `dt`: the time its run was just stepped over, in seconds.
