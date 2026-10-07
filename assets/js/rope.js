// A rope for the browser: a chain of particles moved by position-based dynamics. Stretch and bend constraints keep its
// length and some stiffness; collisions keep it out of the fixed pieces (three-mesh-bvh closest points, plus a swept
// test so a particle cannot tunnel through a thin wall within one step), off the floor (with friction) and out of
// itself, so a knot stays a knot. One particle at a time can be held and dragged. Everything is in the puzzle's own
// frame (metres, y up).
import * as THREE from 'three';

const GRAVITY = -9.81;
const _ray = new THREE.Ray(), _v = new THREE.Vector3(), _w = new THREE.Vector3(), _hit = {};
const _tri = new THREE.Triangle(), _n = new THREE.Vector3();

export class Rope {
  /**
   * points: initial centreline (array of [x, y, z]), resampled so neighbours sit `spacing` apart.
   * radius: rope radius. colliders: [{ geometry (with boundsTree), matrix (body pose in the puzzle frame) }].
   * floor: height of the table, or null. pinned: indices held in place (an anchored end).
   */
  constructor({ points, radius, colliders = [], floor = 0, spacing = null, bend = 0.08, damping = 0.995, friction = 0.6, pinned = [] }) {
    this.radius = radius;
    this.spacing = spacing ?? radius * 1.0;
    const pts = resample(points.map((p) => new THREE.Vector3(...p)), this.spacing);
    this.n = pts.length;
    this.x = new Float32Array(this.n * 3);
    this.p = new Float32Array(this.n * 3);          // previous positions (verlet)
    this.s = new Float32Array(this.n * 3);          // positions at the start of the current sub-step (for the swept test)
    this.w = new Float32Array(this.n).fill(1);      // inverse masses; 0 = held
    pts.forEach((v, i) => { this.x.set([v.x, v.y, v.z], 3 * i); });
    this.p.set(this.x);
    this.rest = new Float32Array(this.n);
    for (let i = 0; i < this.n - 1; i++) this.rest[i] = dist(this.x, i, i + 1);
    this.bend = bend; this.damping = damping; this.friction = friction; this.floor = floor;
    this.colliders = colliders.map((c) => ({ ...c, inverse: c.matrix.clone().invert(), normalMatrix: new THREE.Matrix3().getNormalMatrix(c.matrix) }));
    this.pinned = new Set(pinned);
    for (const i of this.pinned) this.w[i] = 0;
    this.held = -1; this.target = new THREE.Vector3(); this.maxSpeed = 1.2;   // m/s at which a held point follows the cursor
    this.initial = Float32Array.from(this.x);
  }

  reset() {
    this.x.set(this.initial); this.p.set(this.initial); this.release();
  }

  /** Let it come to rest untouched for a moment, and make that the starting state (what Reset returns to). */
  settle(frames = 60) {
    for (let f = 0; f < frames; f++) this.step(1 / 60);
    this.p.set(this.x);
    this.initial = Float32Array.from(this.x);
    return this;
  }

  grab(i) { this.held = i; this.w[i] = 0; this.get(i, this.target); }
  drag(target) { this.target.copy(target); }
  release() {
    if (this.held >= 0 && !this.pinned.has(this.held)) this.w[this.held] = 1;
    this.held = -1;
  }

  get(i, out) { return out.set(this.x[3 * i], this.x[3 * i + 1], this.x[3 * i + 2]); }

  /** Index of the particle closest to a ray (puzzle frame), if it passes within `slack` radii of it. */
  pick(ray, slack = 3) {
    let best = -1, bestD = (this.radius * slack) ** 2, bestT = Infinity;
    for (let i = 0; i < this.n; i++) {
      this.get(i, _v);
      const t = _w.subVectors(_v, ray.origin).dot(ray.direction);
      if (t < 0) continue;
      const d = ray.distanceSqToPoint(_v);
      if (d < bestD || (d < (this.radius * slack) ** 2 && t < bestT - 4 * this.radius)) { best = i; bestD = d; bestT = t; }
    }
    return best;
  }

