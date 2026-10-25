import * as THREE from "three";

export const ICE_ASSETS = ["crystal_cluster", "crystal_large", "glacier_chunk", "ice_block", "iceberg", "stalagmite_large"];

export function findIceBaseLocation(ground, blockedBounds, preferred) {
  const candidates = [preferred];
  for (let x = -64; x <= 64; x += 16) for (let z = -64; z <= 64; z += 16) candidates.push({ x, z });
  const bounds = ground?.bounds;
  return candidates.filter(location => {
    const footprint = new THREE.Box3(new THREE.Vector3(location.x - 30, -Infinity, location.z - 30),
      new THREE.Vector3(location.x + 30, Infinity, location.z + 30));
    return (!bounds || (footprint.min.x >= bounds.min.x && footprint.max.x <= bounds.max.x
      && footprint.min.z >= bounds.min.z && footprint.max.z <= bounds.max.z))
      && !blockedBounds.some(blocked => blocked && footprint.intersectsBox(blocked));
  }).sort((a, b) => Math.hypot(a.x - preferred.x, a.z - preferred.z) - Math.hypot(b.x - preferred.x, b.z - preferred.z))[0];
}

// Uneven deposits stretch along a hillside rather than enclosing the center.
const layout = [
  ["iceberg", -17, 7, 6, 0.65], ["iceberg", 11, 10, 5.5, -0.9],
  ["glacier_chunk", -11, 5, 4.8, 0.35], ["glacier_chunk", -3, 11, 4.4, -0.55],
  ["glacier_chunk", 4, 7, 4.8, 0.9], ["glacier_chunk", 18, 4, 4.7, 1.2],
  ["glacier_chunk", -18, -2, 4.6, -1.1],
  ["ice_block", -14, 0, 2.4, 0.7], ["ice_block", 8, 3, 2.8, -0.4],
  ["ice_block", -7, 3, 2.5, -0.8], ["ice_block", 15, -3, 2.2, 1.1],
  ["ice_block", -9, -6, 2.8, 0.3], ["ice_block", 20, 10, 2.3, -1],
  ["stalagmite_large", -20, 12, 3.2, 0.45], ["stalagmite_large", 6, 14, 3.6, -0.65],
  ["crystal_large", -6, 9, 3.7, 0.85], ["crystal_large", 16, 13, 3.6, -0.55],
  ["crystal_cluster", -13, 11, 2.1, -0.35], ["crystal_cluster", 12, -6, 1.8, 0.9],
  ["crystal_cluster", -4, -4, 1.7, 0.55], ["crystal_cluster", 2, 4, 2, -1.1],
];

export function buildIceBase({ models, ground, location, blockedBounds = [] }) {
  if (!Number.isFinite(location?.x) || !Number.isFinite(location?.z)) {
    throw new Error("Choose a valid position for the ice base.");
  }
  const { x, z } = location;
  const footprint = new THREE.Box3(new THREE.Vector3(x - 30, -Infinity, z - 30),
    new THREE.Vector3(x + 30, Infinity, z + 30));
  if (ground?.bounds && (footprint.min.x < ground.bounds.min.x || footprint.max.x > ground.bounds.max.x ||
      footprint.min.z < ground.bounds.min.z || footprint.max.z > ground.bounds.max.z)) {
    throw new Error("Move at least 30 meters away from the terrain edge to place the ice base.");
  }
  if (blockedBounds.some(bounds => bounds && footprint.intersectsBox(bounds))) {
    throw new Error("Choose an open area away from the base and garden colony for the ice outpost.");
  }
  for (const name of ICE_ASSETS) {
    if (!models[name]) throw new Error(`Ice asset is missing: ${name}`);
  }
  const group = new THREE.Group();
  group.name = "Ice Base";
  group.position.set(x, 0, z);
  const obstacles = [];
  const height = (px, pz) => ground?.heightAt(px, pz) ?? 0;
  const slopeX = height(x + 4, z) - height(x - 4, z);
  const slopeZ = height(x, z + 4) - height(x, z - 4);
  const hillYaw = Math.hypot(slopeX, slopeZ) > 0.01 ? Math.atan2(slopeX, slopeZ) : 0;
  for (const [name, lx, lz, size, yaw] of layout) {
    const dx = 1.18 * (lx * Math.cos(hillYaw) + lz * Math.sin(hillYaw));
    const dz = 1.18 * (-lx * Math.sin(hillYaw) + lz * Math.cos(hillYaw));
    const model = models[name].clone(true);
    const raw = new THREE.Box3().setFromObject(model);
    const dimensions = raw.getSize(new THREE.Vector3());
    model.scale.multiplyScalar(size / Math.max(dimensions.x, dimensions.y, dimensions.z));
    const bounds = new THREE.Box3().setFromObject(model);
    const center = bounds.getCenter(new THREE.Vector3());
    model.position.add(new THREE.Vector3(-center.x, -bounds.min.y, -center.z));
    const piece = new THREE.Group();
    piece.name = name;
    piece.add(model);
    piece.rotation.y = yaw + hillYaw;
    const tilt = /crystal/.test(name) ? 0.12 : 0.055;
    piece.rotation.x = Math.sin(dx * 1.7 + dz) * tilt;
    piece.rotation.z = Math.cos(dz * 1.3 - dx) * tilt;
    piece.position.set(dx, ground?.heightAt(x + dx, z + dz) ?? 0, dz);
    const tilted = new THREE.Box3().setFromObject(piece);
    piece.position.y += (ground?.heightAt(x + dx, z + dz) ?? 0) - tilted.min.y;
    model.traverse(mesh => {
      if (!mesh.isMesh) return;
      mesh.castShadow = mesh.receiveShadow = true;
    });
    group.add(piece);
  }
  group.updateMatrixWorld(true);
  for (const piece of group.children) obstacles.push(new THREE.Box3().setFromObject(piece));
  return { group, obstacles, bounds: new THREE.Box3().setFromObject(group), location: { x, z } };
}
