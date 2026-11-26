#!/usr/bin/env python3
"""Checks to run before the page is published. Standard library only; exits with 1 on any finding.

usage: check_site.py [--readme <code release>/README.md]

- every local file the page refers to is there (index.html, the stylesheet, suite.json's clips and posters, the 3D
  replays of the tasks marked `oracle`);
- the task index has the paper's counts and the results file has the paper's shape;
- the page stays a page of pictures: no paragraph under a section heading, no figure caption, no difficulty rating;
- with --readme: every command line of "Get started" is a command line of the code release's README, character for
  character up to that line's trailing comment, which the page leaves out;
- no leftover of the preview page, no placeholder link, no name that belongs to our own workspace;
- page metadata: each page's title (at most 70 characters) and description (25 to 160), its canonical address, JSON-LD
  that parses, the text written in by scripts/prerender.py (every block there and not empty), robots.txt, sitemap.xml
  (every address a page of this repository), llms.txt and llms-full.txt.
"""
import html, json, re, sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
page = (ROOT / "index.html").read_text()
findings = []
note = findings.append

# ---- local references
refs = set(re.findall(r'(?:src|href|poster)="([^"#][^"]*)"', page))
refs |= set(re.findall(r'url\("?(assets/[^")]+)"?\)', (ROOT / "assets/css/site.css").read_text()))
for ref in sorted(refs):
    if re.match(r"(https?:|data:|mailto:)", ref):
        continue
    if not (ROOT / ref.split("?")[0]).exists():
        note(f"missing file: {ref}")
suite = json.loads((ROOT / "assets/data/suite.json").read_text())
results = json.loads((ROOT / "assets/data/results.json").read_text())
tasks = [t for fam in suite["families"].values() for t in fam["tasks"]]
for t in tasks:
    for key in ("video", "poster"):
        if t.get(key) and not (ROOT / t[key]).exists():
            note(f"missing {key}: {t[key]}")
    if t.get("oracle"):
        for ext in ("json", "bin"):
            if not (ROOT / "assets/oracle" / f"{t['base']}.{ext}").exists():
                note(f"missing 3D replay: {t['base']}.{ext}")

# ---- counts and numbers
c = suite["counts"]
if (c["tasks"], c["puzzles"], c["puzzle_families"], c["ikea_scenes"], c["types"], c["robots"]) != (90, 78, 19, 12, 6, 3) or len(tasks) != 90:
    note(f"task index counts: {c}")
text = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", page)))
if len(results["agents"]) != 7 or len(results["vla"]["policies"]) != 4:
    note("results.json: expected seven agents and four VLA policies")

