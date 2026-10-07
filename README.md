# TopoGym project page

Live at https://robotangle.embodied-first-exam.ai (GitHub Pages from `main` of
[Embodied-First-Exam/robotangle-website](https://github.com/Embodied-First-Exam/robotangle-website); `CNAME` holds the
domain, `.nojekyll` serves the files as they are).

The project page of the TopoGym puzzles for robots. The public name is still open, so the page wears any of the
candidates (RoboTangle, RoboBind, RoboUnstuck, RoboUnravel, In a Bind, RoboARC). It is static: plain HTML, CSS and ES
modules, with three.js and three-mesh-bvh vendored under `vendor/`. There is no build step.

## View it locally
```bash
cd ~/01_projects/05_robohoudini_web
python3 -m http.server 8765 --bind 127.0.0.1
```
Then open http://localhost:8765. Over VS Code Remote-SSH the port is forwarded automatically. Stop the server with Ctrl+C.

Preview knobs:
- `?name=robobind` (or `robotangle`, `robounstuck`, `robounravel`, `inabind`, `roboarc`) shows the page under that
  name; `?names=1` adds a switcher in the bottom-left corner. Names and taglines live in one table, `BRANDS` in
  `index.html`.
- `?theme=dark` forces night; the moon/sun button switches and is remembered in the browser.
- `?hero=0.5` freezes the opening at that scroll fraction; `?overview=1` gives a short, static opening.
- `?focus=play` opens the page at a section; `?puzzle=lock_picking` opens that puzzle in the play section.
- `?board=sample` adds invented rows, marked "sample", to preview the leaderboard with more entries. They are not results.
- `?selftest=1` (or `?selftest=lock_picking,knot_untying`) writes the play self-test, every tier, into `body[data-selftest]`:
  for rigid puzzles whether the start is clear and how many samples of the solution path intersect.
- `?shortcut=interlocked_claws:hard` writes the samples a shortened solution path keeps into `body[data-shortcut]`
  (for `scripts/shortcuts/`, read by `scripts/export_oracle_poses.py`).
- `?ropeplay=1` lets the visitor pull the ropes instead of watching the demonstrations.

## The look
The Embodied First Exam pages' look, since this site is one of that series (aligned 2026-10-06 at the exam session's
request): cool exam paper (`#f4f6f9`; night `#121417`), white cards with a hairline, rounded corners and a soft shadow,
a floating capsule for the navigation (pill links, the current section solid, a round day/night button; a menu card on
narrow screens), pill buttons and segmented controls. Bricolage Grotesque for display and the wordmark, Inter for text,
links and buttons, JetBrains Mono for numbers, code and tiny labels. The content keeps its own two accents, the claws'
terracotta and teal, so the page and the simulation renders agree. Day by default, night on the toggle. The 3D stage
(`assets/js/stage.js`) is a quiet studio in the page's colour (the play stage in its card's white): a shadow-only floor
with a faint blue measuring grid, one key light with soft shadows, fill and sky light, a dim room environment.

## What is on the page
1. **Opening (scroll-driven, real-time WebGL).** The two-arm ALOHA robot of the robot-puzzle demo takes the
   interlocked claws apart, played back from its recorded plan: a close look first, captions taking turns, then a wide
   shot with the name and the calls to action. (`hero.js`, `robot.js`)
2. **Intro.** One paragraph and the key figures: 13 puzzle families, 39 frozen instances (easy / medium / hard), two
   modes, six hours per attempt.
3. **01 Puzzles.** 13 cards, three per row, with group filters. Each plays the oracle's solution, the verifier's
   replay in a fresh simulator, sped up (the factor is on the card), with an easy / medium / hard switch. Slotted Post
   Ring and Orbits have no passing oracle replay yet and show a still. Cards of playable puzzles link to section 02 at
   the tier on show.
