// The opening's robot: two ALOHA arms holding the interlocked claws, posed frame by frame from the recorded
// disentanglement of the robot-puzzle demo (scripts/prepare_robot.py). Forward kinematics as in that demo's viewer:
// each body's pose is its parent's times its fixed offset times its joints (hinges about an axis through a point,
// slides along an axis); each held claw piece is its gripper body times the inverse of the recorded grasp.
// MuJoCo is z-up; the returned group is turned so that the page's y is up.
import * as THREE from 'three';

const BASE = new URL('../data/robot/', import.meta.url);

export const ROBOT_COLORS = { arm: 0x2c3036, finger: 0x3a3f46, camera: 0x24272b, claw0: 0xd2683f, claw1: 0x2f93a6 };

let cache = null;
export function loadRobot(onProgress) {
  cache ??= (async () => {
    const [meta, buf] = await Promise.all([
      fetch(new URL('robot.json', BASE)).then((r) => r.json()),
      fetch(new URL('robot.bin', BASE)).then(async (r) => { const b = await r.arrayBuffer(); onProgress?.(1); return b; }),
    ]);
    const geometries = meta.meshes.map((m) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf, m.offset, m.vertices * 3), 3));
      g.setIndex(new THREE.BufferAttribute(new Uint32Array(buf, m.offset + m.vertices * 12, m.triangles * 3), 1));
      g.computeVertexNormals();
      return g;
    });
    return { meta, geometries };
  })();
  return cache;
}

const fixed = (p, q) => new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion(q[1], q[2], q[3], q[0]), new THREE.Vector3(1, 1, 1));

/** Build the robot; returns { group, pieces, frames, pose(f) } where f runs from 0 to frames - 1 (fractions blend). */
export async function createRobot() {
  const { meta, geometries } = await loadRobot();
  const group = new THREE.Group();
  group.rotation.x = -Math.PI / 2;                       // z-up to y-up
  const mats = {
    arm: new THREE.MeshPhysicalMaterial({ color: ROBOT_COLORS.arm, roughness: 0.48, metalness: 0.25, clearcoat: 0.25, clearcoatRoughness: 0.5 }),
    finger: new THREE.MeshPhysicalMaterial({ color: ROBOT_COLORS.finger, roughness: 0.6, metalness: 0.1 }),
    camera: new THREE.MeshPhysicalMaterial({ color: ROBOT_COLORS.camera, roughness: 0.35, metalness: 0.5 }),
  };
  const bodies = meta.bodies.map((b) => ({ ...b, local: fixed(b.position, b.quaternion_wxyz), world: new THREE.Matrix4(),
    joints: b.joints.map((j) => ({ ...j, axisV: new THREE.Vector3(...j.axis) })) }));
  const geoms = meta.geoms.map((g) => {
    const mesh = new THREE.Mesh(geometries[g.mesh], mats[g.part]);
    mesh.matrixAutoUpdate = false; mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
    return { ...g, mesh, local: fixed(g.position, g.quaternion_wxyz) };
  });
  const pieces = meta.pieces.map((p) => {
    const mesh = new THREE.Mesh(geometries[p.mesh], new THREE.MeshPhysicalMaterial({ color: p.id ? ROBOT_COLORS.claw1 : ROBOT_COLORS.claw0,
      roughness: 0.38, metalness: 0.15, clearcoat: 0.5, clearcoatRoughness: 0.25 }));
    mesh.matrixAutoUpdate = false; mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
    return { ...p, mesh, inverseGrasp: new THREE.Matrix4().fromArray(p.inverse_grasp_column_major) };
  });

  const Q = meta.qpos.values, W = meta.qpos.width, frames = meta.qpos.count, q = new Float32Array(W);
  const T = new THREE.Matrix4(), R = new THREE.Matrix4();
  function pose(f) {
    f = Math.min(Math.max(f, 0), frames - 1);
    const i = Math.floor(f), j = Math.min(i + 1, frames - 1), u = f - i;
    for (let k = 0; k < W; k++) q[k] = Q[i * W + k] + (Q[j * W + k] - Q[i * W + k]) * u;
    for (const b of bodies) {
      if (b.id === 0) { b.world.identity(); continue; }
      b.world.copy(b.local);
      for (const jt of b.joints) {
        const v = q[jt.qpos] - jt.reference;
        if (jt.type === 2) b.world.multiply(T.makeTranslation(jt.axis[0] * v, jt.axis[1] * v, jt.axis[2] * v));
        else {
          b.world.multiply(T.makeTranslation(...jt.position));
          b.world.multiply(R.makeRotationAxis(jt.axisV, v));
          b.world.multiply(T.makeTranslation(-jt.position[0], -jt.position[1], -jt.position[2]));
        }
      }
      b.world.premultiply(bodies[b.parent].world);
    }
    for (const g of geoms) g.mesh.matrix.multiplyMatrices(bodies[g.body].world, g.local);
    for (const p of pieces) p.mesh.matrix.multiplyMatrices(bodies[p.gripper_body].world, p.inverseGrasp);
    group.updateMatrixWorld(true);
  }
  pose(0);
  return { group, pieces, frames, pose, seconds: meta.unlock_seconds };
}
