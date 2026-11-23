#!/usr/bin/env python3
"""Write the text that the page scripts draw into the pages' HTML, so readers that do not run JavaScript see it too.

Much of the home page is drawn in the browser: assets/js/site.js reads assets/data/*.json and fills the constraint-type
filters, the puzzle wall, the two leaderboards and the table per constraint type. assets/js/runs.js fills the list of
agent runs from the public dataset RoboARC/RoboARC-runs. This script opens each page in headless Chrome, waits until
those elements are drawn, and writes what they hold back into the page file, between <!--pre:ID--> and <!--/pre:ID-->
(the element gets `data-pre`). Text only: pictures, videos, canvases and the makers' marks are left out. In the
browser the scripts draw the same elements again from the current data, so the page looks exactly as before.

Never edit inside a <!--pre:...--> block by hand: it is overwritten. Edit the script or the data instead.

Run it after any change to assets/data/, to site.js or runs.js, or to the elements listed in PAGES:
    uv run --with playwright python scripts/prerender.py
(or `pip install playwright` once, then `python3 scripts/prerender.py`). It uses Google Chrome, or Playwright's own
Chromium (`playwright install chromium`). A page whose elements are not all drawn (for instance when the runs could
not be loaded) is left as it was, and the script exits with 1: run it again later.
"""
from __future__ import annotations

import asyncio
import functools
import http.server
import re
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# page -> the elements whose content is written into it, and what must be on the page before it counts as drawn
PAGES = {
    "index.html": {
        "ids": ["filters", "wall", "lb-agents", "lb-vla", "results-table"],
        "ready": ["#filters .chip", "#wall .card", "#lb-agents .lbh-row", "#lb-vla .lbh-row", "#results-table tbody tr"],
    },
    "runs/index.html": {
        "ids": ["runs-head", "runs-body"],
        "ready": ["#runs-head h1", "#ri-lead", "#ri-list .rr:not(.rr-head)", "#f-family option"],
    },
}
BLOCK = re.compile(r"<!--pre:([\w-]+)-->.*?<!--/pre:\1-->", re.S)
FAILED = ("could not be loaded", "Loading the runs", "No run matches")


def element(el: str) -> re.Pattern:
    """The element with this id, empty (as it is once its block is taken out)."""
    return re.compile(r'<([a-zA-Z][\w-]*)\b([^>]*?\bid="%s"[^>]*)>\s*</\1>' % re.escape(el))


def shell(text: str) -> str:
    """The page as the scripts expect to find it: every written block taken out again."""
    return BLOCK.sub("", text)


def fill(text: str, parts: dict[str, str]) -> str:
    for el, inner in parts.items():
        pat = element(el)
        if len(pat.findall(text)) != 1:
            raise ValueError(f"element #{el} not found once as an empty element")

        def put(m: re.Match, el=el, inner=inner) -> str:
            tag, attrs = m.group(1), m.group(2)
            if not re.search(r"\sdata-pre\b", attrs):
                attrs += " data-pre"
            return f"<{tag}{attrs}><!--pre:{el}-->{inner}<!--/pre:{el}--></{tag}>"
        text = pat.sub(put, text, count=1)
    return text


def serve() -> tuple[http.server.ThreadingHTTPServer, int]:
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a, **k):
            pass
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(ROOT)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, srv.server_address[1]


CAPTURE = """(ids) => {
  // text only: media are left out (the scripts draw them when the page loads), so the page gets no heavier to
  // download and nothing is fetched twice
  const out = {};
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) { out[id] = ''; continue; }
    const c = el.cloneNode(true);
    c.querySelectorAll('img, picture, video, audio, source, iframe, canvas, object, embed, svg').forEach((m) => m.remove());
    c.querySelectorAll('[style]').forEach((m) => {
      const st = m.getAttribute('style');
      if (/url\\(/.test(st)) m.setAttribute('style', st.replace(/[\\w-]*image\\s*:[^;]*url\\([^)]*\\)[^;]*;?/g, ''));
    });
    out[id] = c.innerHTML.trim();
  }
  return out;
}"""
READY = """(sels) => sels.filter((s) => !document.querySelector(s))"""