# ---- a heading is followed by its picture
for head in re.findall(r'<div class="sec-title">(.*?)</div>', page, re.S):
    if "<p" in head:
        note("a paragraph under a section heading: " + re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", head)).strip()[:60])
if "<figcaption" in page:
    note("a figure caption on the page")
if re.search(r'<div class="step-text">(?:(?!</div>).)*<p', page, re.S):
    note("a sentence under a Get started step")
site_js = (ROOT / "assets/js/site.js").read_text() + (ROOT / "assets/js/oracle.js").read_text()
for word in ("difficulty", "very_easy", "Very easy", "Medium", "Hard"):
    if re.search(r"\b%s\b" % word, site_js) or re.search(r"\b%s\b" % word, json.dumps(suite)) or re.search(r"\b%s\b" % word, text):
        note(f"a difficulty rating is still on the page or in its data: {word!r}")

# ---- Get started: the README's own command lines
if "--readme" in sys.argv:
    readme = Path(sys.argv[sys.argv.index("--readme") + 1]).read_text()
    lines = {re.sub(r"\s+#.*$", "", l).rstrip() for block in re.findall(r"```(?:bash|text)?\n(.*?)```", readme, re.S) for l in block.splitlines()}
    start = page[page.index('id="start"'):page.index("</section>", page.index('id="start"'))]
    for block in re.findall(r'<pre class="code">(.*?)</pre>', start, re.S):
        for line in html.unescape(re.sub(r"<[^>]+>", "", block)).splitlines():
            if line.strip() and line.rstrip() not in lines:
                note(f"not a line of the README: {line!r}")

# ---- leftovers and names that must not be published
live = re.sub(r"<!--.*?-->", "", page, flags=re.S)
for word in ("Full benchmark coming soon", "preview-tag", "abs/ARXIV_ID", "arxiv.org/abs/XXXX", "robot_coding_bench", "/runs/", "mll-laptop", "/home/", "tmp/20"):
    for name, body in (("index.html", live), ("site.js", (ROOT / "assets/js/site.js").read_text()), ("suite.json", json.dumps(suite)), ("results.json", json.dumps(results))):
        if word.lower() in body.lower():
            note(f"{name} contains {word!r}")
if re.search(r'href="#"', live):
    note('index.html has a link to "#"')
if re.search(r'<a\b[^>]*>\s*arXiv', live) and "arxiv.org/abs/" not in live:
    note("an arXiv link without an arXiv address")
for name in ("Privileged", "Standard"):                  # the leaderboard's legend and the table's column groups
    if f"'{name}'" not in site_js:
        note(f"regime name missing from the leaderboard: {name}")

# ---- page metadata and the text written in for readers without JavaScript (scripts/prerender.py)
SITE = "https://roboarc.embodied-first-exam.ai/"
WRITTEN = {"index.html": ("filters", "wall", "lb-agents", "lb-vla", "results-table"), "runs/index.html": ("runs-head", "runs-body")}
for rel, ids in WRITTEN.items():
    t = (ROOT / rel).read_text()
    title = html.unescape(re.search(r"<title>(.*?)</title>", t, re.S).group(1).strip())
    desc = re.search(r'<meta name="description" content="([^"]*)">', t)
    desc = html.unescape(desc.group(1)) if desc else ""
    if len(title) > 70:
        note(f"{rel}: title of {len(title)} characters (at most 70)")
    if not 25 <= len(desc) <= 160:
        note(f"{rel}: description of {len(desc)} characters (25 to 160)")
    canon = re.findall(r'<link rel="canonical" href="([^"]+)">', t)
    if canon != [SITE + rel[: -len("index.html")]]:
        note(f"{rel}: canonical address {canon}")
    if "noindex" in t:
        note(f"{rel}: noindex")
    blocks = re.findall(r'<script type="application/ld\+json">(.*?)</script>', t, re.S)
    if not blocks:
        note(f"{rel}: no JSON-LD")
    for b in blocks:
        try:
            json.loads(b)
        except ValueError as e:
            note(f"{rel}: JSON-LD does not parse: {e}")
    for el in ids:
        m = re.search(r"<!--pre:%s-->(.*?)<!--/pre:%s-->" % (el, el), t, re.S)
        if not m or not re.sub(r"<[^>]+>|\s", "", m.group(1)):
            note(f"{rel}: no text written into #{el} (scripts/prerender.py)")
script_title = re.search(r"document\.title = window\.BRANDS\[window\.BRAND\]\[0\] \+ '([^']*)'", page)
if not script_title or "RoboARC" + script_title.group(1) != html.unescape(re.search(r"<title>(.*?)</title>", page).group(1)):
    note("index.html: the title set by the inline script differs from <title>")
robots = (ROOT / "robots.txt").read_text() if (ROOT / "robots.txt").exists() else ""
if f"Sitemap: {SITE}sitemap.xml" not in robots or re.search(r"(?mi)^Disallow:\s*/", robots):
    note("robots.txt: no sitemap line, or a path disallowed")
try:
    locs = [e.text for e in ET.parse(ROOT / "sitemap.xml").getroot().iter("{http://www.sitemaps.org/schemas/sitemap/0.9}loc")]
except (OSError, ET.ParseError) as e:
    locs = []
    note(f"sitemap.xml: {e}")
for loc in locs:
    if not loc.startswith(SITE) or not (ROOT / loc[len(SITE):] / "index.html").exists():
        note(f"sitemap.xml: not a page of this repository: {loc}")
if sorted(locs) != sorted(SITE + rel[: -len("index.html")] for rel in WRITTEN):
    note(f"sitemap.xml: lists {locs}")
for name in ("llms.txt", "llms-full.txt"):
    if not (ROOT / name).exists():
        note(f"{name} is missing")

for f in findings:
    print("FINDING", f)
print(f"check_site: {len(refs)} references, {len(tasks)} tasks, {sum(1 for t in tasks if t.get('video'))} clips, "
      f"{sum(1 for t in tasks if t.get('oracle'))} 3D replays, {len(findings)} finding(s)")
sys.exit(1 if findings else 0)
