#!/usr/bin/env python3
"""Write the results the page shows, assets/data/results.json, from the paper's two result tables.

usage: make_results.py <paper dir>

Inputs: <paper dir>/arxiv/tables/main_agents.tex (seven coding agents, success rate per constraint type in the Standard
and Privileged regimes, mean over three runs, standard deviation in the All columns) and
<paper dir>/arxiv/tables/main_vla.tex (four VLA policies on the 18 one-arm puzzles, Standard regime). Numbers are
copied as printed. The grey reference row of the VLA table (a coding agent on the same puzzles) is left out: the page
shows the VLA policies on their own.
"""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAPER = Path(sys.argv[1])
COLUMNS = ["interlocking", "narrow_passage", "assembly", "untangling", "threading", "shape_control"]


def numbers(cell):
    """The numbers a table cell prints, without the colour arguments (stdc!33, black!50)."""
    cell = re.sub(r"\\(cellcolor|textcolor)\{[^}]*\}", "", cell)
    return [float(x) for x in re.findall(r"\d+(?:\.\d+)?", cell)]


def plain(cell):
    cell = re.sub(r"\\textcolor\{[^}]*\}", "", cell)
    return re.sub(r"[{}$]", "", cell).strip()


agents, group = [], None
for line in (PAPER / "arxiv" / "tables" / "main_agents.tex").read_text().splitlines():
    g = re.search(r"\\textsc\{\\tiny ([a-z\-]+)\}", line)
    if g:
        group = g.group(1)
        continue
    cells = line.rstrip("\\ ").split(" & ")
    if len(cells) != 16 or group is None or cells[0].startswith("Agent"):
        continue
    harness, effort = re.fullmatch(r"(.+?) \((\w+)\)", plain(cells[1])).groups()
    regime = lambda c: {"cells": [numbers(x)[0] for x in c[:6]], "all": numbers(c[6])[0], "sd": numbers(c[6])[1]}
    agents.append({"model": plain(cells[0]), "harness": harness, "effort": effort, "group": group,
                   "standard": regime(cells[2:9]), "privileged": regime(cells[9:16])})

vla, counts = [], None
HTML = {r"\pi_0.5": "π<sub>0.5</sub>"}
for line in (PAPER / "arxiv" / "tables" / "main_vla.tex").read_text().splitlines():
    cells = line.rstrip("\\ ").split(" & ")
    if len(cells) != 5:
        continue
    if cells[0].startswith("Policy"):
        counts = dict(zip(("narrow_passage", "threading", "all"), (int(numbers(c)[0]) for c in cells[1:4])))
        continue
    if "GPT" in cells[0]:                                  # the coding agent's reference row: not shown with the VLA policies
        continue
    name = plain(cells[0])
    vla.append({"name": HTML.get(name, name), "narrow_passage": numbers(cells[1])[0], "threading": numbers(cells[2])[0],
                "all": numbers(cells[3])[0], "touched": numbers(cells[4])[0]})

if len(agents) != 7 or len(vla) != 4 or counts != {"narrow_passage": 13, "threading": 5, "all": 18}:
    sys.exit(f"unexpected table shape: {len(agents)} agents, {len(vla)} VLA policies, {counts}")
out = {
    "source": "RoboARC paper (arXiv version): the main results table of the coding agents and the table of the VLA "
              "policies. Written by scripts/make_results.py.",
    "runs": 3, "tasks": 90, "trials_per_agent_and_regime": 270,
    "columns": COLUMNS,
    "agents": agents,
    "vla": {"regime": "standard", "puzzles": counts, "runs_per_puzzle": 3, "policies": vla},
}
(ROOT / "assets" / "data" / "results.json").write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
for a in agents:
    print(f"{a['model']:20s} {a['harness']:12s} {a['effort']:6s} {a['group']:12s} std {a['standard']['all']:5.1f} ± {a['standard']['sd']:.1f}  priv {a['privileged']['all']:5.1f} ± {a['privileged']['sd']:.1f}")
for p in vla:
    print(p)
