import * as THREE from "three";

function sampleSite(ground, x, z, halfX, halfZ) {
  const bounds = ground?.bounds;
  if (!Number.isFinite(x) || !Number.isFinite(z)
    || (bounds && (x - halfX < bounds.min.x + 1 || x + halfX > bounds.max.x - 1
      || z - halfZ < bounds.min.z + 1 || z + halfZ > bounds.max.z - 1))) {
    throw new Error("Move farther from the terrain edge so the whole base fits.");
  }
  let low = Infinity, high = -Infinity;
  for (let ix = 0; ix <= 16; ix++) {
    for (let iz = 0; iz <= 16; iz++) {
      const y = ground?.heightAt(x - halfX + ix / 16 * halfX * 2, z - halfZ + iz / 16 * halfZ * 2) ?? 0;
      low = Math.min(low, y);
      high = Math.max(high, y);
    }
  }
  return { x, z, low, high, variation: high - low, distance: Math.hypot(x, z) };
}

export function findBaseSite(ground, halfX, halfZ) {
  let best;
  function consider(x, z) {
    const bounds = ground?.bounds;
    if (bounds && (x - halfX < bounds.min.x + 1 || x + halfX > bounds.max.x - 1
      || z - halfZ < bounds.min.z + 1 || z + halfZ > bounds.max.z - 1)) return;
    if (Math.abs(x) < halfX + 5 && Math.abs(z) < halfZ + 5) return;
    let low = Infinity, high = -Infinity;
    for (let ix = 0; ix <= 16; ix++) {
      for (let iz = 0; iz <= 16; iz++) {
        const y = ground?.heightAt(x - halfX + ix / 16 * halfX * 2, z - halfZ + iz / 16 * halfZ * 2) ?? 0;
        low = Math.min(low, y);
        high = Math.max(high, y);
      }
    }
    const variation = high - low;
    const distance = Math.hypot(x, z);
    if (!best || variation < best.variation - 1e-6
      || (Math.abs(variation - best.variation) < 1e-6 && distance < best.distance)) {
      best = { x, z, low, high, variation, distance };
    }
  }
  // Search the full playable landscape; prioritize level ground over proximity.
  for (const x of [16, 22, 28]) for (const z of [-16, -22, -28]) consider(x, z);
  for (let x = -72; x <= 72; x += 8) {
    for (let z = -72; z <= 72; z += 8) consider(x, z);
  }
  if (!best) throw new Error("No clear terrain patch is large enough for the space base");
  const coarse = { ...best };
  for (let x = coarse.x - 4; x <= coarse.x + 4; x++) {
    for (let z = coarse.z - 4; z <= coarse.z + 4; z++) consider(x, z);
  }
  return best;
}