async def render(port: int) -> dict[str, dict]:
    from playwright.async_api import async_playwright
    results: dict[str, dict] = {}
    async with async_playwright() as pw:
        args = ["--password-store=basic"]
        try:
            browser = await pw.chromium.launch(channel="chrome", args=args)
        except Exception:
            browser = await pw.chromium.launch(args=args)
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce")

        async def light(route):
            # pictures, videos, fonts and the 3D data are not needed for the text: leave them out
            r = route.request
            if r.resource_type in ("image", "media", "font") or "/assets/oracle/" in r.url or "/assets/data/robot/" in r.url:
                await route.abort()
            else:
                await route.continue_()
        await ctx.route("**/*", light)

        for rel, spec in PAGES.items():
            url = f"http://127.0.0.1:{port}/{rel[:-len('index.html')]}"
            text = shell((ROOT / rel).read_text(encoding="utf-8"))
            page = await ctx.new_page()
            errors: list[str] = []
            notes: list[str] = []
            page.on("pageerror", lambda e: notes.append(str(e)))
            # the page as the scripts expect to find it, whatever was written into the file before
            async def as_shell(route, _request=None, body=text):
                await route.fulfill(status=200, content_type="text/html; charset=utf-8", body=body)
            await page.route(url, as_shell)
            await page.goto(url, wait_until="load", timeout=60000)
            missing = spec["ready"]
            for _ in range(120):                     # up to 60 s for the data (the runs index is a few MB)
                missing = await page.evaluate(READY, spec["ready"])
                if not missing:
                    break
                await page.wait_for_timeout(500)
            if missing:
                errors.append("not drawn: " + ", ".join(missing))
            last = -1
            for _ in range(20):                      # then until the page stops changing
                n = await page.evaluate("document.body.innerHTML.length")
                if n == last:
                    break
                last = n
                await page.wait_for_timeout(500)
            parts = await page.evaluate(CAPTURE, spec["ids"])
            for el, inner in parts.items():
                if not inner:
                    errors.append(f"#{el} is empty")
                elif any(w in inner for w in FAILED):
                    errors.append(f"#{el} shows an error or a loading state")
            await page.close()
            results[rel] = {"parts": parts, "errors": errors, "notes": notes}
        await browser.close()
    return results


def main() -> int:
    try:
        import playwright  # noqa: F401
    except ImportError:
        print("prerender: needs Playwright for Python: `uv run --with playwright python scripts/prerender.py`, or "
              "`pip install playwright` first", file=sys.stderr)
        return 1
    srv, port = serve()
    try:
        res = asyncio.run(render(port))
    finally:
        srv.shutdown()
    bad = 0
    for rel, r in res.items():
        path = ROOT / rel
        before = path.read_text(encoding="utf-8")
        old = {m.group(1): len(m.group(0)) - 2 * len(m.group(1)) - 23 for m in BLOCK.finditer(before)}   # without the markers
        sizes = ", ".join(f"{el} {old.get(el, 0):,} -> {len(v):,}" for el, v in r["parts"].items())
        for n in r["notes"]:
            print(f"  {rel}: script error on the page (not written into it): {n[:160]}")
        if r["errors"]:
            bad += 1
            print(f"  {rel}: LEFT AS IT WAS: {'; '.join(r['errors'])}", file=sys.stderr)
            continue
        after = fill(shell(before), r["parts"])
        written = {m.group(1) for m in BLOCK.finditer(after)}
        if written != set(PAGES[rel]["ids"]):
            bad += 1
            print(f"  {rel}: LEFT AS IT WAS: blocks written {sorted(written)}", file=sys.stderr)
            continue
        if after != before:
            path.write_text(after, encoding="utf-8")
        print(f"  {rel}: {'written' if after != before else 'unchanged'} ({sizes} characters)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
