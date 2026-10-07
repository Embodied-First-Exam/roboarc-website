// Shared by the play section: poseAt() reads a solution path (samples of a piece's pose, lerp / slerp between them) and
// clawMaterials() holds the pieces' materials.
import * as THREE from 'three';

const _a = new THREE.Vector3(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
// The moving piece's pose (in the fixed pieces' frame) at a continuous sample index f in [0, count - 1].
export function poseAt(path, f, outPos, outQuat) {
  const n = path.count;
  f = Math.min(Math.max(f, 0), n - 1);
  const i = Math.floor(f), j = Math.min(i + 1, n - 1), u = f - i;
  outPos.fromArray(path.pos, 3 * i).lerp(_a.fromArray(path.pos, 3 * j), u);
  _q1.fromArray(path.quat, 4 * i);
  _q2.fromArray(path.quat, 4 * j);
  outQuat.slerpQuaternions(_q1, _q2, u);
}

export function clawMaterials() {
  const steel = new THREE.MeshPhysicalMaterial({ color: 0x8e98a3, metalness: 1, roughness: 0.32, clearcoat: 0.15, clearcoatRoughness: 0.4 });
  const brass = new THREE.MeshPhysicalMaterial({ color: 0xc99a42, metalness: 1, roughness: 0.26, clearcoat: 0.3, clearcoatRoughness: 0.35 });
  const iron = new THREE.MeshPhysicalMaterial({ color: 0x4d5864, metalness: 1, roughness: 0.42, clearcoat: 0.1, clearcoatRoughness: 0.5 });
  // the piece the visitor moves wears the page's accent, the terracotta of the opening's claw
  const move = new THREE.MeshPhysicalMaterial({ color: 0xd2683f, metalness: 0.15, roughness: 0.38, clearcoat: 0.5, clearcoatRoughness: 0.25 });
  return { steel, brass, iron, move };
}
