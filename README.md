# RoboARC project page

Live at https://robotangle.embodied-first-exam.ai (GitHub Pages from `main` of
[Embodied-First-Exam/robotangle-website](https://github.com/Embodied-First-Exam/robotangle-website); `CNAME` holds the
domain, `.nojekyll` serves the files as they are).

The project page of RoboARC, a benchmark of spatial-constraint puzzles for robot manipulation (release 0.1.0: 94 tasks
in 14 families, each in two modes). It is static: plain HTML, CSS and ES modules, with three.js and three-mesh-bvh
vendored under `vendor/`. There is no build step.

## View it locally
```bash
cd ~/01_projects/05_robohoudini_web
python3 -m http.server 8765 --bind 127.0.0.1
```
Then open http://localhost:8765. Stop the server with Ctrl+C.

Preview knobs: `?theme=dark` (night); `?hero=0.5` freezes the opening at that scroll fraction, `?overview=1` gives a
short static opening; `?focus=puzzles` opens the page at a section; `?oracle=cast_coil` opens the 3D section on a family; `?name=robotangle` shows the page under another
name from the `BRANDS` table in `index.html` (`?names=1` adds a switcher). RoboARC is the default.

## The look
The Embodied First Exam series look: cool exam paper (`#f4f6f9`; night `#121417`), white cards with a hairline, rounded
corners and a soft shadow, a floating capsule for the navigation, pill buttons. Bricolage Grotesque for display, Inter
for text, JetBrains Mono for numbers and tiny labels; terracotta and teal as the accents. Day by default, night on the
toggle.

## What is on the page
1. **Opening (scroll-driven, real-time WebGL).** A two-arm ALOHA robot takes two interlocked claws apart, played back
   from its recorded plan (`hero.js`, `robot.js`, `stage.js`). It illustrates the kind of puzzle; it is not one of the
   release's tasks.
2. **Intro.** One paragraph and the key figures: 14 families, 94 tasks from very easy to hard, two modes (188 tasks in
   all), three hours per attempt; then the release's teaser reel (one reference solution per family).
3. **01 Puzzles.** One card per family, three per row, with group filters (rigid, rope and chain, cloth). Each card plays
   a reference solution of one task, replayed in a fresh simulator and sped up (the factor is on the card); the arrows
   step through the family's tasks in the release's numbering, with each task's difficulty.
4. **02 In 3D** (`oracle.js`, `play.js`). Every task with a reference video, redrawn in 3D from the replay that video
   shows: every piece, the robot, the rope and the cloth where the simulator had them. Watch the oracle: play, pause,
   scrub, speed, hide the robot, step through a family's tasks. Play it (23 rigid tasks: claws 01-03 and 11, coil 01-08,
   hedgehog 01-05, buzz wire 01, 02, 06, 08-10): one piece moves under a gizmo and stops at contact (exact mesh
   intersection in sub-steps, the table top too); where the robot moved two pieces, the other holds still and only
   their relative motion counts. "Show me how" plays the reference's own motion of the piece. A task is playable only
   if that motion clears the same check end to end, with at most 1 mm of contact tolerance, and counts as solved
   (`checkPath` in `play.js`, run headless). Watch only: cast keyhole (its pieces overlap at the start), claws 04/05/12,
   hedgehog 08, buzz wire 07 (blocked at 1 mm), and the puzzles where more than two pieces move.
5. **03 Two modes.** Privileged (code with the simulator open) next to standard (the robot as a service: cameras and
   the robot's own state, one episode, no resets).
6. **04 Results.** None yet for 0.1.0; the first evaluation will be posted here.

## Data
- `assets/data/roboarc.json` and `assets/media/roboarc/`: `scripts/make_roboarc_media.py` from the high-quality renders
  of the release's reference solutions (path-traced; each draws a fresh-process replay that ends on the release's
  expected final state), cut to 960x540 loops of at most 20 s, plus each task's difficulty from its `task.toml`, and the
  release teaser (`teaser.mp4`, 1280x720). Tasks without a reference video show a note.
- `assets/oracle/`: `scripts/export_roboarc_oracle.py` from the same replays' recorded poses (every drawn piece at every
  video frame, z-up) and meshes: per task `<base>.json` (parts, timing, framing) and `<base>.bin` (int16 tracks, rope
  centrelines from the surface by arc length, cloth grids by UV), and a shared library of decimated meshes `m/<id>.bin`.
  The lock's rotor discs are carried with their own bodies (exported as static by the renders).
- `assets/media/cams/`: the three agent cameras of a Cast Keyhole task at its frozen start.
- `assets/data/robot/`: `scripts/prepare_robot.py`, the opening's robot (the kinematic tree, the arms' meshes, the claw
  pieces and the recorded joint motion).

## Open items
- Reference videos for the tasks that have none yet (buzz wire 03-05; fiber bundling 05 stays without); the lock cards'
  videos show the rotor discs still (the 3D view turns them); results; paper and code links, authors, BibTeX.
- The claw meshes of the opening come from a demo whose redistribution licence is not stated upstream.
