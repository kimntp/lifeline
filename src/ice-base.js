import * as THREE from "three";

export const ICE_ASSETS = ["crystal_cluster", "crystal_large", "glacier_chunk", "ice_block", "iceberg", "stalagmite_large"];

// The center and south entrance stay clear for the player.
const layout = [
  ["iceberg", -8, -8, 6, 0.2], ["iceberg", 8, -8, 5.5, -0.4],
  ["glacier_chunk", -5, -9, 5, 0.1], ["glacier_chunk", 0, -10, 5, 0],
  ["glacier_chunk", 5, -9, 5, -0.1],
  ["glacier_chunk", -10, -3, 5, 1.5], ["glacier_chunk", 10, -3, 5, -1.5],
  ["ice_block", -10, 2, 2.6, 0.1], ["ice_block", 10, 2, 2.6, -0.1],
  ["ice_block", -9, 5, 2.6, 0.5], ["ice_block", 9, 5, 2.6, -0.5],
  ["ice_block", -6, 8, 2.6, 0], ["ice_block", 6, 8, 2.6, 0],
  ["stalagmite_large", -4, 9, 3.4, 0.3], ["stalagmite_large", 4, 9, 3.4, -0.3],
  ["crystal_large", -7, -5, 3.8, 0.4], ["crystal_large", 7, -5, 3.8, -0.4],
  ["crystal_cluster", -8, 0, 2, 0.2], ["crystal_cluster", 8, 0, 2, -0.2],
  ["crystal_cluster", -6, 5, 1.8, 0.8], ["crystal_cluster", 6, 5, 1.8, -0.8],
];

export function buildIceBase({ models, ground, location, blockedBounds = [] }) {
  if (!Number.isFinite(location?.x) || !Number.isFinite(location?.z)) {
    throw new Error("Choose a valid position for the ice base.");
  }
  const { x, z } = location;
  const footprint = new THREE.Box3(new THREE.Vector3(x - 14, -Infinity, z - 14),
    new THREE.Vector3(x + 14, Infinity, z + 14));
  if (ground?.bounds && (footprint.min.x < ground.bounds.min.x || footprint.max.x > ground.bounds.max.x ||
      footprint.min.z < ground.bounds.min.z || footprint.max.z > ground.bounds.max.z)) {
    throw new Error("Move at least 14 meters away from the terrain edge to place the ice base.");
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
  for (const [name, dx, dz, size, yaw] of layout) {
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
    piece.rotation.y = yaw;
    piece.position.set(dx, ground?.heightAt(x + dx, z + dz) ?? 0, dz);
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