4. **02 Try one yourself.** (`play.js`, `puzzles.js`) Every puzzle with an oracle run comes two ways, the visitor's
   choice (`Play it` / `Watch the oracle`):
   - **Watch the oracle**: the oracle's whole run in 3D, every moving piece where the simulator had it (a fresh-process
     re-run of the graded trajectory, `oracle_poses/`), the robot hidden and its pauses left out, on the table as in the
     simulation (16 to 45 s). The run starts exactly where the puzzle does (within 0.004 mm, `?selftest`).
   - **Play it**, for the rigid puzzles: Interlocked Claws, Cast Keyhole, Cast Coil, Hedgehog in a Cage and Buzz Wire 3D
     (easy / medium / hard) on the oracle's exact tier geometry: the fixed pieces stay put, the orange one moves, and
     every move is checked against the exact meshes. The robot presses the pieces together as it slides them, so the
     check allows contact up to 0.25 mm: the moving piece's collision proxy is its mesh shrunk by that much all round
     (`inset` in `play.js`, each corner moved so every face meeting there moves in). Under that rule every sample of every
     "Show me how" path is clear (`?selftest=1`), and straight pushes of the moving piece are blocked in all six
     directions at the start of every interlocked tier.
   - "Show me how" (play mode) plays the oracle's motion relative to the fixed piece, the pauses and regrasps left out
     (16 to 53 s; the view eases out so both pieces stay in frame). It stops where a plane first separates the pieces and
     goes on as a straight pull along that plane's normal until the page counts them apart. Cast Coil is an assembly task
     in TopoGym (the halves start apart), so its goal is the oracle's final pose (2 mm, 0.03 rad; the grader allows 1 mm,
     0.02 rad). Buzz Wire keeps the whole run; the oracle's own loop path is the rail that measures progress.
   - Interlocked Claws hard: the oracle took 365 s and 30 m of corner travel to unhook the claws. "Show me how" shortens
     it to 14 of its samples joined by straight moves (`?shortcut=interlocked_claws:hard`, kept in `scripts/shortcuts/`),
     each move checked against the exact pieces at the very poses the export re-samples it into: 2.9 m, 35 s.
   - Lock Picking (easy / medium / hard): play the key along the lock and about it; the rotors follow its tabs by
     TopoGym's rules (`lockTry`): a tab passes a plate only through a slot (4 degrees of play), turning with a tab in a
     rotor drags it up to its stop. A straight push stops at 0.142 m (TopoGym's mesh scan: 0.1425). Checked against the
     oracle's runs: the rules accept every step of the oracle's key motion in every tier, and the rotor angles they
     compute stay within 1.7 degrees of the simulator's. "Show me how" plays that key motion through the rules (18 to
     35 s); watching shows the key picked off its tray and pushed through.
   - Watch only: Horseshoe Ring and Fiber Bundling (easy / medium / hard): the horseshoes, chain links and ring; the
     cable, sheath and fibers, which TopoGym builds as chains of short rigid segments (up to 186). Fiber Bundling's view
     opens on the copper ring.
   - Rope, to watch (Knot Untying, Rope Threading; easy / medium / hard): no oracle poses (TopoGym's ropes are soft
     bodies), so these are simulated live in the page and solved by a scripted demonstration (`demos.js`, fixed 1/60 s
     per frame, a marker on the point being pulled). `rope.js` is a particle rope (position-based dynamics: stretch, bend,
     swept collisions with the fixed parts, floor friction, self-collision so a knot stays a knot). Goals follow the
     graders; every tier's demonstration counts as solved (knot 11.6 / 21.5 / 32.1 s, threading 5.9 / 7.9 / 7.9 s).
   - Blanket Flatten is not in the play section (10-06, the user's call): the page's own cloth simulation did not look
     like TopoGym's, and the oracle's cloth was not recorded. Its code and data are parked in `tmp/`.
5. **03 Two modes.** Privileged (code with the simulator open) next to standard (the robot as a remote service).
6. **04 Results.** The leaderboard (a row is a model, the harness a filter, VLA policies on their own tab, sortable
   by mode) and five agent rollouts.

## Data and where it came from
- `assets/data/robot/`: `scripts/prepare_robot.py` from the robot-puzzle demo (`qinengwang-aiden.github.io/demos/
  constraint_demos`, `data/claw/manifest.json` and `geometry.json`): the kinematic tree, both arms' visible meshes
  (detailed ones thinned by vertex clustering to 2 mm), the claw pieces with their grasp transforms, and the unlock
  phase's joint positions re-sampled by motion (600 frames; 0.9 MB in all).
- `assets/media/oracle/` and `assets/data/oracle.json`: `scripts/make_oracle_media.py` from the oracle replay videos in
  `robot_coding_bench/jobs/journal/2026-10-04/oracle_videos/` (the newest passing privileged replay per family and tier,
  release v18 except where that folder's INDEX.md says otherwise: Blanket Flatten from v19, Buzz Wire hard and Fiber
  Bundling hard from older images; the rigid ones are the very runs the play section's poses come from): main camera
  only, sped up to at most 22 s, H.264. `--only <family>` re-cuts one family.
- `assets/data/puzzles/knot_untying|rope_threading/<tier>/`: `scripts/export_soft.py` from the folder written by
  `scripts/topogym/export_knot.py` and `export_threading.py` (run in the TopoGym image with `scripts/topogym/run.sh
  <checkout> <out> <script>`): the frozen Harbor instances' start states (rope centrelines from the FEM surface rings) of
  the v14 tier instances.
- `assets/data/puzzles/{interlocked_claws,cast_keyhole,cast_coil,hedgehog_in_cage,buzz_wire_3d}/<tier>/`:
  `scripts/export_oracle_poses.py` from `robot_coding_bench/jobs/journal/2026-10-04/oracle_poses/<family>-<tier>/`: a
  fresh-process re-run of each graded oracle trajectory in its release image (`labv18b/rcb-topogym:0.2.16-dev-cu128`,
  final state hash equal to the verdict's), with the moving links' poses (`keyframes.json`) and meshes. Visual meshes
  lie inside the simulator's collision parts (equal for the keyhole and coil), and the oracle's convex collision parts
  never overlap by more than 0.06 mm at its keyframes, so the page can collide what it shows. A few single 25 ms control
  steps move further than the keyframe rule (keyhole up to 15 mm, hedgehog easy and buzz easy / medium up to 26 mm) with
  nothing recorded in between; the export interpolates them, and the page checks those poses like the rest. Zero-area triangles are
  dropped (three-mesh-bvh reports them as hits; the claws' medium mesh had 14).
- Every `replay` in a `puzzle.json` (the oracle's run to watch, `replay.bin`: per sample and moving body, position and
  quaternion as int16 over the run's box, posing the very meshes the puzzle draws), `horseshoe_ring|fiber_bundling/<tier>/`
  and the `oracle` key motion in `lock_picking/<tier>/puzzle.json`: also `scripts/export_oracle_poses.py`.
- `assets/data/puzzles/lock_picking/<tier>/`: `scripts/export_rigid.py` from
  `scripts/topogym/export_rigid.py` (bodies posed as the tasks spawn them) and `lock_solver.py` (the move sequences).
- `assets/media/posters/`, `cams/` and `rollouts/` were cut from the TopoGym v14 sweep replays (codex-gpt6_luna-max).
- `assets/data/results.json` is a snapshot of the v14 sweep on 2026-10-04 (Codex CLI with GPT-6 Luna, maximum
  reasoning). It is preliminary.

## Open items
- Oracle videos for Slotted Post Ring and Orbits.
- The claw meshes' redistribution licence is not established upstream. Settle it before the site goes public.
- The name; paper and code links, authors, BibTeX.
- Final results; more harnesses, models and VLA policies.
- Hosting: GitHub Pages serves the videos from git (32 MB); move them to Hugging Face if they grow.
