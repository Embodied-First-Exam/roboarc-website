// Demonstrations for the rope puzzles, played in the live simulation: each is a generator that sets where the
// held point should be and yields once per frame (the caller steps the simulation by a fixed 1/60 s after each yield),
// so it runs the same on every machine. They are scripted, not recorded: TopoGym has no solution to replay for these.
import * as THREE from 'three';

const V = THREE.Vector3;

function* wait(frames) { for (let k = 0; k < frames; k++) yield; }

/** Hold particle i and walk it through the points, `steps` frames per leg; let go and let it settle. */
function* hold(sim, i, path, steps = 45) {
  sim.grab(i);
  let from = sim.get(i, new V());
  for (const b of path) {
    for (let k = 1; k <= steps; k++) { sim.drag(from.clone().lerp(b, k / steps)); yield; }
    from = b.clone();
  }
  yield* wait(10);
  sim.release();
  yield* wait(15);
}

function centroid(sim) {
  const m = new V();
  for (let i = 0; i < sim.n; i++) m.add(sim.get(i, new V()));
  return m.divideScalar(sim.n);
}

// Untie the overhand knot: draw a loop of the near side along the rope, pull the ends apart, and carry any strand that
// still lies across another over the nearer end. (Seen from above, the crossings go 3, 2, 1, 0.)
function* knot(rope, pz) {
  yield* wait(20);
  if (pz.tier === 'medium') {            // the overhand knot: first draw the near side along the rope, loosening the knot
    const g = 62, p = rope.get(g, new V()), t = rope.get(g + 1, new V()).sub(rope.get(g - 1, new V())).normalize();
    yield* hold(rope, g, [p.clone().add(new V(0, 0.03, 0)), p.clone().add(new V(0, 0.03, 0)).addScaledVector(t, 0.3), p.clone().addScaledVector(t, 0.3).setY(0.006)]);
  }
  if (pz.tier === 'hard') {              // the figure-eight: pull the far side out of the knot first (TopoGym's notes: s = 1.135 m, 0.55 m out)
    const g = Math.round(1.135 / rope.spacing), p = rope.get(g, new V()), out = p.clone().sub(centroid(rope)).setY(0).normalize();
    yield* hold(rope, g, [p.clone().add(new V(0, 0.03, 0)), p.clone().addScaledVector(out, 0.55).setY(0.03), p.clone().addScaledVector(out, 0.55).setY(0.006)], 70);
  }
  for (let round = 0; round < 5; round++) {
    for (const end of [0, rope.n - 1]) {
      const e = rope.get(end, new V()), d = e.clone().sub(centroid(rope)).setY(0).normalize();
      yield* hold(rope, end, [e.clone().add(new V(0, 0.02, 0)), e.clone().addScaledVector(d, 0.25).setY(0.02), e.clone().addScaledVector(d, 0.25).setY(0.006)]);
    }
    const cross = crossing(rope);
    if (!cross) {                         // no crossing left: straighten it out so no two strands lie side by side
      const a = rope.get(0, new V()), b = rope.get(rope.n - 1, new V()), c = centroid(rope), d = b.clone().sub(a).setY(0).normalize();
      const half = 0.42 * rope.spacing * rope.n;
      yield* hold(rope, 0, [a.clone().setY(0.02), c.clone().addScaledVector(d, -half).setY(0.02), c.clone().addScaledVector(d, -half).setY(0.006)]);
      yield* hold(rope, rope.n - 1, [rope.get(rope.n - 1, new V()).setY(0.02), c.clone().addScaledVector(d, half).setY(0.02), c.clone().addScaledVector(d, half).setY(0.006)]);
      return;
    }
    const { over, under } = cross, tailEnd = under < rope.n / 2 ? 0 : rope.n - 1;
    const o = rope.get(over, new V()), te = rope.get(tailEnd, new V()), side = te.clone().sub(rope.get(under, new V())).setY(0).normalize();
    yield* hold(rope, over, [o.clone().setY(0.05), te.clone().addScaledVector(side, 0.06).setY(0.05), te.clone().addScaledVector(side, 0.06).setY(0.006)]);
  }
}

function crossing(rope) {             // the first crossing seen from above: which particle is on top, which underneath
  const x = rope.x, n = rope.n;
  for (let i = 0; i < n - 1; i++) for (let j = i + 2; j < n - 1; j++) {
    const ax = x[3 * i], az = x[3 * i + 2], bx = x[3 * i + 3], bz = x[3 * i + 5], cx = x[3 * j], cz = x[3 * j + 2], dx = x[3 * j + 3], dz = x[3 * j + 5];
    const d1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax), d2 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
    const d3 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx), d4 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
    if (d1 * d2 < 0 && d3 * d4 < 0) return x[3 * i + 1] > x[3 * j + 1] ? { over: i, under: j } : { over: j, under: i };
  }
  return null;
}

// Thread the red-tipped end through the rings in the required order, each crossed the required way (the tip travels along
// the ring's normal times the sign the grader asks for), then draw some rope through after it.
function* thread(rope, pz) {
  yield* wait(20);
  const tip = rope.n - 1, start = rope.get(tip, new V()), path = [start.clone().add(new V(0, 0.05, 0))];
  const rings = pz.goal.order.map((o) => [pz.goal.rings.find((r) => r.name === o.slice(0, -1)), o.endsWith('+') ? 1 : -1]);
  rings.forEach(([r, s], i) => {
    const at = (k) => r.center.clone().addScaledVector(r.normal, s * k);
    if (i === 0) path.push(at(-0.12).add(new V(0, 0.02, 0)));
    path.push(at(-0.1), at(i === rings.length - 1 ? 0.12 : 0.1));
  });
  const [last, ls] = rings[rings.length - 1];
  path.push(last.center.clone().addScaledVector(last.normal, ls * 0.25).add(new V(0, -0.15, 0)));
  yield* hold(rope, tip, path, 60);
}

function thenRest(script) {            // a solve counts once things are still: let it come to rest at the end
  return function* (sim, pz) { yield* script(sim, pz); yield* wait(120); };
}

export const DEMOS = { knot_untying: thenRest(knot), rope_threading: thenRest(thread) };
