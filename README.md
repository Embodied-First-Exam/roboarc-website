# RoboARC project page

Live at https://robotangle.embodied-first-exam.ai (GitHub Pages from `main` of
[Embodied-First-Exam/robotangle-website](https://github.com/Embodied-First-Exam/robotangle-website); `CNAME` holds the
domain, `.nojekyll` serves the files as they are).

The project page of RoboARC, a benchmark of spatial-constraint puzzles for robot manipulation (release 0.1.0: 94 tasks
in 14 families, each in two modes). It is static: plain HTML, CSS and ES modules, with three.js vendored under
`vendor/`. There is no build step.

## View it locally
```bash
cd ~/01_projects/05_robohoudini_web
python3 -m http.server 8765 --bind 127.0.0.1
```
Then open http://localhost:8765. Stop the server with Ctrl+C.

Preview knobs: `?theme=dark` (night); `?hero=0.5` freezes the opening at that scroll fraction, `?overview=1` gives a
short static opening; `?focus=puzzles` opens the page at a section; `?name=robotangle` shows the page under another
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
   all), three hours per attempt.
3. **01 Puzzles.** One card per family, three per row, with group filters (rigid, rope and chain, cloth). Each card plays
   a reference solution of one task, replayed in a fresh simulator and sped up (the factor is on the card); the arrows
   step through the family's tasks in the release's numbering, with each task's difficulty.
4. **02 Two modes.** Privileged (code with the simulator open) next to standard (the robot as a service: cameras and
   the robot's own state, one episode, no resets).
5. **03 Results.** None yet for 0.1.0; the first evaluation will be posted here.

## Data
- `assets/data/roboarc.json` and `assets/media/roboarc/`: `scripts/make_roboarc_media.py` from the review videos of the
  release's reference solutions (each a fresh replay that ends on the release's expected final state), cut to 960x540
  loops of at most 20 s with the review label cropped away, plus each task's difficulty from its `task.toml`. Tasks
  without a reference video yet show a note (Blanket Fold: its target shape).
- `assets/media/cams/`: the three agent cameras of a Cast Keyhole task at its frozen start.
- `assets/data/robot/`: `scripts/prepare_robot.py`, the opening's robot (the kinematic tree, the arms' meshes, the claw
  pieces and the recorded joint motion).

## Open items
- Reference videos for the tasks that have none yet; results; paper and code links, authors, BibTeX.
- The claw meshes of the opening come from a demo whose redistribution licence is not stated upstream.