  step(dt, substeps = 12, iterations = 3) {
    const h = dt / substeps, x = this.x, p = this.p, s = this.s, w = this.w, n = this.n;
    this.h = h;
    for (let k = 0; k < substeps; k++) {
      s.set(x);
      // integrate: verlet with damping and gravity
      for (let i = 0; i < n; i++) {
        if (!w[i]) continue;
        const j = 3 * i;
        for (let a = 0; a < 3; a++) {
          const v = (x[j + a] - p[j + a]) * this.damping;
          p[j + a] = x[j + a];
          x[j + a] += v + (a === 1 ? GRAVITY * h * h : 0);
        }
      }
      // the held point walks toward the cursor, no faster than maxSpeed
      if (this.held >= 0) {
        const j = 3 * this.held;
        _v.set(x[j], x[j + 1], x[j + 2]);
        _w.subVectors(this.target, _v);
        const len = _w.length(), max = this.maxSpeed * h;
        if (len > max) _w.multiplyScalar(max / len);
        p[j] = x[j]; p[j + 1] = x[j + 1]; p[j + 2] = x[j + 2];
        x[j] += _w.x; x[j + 1] += _w.y; x[j + 2] += _w.z;
      }
      for (let it = 0; it < iterations; it++) {
        this.solveStretch();
        if (this.bend > 0) this.solveBend();
        this.solveSelf();
      }
      this.solveColliders();
      this.solveFloor();
    }
  }

