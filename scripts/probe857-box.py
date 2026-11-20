#!/usr/bin/env python3
# PROBE for #857, never merged: the box every second as JSON lines to argv[1] until argv[2] exists:
# CPU busy / iowait (all cores and the busiest), the run queue, load, memory, and Chromium's processes by
# type (count, CPU %, the busiest browser process's CPU %), with the vitest Node process's CPU %.
import json, os, re, sys, time

out, stop = sys.argv[1], sys.argv[2]
HZ = os.sysconf("SC_CLK_TCK")


def cpu_times():
    rows = {}
    for line in open("/proc/stat"):
        if line.startswith("cpu"):
            f = line.split()
            v = list(map(int, f[1:9]))
            rows[f[0]] = (sum(v), v[3] + v[4], v[4])  # total, idle+iowait, iowait
        elif line.startswith("procs_running"):
            rows["running"] = int(line.split()[1])
    return rows


def procs():
    seen = {}
    for pid in os.listdir("/proc"):
        if not pid.isdigit():
            continue
        try:
            stat = open(f"/proc/{pid}/stat").read()
            comm = stat[stat.index("(") + 1 : stat.rindex(")")]
            rest = stat[stat.rindex(")") + 2 :].split()
            ticks = int(rest[11]) + int(rest[12])
            if comm.startswith("chrome") or "headless" in comm:
                cmd = open(f"/proc/{pid}/cmdline").read().replace("\0", " ")
                m = re.search(r"--type=(\S+)", cmd)
                kind = m.group(1) if m else "browser"
                seen[pid] = (kind, ticks)
            elif comm in ("node", "bun", "MainThread"):
                cmd = open(f"/proc/{pid}/cmdline").read()
                if "vitest" in cmd and "browser.config" in cmd:
                    seen[pid] = ("vitest", ticks)
        except (FileNotFoundError, ProcessLookupError, ValueError, IndexError):
            continue
    return seen


prev_cpu, prev_procs, prev_t = cpu_times(), procs(), time.time()
with open(out, "a") as f:
    while not os.path.exists(stop):
        time.sleep(1)
        cpu, ps, now = cpu_times(), procs(), time.time()
        dt = now - prev_t
        cores = {}
        for k in cpu:
            if k == "running" or k not in prev_cpu:
                continue
            tot, idle, io = cpu[k]
            dtot = tot - prev_cpu[k][0] or 1
            cores[k] = (100 * (1 - (idle - prev_cpu[k][1]) / dtot), 100 * (io - prev_cpu[k][2]) / dtot)
        kinds = {}
        busiest_browser = 0.0
        for pid, (kind, ticks) in ps.items():
            pct = 100 * (ticks - prev_procs[pid][1]) / HZ / dt if pid in prev_procs else 0.0
            n, total = kinds.get(kind, (0, 0.0))
            kinds[kind] = (n + 1, total + pct)
            if kind == "browser":
                busiest_browser = max(busiest_browser, pct)
        per_core = [v[0] for k, v in cores.items() if k != "cpu"]
        load = open("/proc/loadavg").read().split()
        mem = next(int(l.split()[1]) for l in open("/proc/meminfo") if l.startswith("MemAvailable"))
        f.write(
            json.dumps(
                {
                    "t": int(now * 1000),
                    "busy": round(cores["cpu"][0], 1),
                    "iowait": round(cores["cpu"][1], 1),
                    "maxCore": round(max(per_core or [0]), 1),
                    "running": cpu.get("running"),
                    "load1": float(load[0]),
                    "availMB": mem // 1024,
                    "procs": {k: [n, round(p, 1)] for k, (n, p) in kinds.items()},
                    "busiestBrowser": round(busiest_browser, 1),
                }
            )
            + "\n"
        )
        f.flush()
        prev_cpu, prev_procs, prev_t = cpu, ps, now
