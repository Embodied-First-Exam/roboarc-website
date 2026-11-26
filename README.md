# RoboARC project page

Live at https://roboarc.embodied-first-exam.ai (GitHub Pages from `main` of
[Embodied-First-Exam/roboarc-website](https://github.com/Embodied-First-Exam/roboarc-website); `CNAME` holds the
domain, `.nojekyll` serves the files as they are).

The project page of the paper "RoboARC: Physical Puzzles for Robotic Manipulation under Spatial Constraints" and of
its code release ([mll-lab-nu/RoboARC](https://github.com/mll-lab-nu/RoboARC)): 90 tasks in six constraint types over
rigid and soft materials, on three robots, each in a Privileged and a Standard regime. The page is static: plain HTML,
CSS and ES modules, with three.js and three-mesh-bvh vendored under `vendor/`. There is no build step.

## View it locally
```bash
cd ~/01_projects/05_robohoudini_web
python3 -m http.server 8765 --bind 127.0.0.1
```
Then open http://localhost:8765. Stop the server with Ctrl+C.

Preview knobs: `?theme=dark` (night); `?hero=0.5` freezes the opening at that scroll fraction, `?overview=1` gives a
short static opening; `?focus=puzzles` opens the page at a section; `?oracle=cast_coil` opens the 3D section on a family; `?name=robotangle` shows the page under another
name from the `BRANDS` table in `index.html` (`?names=1` adds a switcher). RoboARC is the default. `?reel=1` shows the
teaser reel under Figure 1; `?palette=paper` draws the leaderboard's Standard bars in the paper's teal (`#5a9ea2`).

## Check it before publishing
```bash
python3 scripts/check_site.py --readme <code release>/README.md
```
Every local file the page refers to, the paper's counts in the task index, the "Get started" commands against the code
release's README line by line, no leftover placeholder, and the page metadata below (title and description lengths,
JSON-LD, the written-in text, `robots.txt` and `sitemap.xml`). It ends with `0 finding(s)`.

## Text for readers without JavaScript
The filters, the puzzle wall, the leaderboards and the table per constraint type (home), and the head and first page
of the agent runs (`runs/`), are drawn by `site.js` and `runs.js`. A copy of that text is written into the HTML, between
`<!--pre:ID-->` and `<!--/pre:ID-->`, so that crawlers and assistants that read the HTML without running it find the
content. In the browser the scripts draw the same elements again, so the page looks the same. After any change to
`assets/data/`, to `site.js` or `runs.js`, or to those elements, write it again (headless Chrome, about 5 s):
```bash
uv run --with playwright python scripts/prerender.py
```
Never edit inside a `<!--pre:...-->` block by hand. If an element is not drawn (for instance when the runs cannot be
loaded from Hugging Face), the script leaves that page as it was and exits with 1: run it again later.

## Page metadata
- `robots.txt` lets every crawler in, AI crawlers named one by one, and points to `sitemap.xml` (the home page and
  `runs/`; raise `<lastmod>` when a page's text changes).
- Each page's head: `<title>` of at most 70 characters (the home title is also set by the inline script, keep the two
  the same), `<meta name="description">` of 25 to 160 characters, the canonical address, the Open Graph and X card
  preview (the teaser poster `assets/media/roboarc/teaser.jpg`), and JSON-LD: the paper, the benchmark as a dataset and
  the code on the home page, the agent runs on `runs/`. The home page also has `citation_*` tags for reference managers.
- `llms.txt` (summary) and `llms-full.txt` (questions and answers) for language models, with the numbers of
  `assets/data/*.json` written out by hand: when the tasks or the results change, change them there too, with the
  JSON-LD descriptions.

## The look
The Embodied First Exam series look: cool exam paper (`#f4f6f9`; night `#121417`), white cards with a hairline, rounded
corners and a soft shadow, a floating capsule for the navigation, pill buttons. Bricolage Grotesque for display, Inter
for text, JetBrains Mono for numbers and tiny labels; terracotta and teal as the accents. Day by default, night on the
toggle. The page is a page of pictures: a heading is followed directly by its visual, with no paragraph under a
heading, no abstract, no figure caption and no difficulty rating (`scripts/check_site.py` enforces this).

## What is on the page
1. **Opening (scroll-driven, real-time WebGL).** A two-arm ALOHA robot takes two interlocked claws apart, played back
   from its recorded plan (`hero.js`, `robot.js`, `stage.js`). At the end the paper's title comes in with the buttons:
   arXiv (https://arxiv.org/abs/2611.33390), Code (with the GitHub mark) and Agent runs.
2. **Intro.** The paper's title, its authors (every name linked to a homepage, underlined on hover) with affiliations
   and contribution marks as in the arXiv version, the same three buttons, the research question as one big line, and
   Figure 1 (`assets/media/paper/figure1.png`; on phones its three panels stacked, `figure1_a/b/c.png`; a tap opens
   the full figure). The teaser reel is off the page (`?reel=1` shows it).
3. **01 Puzzles.** One card per family that has a clip, three per row, in the order of the paper's six constraint
   types, which are also the filters. A card is its clip, a stepper, the family's name and its constraint type; the
   goal sentence shows over the clip on hover or focus. The clip plays while the card is in view; the arrows step
   through the family's tasks by number (IKEA scenes by name). A card opens on the task named by `start` in the
   `FAMILIES` table of `site.js`.
4. **02 In 3D** (`oracle.js`, `play.js`). The tasks with a 3D replay, redrawn from the replay their video shows:
   every piece, the robot, the rope and the cloth where the simulator had them. Watch the oracle: play, pause, scrub,
   speed, hide the robot, step through a family's tasks. One line in the viewer says how to turn and zoom and goes
   after the first drag. The opening view frames the puzzle; where an arm would then reach in from outside the picture
   at some moment of the run (18 replays at the desktop size: buzz wire, hedgehog, fiber bundling, coil 04 and 05,
   keyhole 02 and 04, horseshoe 02, knot 02), it is the nearest view on the same line of sight that holds the whole
   robot (`watchView`). Play it (12 rigid tasks: claws 02 and 11, coil 04-08, hedgehog 02 and 03, buzz wire 02, 06 and
   10): one piece moves under a gizmo and stops at contact (exact mesh intersection in sub-steps, the table top too);
   where the robot moved two pieces, the other holds still, lifted clear of the table, and only their relative
   motion counts. "Show me how" plays the reference's own motion of the piece. A task is playable only if that motion
   clears the same check end to end, with at most 1 mm of contact tolerance, and counts as solved (`checkPath` in
   `play.js`, run headless).
5. **03 Two regimes** (the section keeps the id `modes`). The top strip of the paper's overview figure
   (`assets/media/paper/regimes.png`; on phones its two rows, `regimes_rows.png`): what a coding agent sends and
   receives in the Standard and in the Privileged regime, the VLA policies, and the one grader.
6. **04 Leaderboard.** One row per model, sorted by its Standard rate: the Standard rate, a track from 0 to 100 % with
   a wide pale bar for the Privileged rate and a teal bar inside it for the Standard rate, and the Privileged rate
   (the All columns of the paper's main table; the numbers line up on the decimal point). The harness is a small tag,
   spelt out, without version numbers; hovering a row gives the standard deviations. A second tab holds the four VLA
   policies, a reference on their own 18 puzzles (solved, and the share of episodes in which the gripper touched the
   object). The paper's table per constraint type is behind one closed toggle. Numbers: `assets/data/results.json`.
7. **05 Get started.** Three steps (install, pull the images, evaluate an agent) with command lines of the code
   release's README, without their trailing comments, and a link to the full guide; `scripts/check_site.py --readme`
   verifies every line against that README.
8. **Footer.** Links and the BibTeX entry of the code release's README.

## Data
- `assets/data/suite.json`: `scripts/make_suite.py <paper dir> --ikea-meta DIR --release <code release>`. The paper's
  90 tasks (its table of every task, with the constraint type), their families and robots, joined with the clips and
  3D replays this repository holds. The script stops if the counts differ from the paper's. With `--release` a clip
  or replay is kept only if it was made from the release's current reference solution (same length); the others are
  listed under `superseded` in the file and stay off the page.
- `assets/data/results.json`: `scripts/make_results.py <paper dir>`, the numbers of the paper's two result tables as
  printed.
- `assets/media/paper/figure1.png`: Figure 1 of the paper, `pdftoppm -r 144 -png` of
  `arxiv/figures/teaser_candidates/teaser_c4.pdf` (3000x1200); `figure1_a/b/c.png` are its three panels (columns
  0-910, 910-1963, 1963-3000). `assets/media/paper/regimes.png`: the top 608 rows of `arxiv/figures/fig_overview.pdf`
  rendered the same way (3000x608); `regimes_rows.png` is its Standard and its Privileged row (columns 1026-2544).
- `assets/data/roboarc.json` and `assets/media/roboarc/`: `scripts/make_roboarc_media.py` from the studio renders of
  the reference solutions (Blender Cycles; each draws the states of a fresh-process replay that ends on the expected
  final state), cut to 1280x720 loops of at most 20 s, and the teaser reel (`teaser.mp4`, 1920x1080; not on the page at
  present). `oracle` marks the tasks whose 3D replay is in `assets/oracle/`. The index lists 98 tasks of October 2026
  and the 12 tasks added later (bed bolt 01-05, clock assembling 01, battery replacement 01, caliper sorting 01, wire
  splicing 01, interlocked claws 13, knot untying 07, orbits 02); the page shows those that are among the paper's 90.
  Those 12, and blanket fold 05 and fiber bundling 05, whose reference solutions changed, were rendered on 2026-11-22 from
  the code release's reference solutions (2.2.1) in the same studio look and timing, at 1280x720 and only the frames
  the loop keeps; their entries were written into `roboarc.json`.
- `assets/media/roboarc/ikea-<scene>-i00.{mp4,jpg}`: the 12 IKEA scenes in the same studio look (1280x720): SVALLET a
  copy of `site/roboarc/ikea_svallet.{mp4,jpg}` of the public dataset `MLL-Lab/embodied-exam-data` on Hugging Face, the
  other 11 rendered on 2026-11-22 from the code release's reference solutions.
- `assets/oracle/`: `scripts/export_from_scenes.py` from the scenes the clips were rendered from (earlier
  `scripts/export_roboarc_oracle.py` from the same replays' recorded poses; every drawn piece at every video frame, z-up)
  and meshes: per task `<base>.json` (parts, timing, framing) and `<base>.bin` (int16 tracks, rope
  centrelines from the surface by arc length, cloth grids by UV), and a shared library of meshes `m/<id>.bin`, decimated only as far as each keeps its box and area.
  The lock's rotor discs are carried with their own bodies (exported as static by the renders).
- `assets/media/cams/`: the three agent cameras of a Cast Keyhole task at its frozen start (not on the page at present).
- `assets/data/robot/`: `scripts/prepare_robot.py`, the opening's robot (the kinematic tree, the arms' meshes, the claw
  pieces and the recorded joint motion).

## Open items
- No IKEA scene has a 3D replay.
- Clips and 3D replays of tasks outside the paper's 90 are still in `assets/` and are no longer referenced.