  /** Crossings of the rope with itself seen from above (non-adjacent segments whose floor projections intersect). */
  crossings() {
    const x = this.x, n = this.n;
    let c = 0;
    for (let i = 0; i < n - 1; i++) {
      const ax = x[3 * i], az = x[3 * i + 2], bx = x[3 * i + 3], bz = x[3 * i + 5];
      for (let j = i + 2; j < n - 1; j++) {
        const cx = x[3 * j], cz = x[3 * j + 2], dx = x[3 * j + 3], dz = x[3 * j + 5];
        const d1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax), d2 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
        if (d1 * d2 >= 0) continue;
        const d3 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx), d4 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
        if (d3 * d4 < 0) c++;
      }
    }
    return c;
  }

  /**
   * The rings the rope passes through, in order along the rope from its first particle: [{ ring, sign }], with a pass
   * straight back out through the same ring cancelled. rings: [{ name, center, normal, radius }] (puzzle frame).
   */
  passages(rings) {
    const out = [], x = this.x, a = new THREE.Vector3(), b = new THREE.Vector3(), q = new THREE.Vector3();
    for (let i = 0; i < this.n - 1; i++) {
      this.get(i, a); this.get(i + 1, b);
      for (const r of rings) {
        const da = _v.subVectors(a, r.center).dot(r.normal), db = _w.subVectors(b, r.center).dot(r.normal);
        if ((da < 0) === (db < 0)) continue;
        q.lerpVectors(a, b, da / (da - db));
        if (q.distanceTo(r.center) > r.radius) continue;
        const sign = da < 0 ? 1 : -1, last = out[out.length - 1];
        if (last && last.ring === r.name && last.sign === -sign) out.pop(); else out.push({ ring: r.name, sign });
      }
    }
    return out;
  }

  /** Deepest intrusion of the rope into any fixed piece, in metres (0 = none); for the self-test. */
  penetration() {
    let worst = 0;
    const P = new THREE.Vector3();
    for (const c of this.colliders) {
      for (let i = 0; i < this.n; i++) {
        this.get(i, P).applyMatrix4(c.inverse);
        const near = c.geometry.boundsTree.closestPointToPoint(P, _hit, 0, this.radius);
        if (near) worst = Math.max(worst, this.radius - near.distance);
      }
    }
    return +worst.toFixed(5);
  }

  solveStretch() {
    const x = this.x, w = this.w;
    for (let i = 0; i < this.n - 1; i++) {
      const a = 3 * i, b = a + 3, wa = w[i], wb = w[i + 1], ws = wa + wb;
      if (!ws) continue;
      const dx = x[b] - x[a], dy = x[b + 1] - x[a + 1], dz = x[b + 2] - x[a + 2];
      const d = Math.hypot(dx, dy, dz) || 1e-9, c = (d - this.rest[i]) / (d * ws);
      x[a] += wa * c * dx; x[a + 1] += wa * c * dy; x[a + 2] += wa * c * dz;
      x[b] -= wb * c * dx; x[b + 1] -= wb * c * dy; x[b + 2] -= wb * c * dz;
    }
  }

  solveBend() {                       // soft distance constraints between every other particle
    const x = this.x, w = this.w, k = this.bend;
    for (let i = 0; i < this.n - 2; i++) {
      const a = 3 * i, b = a + 6, wa = w[i], wb = w[i + 2], ws = wa + wb;
      if (!ws) continue;
      const rest = this.rest[i] + this.rest[i + 1];
      const dx = x[b] - x[a], dy = x[b + 1] - x[a + 1], dz = x[b + 2] - x[a + 2];
      const d = Math.hypot(dx, dy, dz) || 1e-9;
      if (d >= rest) continue;
      const c = k * (d - rest) / (d * ws);
      x[a] += wa * c * dx; x[a + 1] += wa * c * dy; x[a + 2] += wa * c * dz;
      x[b] -= wb * c * dx; x[b + 1] -= wb * c * dy; x[b + 2] -= wb * c * dz;
    }
  }

  solveSelf() {                       // particles further apart along the rope than a diameter keep a diameter apart
    const x = this.x, w = this.w, n = this.n, d0 = 2 * this.radius, d02 = d0 * d0;
    const gap = Math.max(2, Math.ceil(d0 / this.spacing) + 1);
    for (let i = 0; i < n; i++) {
      const a = 3 * i;
      for (let j = i + gap; j < n; j++) {
        const b = 3 * j;
        const dx = x[b] - x[a], dy = x[b + 1] - x[a + 1], dz = x[b + 2] - x[a + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= d02) continue;
        const ws = w[i] + w[j];
        if (!ws) continue;
        const d = Math.sqrt(d2) || 1e-9, c = (d - d0) / (d * ws);
        x[a] += w[i] * c * dx; x[a + 1] += w[i] * c * dy; x[a + 2] += w[i] * c * dz;
        x[b] -= w[j] * c * dx; x[b + 1] -= w[j] * c * dy; x[b + 2] -= w[j] * c * dz;
      }
    }
  }

  solveColliders() {
    if (!this.colliders.length) return;
    const x = this.x, s = this.s, r = this.radius;
    const P = new THREE.Vector3(), S = new THREE.Vector3();
    for (const c of this.colliders) {
      const tree = c.geometry.boundsTree, index = c.geometry.index, pos = c.geometry.attributes.position;
      for (let i = 0; i < this.n; i++) {
        const j = 3 * i;
        P.set(x[j], x[j + 1], x[j + 2]).applyMatrix4(c.inverse);
        S.set(s[j], s[j + 1], s[j + 2]).applyMatrix4(c.inverse);
        let moved = false;
        // swept: if the step from S to P crosses the surface, stop a radius short of the crossing
        _v.subVectors(P, S);
        const len = _v.length();
        if (len > 1e-7) {
          _ray.origin.copy(S); _ray.direction.copy(_v).divideScalar(len);
          const hit = tree.raycastFirst(_ray, THREE.DoubleSide);
          if (hit && hit.distance < len) { P.copy(S).addScaledVector(_ray.direction, Math.max(0, hit.distance - r)); moved = true; }
        }
        // resting: push out to a radius from the closest point, on the outward side of its face
        const near = tree.closestPointToPoint(P, _hit, 0, r);
        if (near && near.distance < r) {           // (the BVH may return a point beyond the threshold)
          faceNormal(index, pos, near.faceIndex, _n);
          _w.subVectors(P, near.point);
          const d = _w.length();
          const out = d > 1e-7 ? _w.dot(_n) >= 0 : true;
          if (out && d > 1e-7) P.copy(near.point).addScaledVector(_w.divideScalar(d), r);
          else P.copy(near.point).addScaledVector(_n, r);
          moved = true;
        }
        if (moved) {
          P.applyMatrix4(c.matrix);
          x[j] = P.x; x[j + 1] = P.y; x[j + 2] = P.z;
        }
      }
    }
  }

  solveFloor() {
    if (this.floor == null) return;
    const x = this.x, p = this.p, y0 = this.floor + this.radius, f = this.friction;
    for (let i = 0; i < this.n; i++) {
      const j = 3 * i;
      if (x[j + 1] < y0) {
        x[j + 1] = y0;
        // friction: lose part of this step's sliding
        x[j] -= (x[j] - p[j]) * f; x[j + 2] -= (x[j + 2] - p[j + 2]) * f;
      }
    }
  }
}

function faceNormal(index, pos, face, out) {
  const a = index ? index.getX(3 * face) : 3 * face, b = index ? index.getX(3 * face + 1) : 3 * face + 1, c = index ? index.getX(3 * face + 2) : 3 * face + 2;
  _tri.a.fromBufferAttribute(pos, a); _tri.b.fromBufferAttribute(pos, b); _tri.c.fromBufferAttribute(pos, c);
  return _tri.getNormal(out);
}

function dist(x, i, j) {
  return Math.hypot(x[3 * j] - x[3 * i], x[3 * j + 1] - x[3 * i + 1], x[3 * j + 2] - x[3 * i + 2]);
}