export function placeSpaceBase(base, ground) {
  base.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), Math.PI);
  base.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(base);
  const size = box.getSize(new THREE.Vector3());
  base.scale.multiplyScalar(14 / Math.max(size.x, size.z));
  box.setFromObject(base);
  box.getSize(size);
  const center = box.getCenter(new THREE.Vector3());
  const halfX = size.x / 2 + 0.8, halfZ = size.z / 2 + 0.8;
  const best = findBaseSite(ground, halfX, halfZ);
  base.position.x += best.x - center.x;
  base.position.z += best.z - center.z;
  const floor = best.high + 0.05;
  base.position.y += floor - box.min.y;
  base.name = "SpaceBaseModel";

  // The supplied FBX references an absent multpaleta.png. Give each part a
  // readable material instead of displaying an unresolved palette texture.
  base.traverse(mesh => {
    if (!mesh.isMesh) return;
    const glass = /vidro|janela/i.test(mesh.name);
    const floorOrVent = /piso|vent/i.test(mesh.name);
    mesh.material = new THREE.MeshStandardMaterial({
      color: glass ? 0x173442 : floorOrVent ? 0x434c58 : 0xb8c0ca,
      roughness: glass ? 0.2 : 0.65,
      metalness: glass ? 0.35 : 0.45,
      emissive: glass ? 0x09202a : 0x000000,
      side: THREE.DoubleSide,
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
  const foundationBottom = best.low - 0.3;
  const foundation = new THREE.Mesh(
    new THREE.BoxGeometry(halfX * 2, floor - foundationBottom, halfZ * 2),
    new THREE.MeshStandardMaterial({ color: 0x424951, roughness: 0.95 }),
  );
  foundation.name = "SpaceBaseFoundation";
  foundation.position.set(best.x, (floor + foundationBottom) / 2, best.z);
  foundation.castShadow = true;
  foundation.receiveShadow = true;
  const group = new THREE.Group();
  group.name = "SpaceBase";
  group.userData.site = best;
  group.add(base, foundation);
  group.updateMatrixWorld(true);
  group.userData.buildingBounds = new THREE.Box3().setFromObject(base);
  group.userData.foundationBounds = new THREE.Box3().setFromObject(foundation);
  return group;
}

export function foundationHeightAt(base, x, z, terrainHeight) {
  const bounds = base?.userData.foundationBounds;
  if (bounds && x >= bounds.min.x && x <= bounds.max.x && z >= bounds.min.z && z <= bounds.max.z) {
    return Math.max(terrainHeight, bounds.max.y);
  }
  return terrainHeight;
}

export function getBaseSpawn(base, ground) {
  const foundation = base.userData.foundationBounds;
  const building = base.userData.buildingBounds;
  const x = (foundation.min.x + foundation.max.x) / 2;
  // Center the astronaut on the exposed front rim, clear of the solid building.
  const z = (building.max.z + 0.45 + foundation.max.z - 0.1) / 2;
  const y = foundationHeightAt(base, x, z, ground?.heightAt(x, z) ?? 0);
  return new THREE.Vector3(x, y, z);
}

export function getPlayerSpawn(base, ground, saved) {
  const fallback = { position: getBaseSpawn(base, ground), yaw: Math.PI, cameraYaw: 0, custom: false };
  if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.z)) return fallback;
  const bounds = ground?.bounds;
  const radius = 0.35;
  if (bounds && (saved.x < bounds.min.x + radius || saved.x > bounds.max.x - radius
    || saved.z < bounds.min.z + radius || saved.z > bounds.max.z - radius)) return fallback;
  const building = base.userData.buildingBounds;
  if (saved.x > building.min.x - radius && saved.x < building.max.x + radius
    && saved.z > building.min.z - radius && saved.z < building.max.z + radius) return fallback;
  const height = foundationHeightAt(base, saved.x, saved.z, ground?.heightAt(saved.x, saved.z) ?? 0);
  return {
    position: new THREE.Vector3(saved.x, height, saved.z),
    yaw: Number.isFinite(saved.yaw) ? saved.yaw : Math.PI,
    cameraYaw: Number.isFinite(saved.cameraYaw) ? saved.cameraYaw : 0,
    custom: true,
  };
}

// Anchor the new spawn to the player's exact X/Z, keeping the base beside it.
export function relocateSpaceBase(base, ground, spawnX, spawnZ) {
  const model = base.getObjectByName("SpaceBaseModel");
  const foundation = base.getObjectByName("SpaceBaseFoundation");
  const footprint = base.userData.foundationBounds;
  const building = base.userData.buildingBounds;
  const currentSpawn = getBaseSpawn(base, ground);
  const dx = spawnX - currentSpawn.x, dz = spawnZ - currentSpawn.z;
  const center = footprint.getCenter(new THREE.Vector3());
  const width = footprint.max.x - footprint.min.x, depth = footprint.max.z - footprint.min.z;
  // Validate and sample before changing any live geometry or collision bounds.
  const site = sampleSite(ground, center.x + dx, center.z + dz, width / 2, depth / 2);
  const floor = site.high + 0.05, bottom = site.low - 0.3;
  model.position.x += dx;
  model.position.z += dz;
  model.position.y += floor - building.min.y;
  const oldGeometry = foundation.geometry;
  foundation.geometry = new THREE.BoxGeometry(width, floor - bottom, depth);
  oldGeometry.dispose();
  foundation.position.set(site.x, (floor + bottom) / 2, site.z);
  base.updateMatrixWorld(true);
  // Keep the objects used by the live collision system, updating them in place.
  building.setFromObject(model);
  footprint.setFromObject(foundation);
  base.userData.site = site;
  if (base.userData.avoidanceSphere) {
    base.userData.avoidanceSphere.x = site.x;
    base.userData.avoidanceSphere.z = site.z;
  }
  return getBaseSpawn(base, ground);
}
