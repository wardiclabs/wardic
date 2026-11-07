#!/usr/bin/env python3
"""PROTOTYPE Q1: summarise q1/out/*.json profile lists. usage: top.py <file> [topN] [frames]
cpu: top self time and inclusive time per function; heap: sampled bytes per function (and per frame)."""
import json, sys, re, collections
path = sys.argv[1]; top = int(sys.argv[2]) if len(sys.argv) > 2 else 30
units = float(sys.argv[3]) if len(sys.argv) > 3 else 0  # frames (or calls) the profiles cover
profiles = json.load(open(path))
def short(url):
    url = url.replace("file://", "")
    m = re.search(r"/(packages/.*)$", url)
    if m: return "wardic:" + m.group(1)
    m = re.search(r"node_modules/(?:\.bun/[^/]+/node_modules/)?(.*)$", url)
    if m: return m.group(1)
    m = re.search(r"/(\.tmp/.*)$", url)
    return m.group(1) if m else (url or "(native)")
def key(cf):
    return f"{cf['functionName'] or '(anon)'}  {short(cf['url'])}:{cf['lineNumber']+1}"
if "cpuprofiles" in path:
    self_t = collections.Counter(); incl = collections.Counter(); total = 0.0
    for p in profiles:
        nodes = {n["id"]: n for n in p["nodes"]}
        parent = {}
        for n in p["nodes"]:
            for c in n.get("children", []): parent[c] = n["id"]
        for sid, dt in zip(p["samples"], p["timeDeltas"]):
            n = nodes[sid]; k = key(n["callFrame"]); self_t[k] += dt; total += dt
            seen = set(); cur = sid
            while cur is not None:
                kk = key(nodes[cur]["callFrame"])
                if kk not in seen: incl[kk] += dt; seen.add(kk)
                cur = parent.get(cur)
    idle = sum(v for k, v in self_t.items() if k.startswith("(idle)"))
    busy = total - idle
    print(f"total {total/1000:.1f} ms, busy {busy/1000:.1f} ms" + (f", busy per unit {busy/1000/units:.4f} ms" if units else ""))
    print("--- self time (% of busy)")
    for k, v in self_t.most_common(top):
        if k.startswith("(idle)"): continue
        print(f"{100*v/busy:6.1f}%  {v/1000:8.1f} ms  {k}")
    print("--- inclusive time (% of busy), wardic/three/effect frames only")
    n = 0
    for k, v in incl.most_common(400):
        if k.startswith("(") or "(root)" in k: continue
        print(f"{100*v/busy:6.1f}%  {k}"); n += 1
        if n >= top: break
else:
    sizes = collections.Counter(); total = 0
    def walk(node):
        global total
        sizes[key(node["callFrame"])] += node["selfSize"]; total += node["selfSize"]
        for c in node.get("children", []): walk(c)
    for p in profiles: walk(p["head"])
    print(f"sampled bytes total {total}" + (f", per unit {total/units:.0f}" if units else ""))
    for k, v in sizes.most_common(top):
        print(f"{100*v/max(total,1):6.1f}%  {v/units if units else v:12.0f}  {k}")