/** Resample a polyline to points `step` apart (the last point kept). */
export function resample(points, step) {
  const out = [points[0].clone()];
  let carry = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1], seg = a.distanceTo(b);
    let t = step - carry;
    while (t <= seg) { out.push(a.clone().lerp(b, t / seg)); t += step; }
    carry = seg - (t - step);
  }
  if (out[out.length - 1].distanceTo(points[points.length - 1]) > 0.25 * step) out.push(points[points.length - 1].clone());
  return out;
}

/** A tube that follows the rope, rebuilt in place every frame (parallel-transported frames, rounded ends). */
export class RopeTube {
  /** colors: optional { body, tip, length }: the last `length` metres of the rope (its leading end) in the tip colour. */
  constructor(rope, material, sides = 10, colors = null) {
    this.rope = rope; this.sides = sides;
    const rings = rope.n, verts = rings * sides + 2;
    this.geometry = new THREE.BufferGeometry();
    this.positions = new Float32Array(verts * 3);
    this.normals = new Float32Array(verts * 3);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(this.normals, 3).setUsage(THREE.DynamicDrawUsage));
    if (colors) {
      const c = new Float32Array(verts * 3), body = new THREE.Color(colors.body), tip = new THREE.Color(colors.tip);
      const from = rings - Math.max(1, Math.round(colors.length / rope.spacing));
      for (let v = 0; v < verts; v++) {
        const ring = v < rings * sides ? Math.floor(v / sides) : (v === rings * sides ? 0 : rings - 1);
        (ring >= from ? tip : body).toArray(c, 3 * v);
      }
      this.geometry.setAttribute('color', new THREE.BufferAttribute(c, 3));
    }
    const idx = [];
    for (let i = 0; i < rings - 1; i++) for (let k = 0; k < sides; k++) {
      const a = i * sides + k, b = i * sides + (k + 1) % sides, c = a + sides, d = b + sides;
      idx.push(a, c, b, b, c, d);
    }
    const capA = rings * sides, capB = capA + 1;
    for (let k = 0; k < sides; k++) {
      idx.push(capA, k, (k + 1) % sides);
      const o = (rings - 1) * sides;
      idx.push(capB, o + (k + 1) % sides, o + k);
    }
    this.geometry.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.update();
  }

  update() {
    const r = this.rope, n = r.n, S = this.sides, P = this.positions, N = this.normals, rad = r.radius;
    const t = new THREE.Vector3(), u = new THREE.Vector3(), v = new THREE.Vector3(), prevT = new THREE.Vector3(), c = new THREE.Vector3();
    const a = new THREE.Vector3(), b = new THREE.Vector3(), q = new THREE.Quaternion();
    for (let i = 0; i < n; i++) {
      r.get(Math.max(0, i - 1), a); r.get(Math.min(n - 1, i + 1), b);
      t.subVectors(b, a).normalize();
      if (i === 0) {
        u.set(0, 1, 0); if (Math.abs(t.y) > 0.9) u.set(1, 0, 0);
        u.sub(_v.copy(t).multiplyScalar(u.dot(t))).normalize();
      } else {
        q.setFromUnitVectors(prevT, t); u.applyQuaternion(q);
        u.sub(_v.copy(t).multiplyScalar(u.dot(t))).normalize();
      }
      prevT.copy(t);
      v.crossVectors(t, u);
      r.get(i, c);
      for (let k = 0; k < S; k++) {
        const ang = (k / S) * Math.PI * 2, cs = Math.cos(ang), sn = Math.sin(ang);
        const nx = u.x * cs + v.x * sn, ny = u.y * cs + v.y * sn, nz = u.z * cs + v.z * sn, o = 3 * (i * S + k);
        N[o] = nx; N[o + 1] = ny; N[o + 2] = nz;
        P[o] = c.x + rad * nx; P[o + 1] = c.y + rad * ny; P[o + 2] = c.z + rad * nz;
      }
    }
    // end caps: a point half a radius beyond each end
    r.get(0, a); r.get(1, b); t.subVectors(a, b).normalize();
    let o = 3 * n * S; P[o] = a.x + t.x * rad * 0.6; P[o + 1] = a.y + t.y * rad * 0.6; P[o + 2] = a.z + t.z * rad * 0.6; N[o] = t.x; N[o + 1] = t.y; N[o + 2] = t.z;
    r.get(n - 1, a); r.get(n - 2, b); t.subVectors(a, b).normalize();
    o += 3; P[o] = a.x + t.x * rad * 0.6; P[o + 1] = a.y + t.y * rad * 0.6; P[o + 2] = a.z + t.z * rad * 0.6; N[o] = t.x; N[o + 1] = t.y; N[o + 2] = t.z;
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.normal.needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }
}
