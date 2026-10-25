import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { placeSpaceBase, foundationHeightAt, getBaseSpawn, getPlayerSpawn, relocateSpaceBase } from "../src/space-base.js";
import { resolveBaseCollision } from "../src/base-collision.js";
import { advanceGroundedActor } from "../src/terrain-ground.js";

test("real space base loads upright, fits its foundation and clears the player spawn", () => {
  const originalLoad = THREE.TextureLoader.prototype.load;
  THREE.TextureLoader.prototype.load = () => new THREE.Texture();
  let model;
  try {
    const bytes = fs.readFileSync(new URL("../public/assets/Base.fbx", import.meta.url));
    model = new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
  } finally {
    THREE.TextureLoader.prototype.load = originalLoad;
  }
  const ground = { heightAt: (x, z) => 4 + x * 0.03 + Math.sin(z * 0.1) };
  const group = placeSpaceBase(model, ground);
  const foundation = group.getObjectByName("SpaceBaseFoundation");
  const baseBounds = new THREE.Box3().setFromObject(model);
  const padBounds = new THREE.Box3().setFromObject(foundation);
  const size = baseBounds.getSize(new THREE.Vector3());
  assert.ok(Math.abs(Math.max(size.x, size.z) - 14) < 1e-6);
  assert.ok(size.y > 5 && size.y < 7);
  assert.ok(Math.abs(baseBounds.min.y - padBounds.max.y) < 1e-6);
  assert.ok(Math.abs(padBounds.max.y - group.userData.site.high - 0.05) < 1e-6);
  assert.ok(baseBounds.min.x > padBounds.min.x && baseBounds.max.x < padBounds.max.x);
  assert.ok(baseBounds.min.z > padBounds.min.z && baseBounds.max.z < padBounds.max.z);
  assert.equal(padBounds.containsPoint(new THREE.Vector3(0, padBounds.min.y, 0)), false);
  for (let x = padBounds.min.x; x <= padBounds.max.x; x += 1) {
    for (let z = padBounds.min.z; z <= padBounds.max.z; z += 1) {
      assert.ok(padBounds.max.y >= ground.heightAt(x, z));
      assert.ok(padBounds.min.y <= ground.heightAt(x, z));
    }
  }
  let meshCount = 0;
  model.traverse(node => {
    if (!node.isMesh) return;
    meshCount++;
    assert.equal(node.material.map, null);
    assert.equal(node.castShadow, true);
  });
  assert.equal(meshCount, 10);

  // Enter the exposed rim from outside the foundation, then try crossing
  // the actual building. The rim is a floor; the building remains solid.
  const z = padBounds.getCenter(new THREE.Vector3()).z;
  const actor = new THREE.Group();
  actor.position.set(padBounds.min.x - 0.2, 0, z);
  const previous = actor.position.clone();
  actor.position.x = padBounds.min.x + 0.2;
  resolveBaseCollision(actor.position, previous, group.userData.buildingBounds);
  assert.ok(actor.position.x > padBounds.min.x);
  const state = { grounded: true, velocity: new THREE.Vector3() };
  const footOffset = 0.4;
  const height = foundationHeightAt(group, actor.position.x, z, ground.heightAt(actor.position.x, z));
  advanceGroundedActor(actor, state, footOffset, height, 1 / 60);
  assert.ok(Math.abs(actor.position.y - footOffset - padBounds.max.y) < 1e-6);
  const onPlatform = actor.position.clone();
  actor.position.x = baseBounds.max.x + 2;
  resolveBaseCollision(actor.position, onPlatform, group.userData.buildingBounds);
  assert.ok(actor.position.x < baseBounds.min.x - 0.35);
  // Jumping from the platform rises and lands back on its top.
  state.grounded = false;
  state.velocity.y = 11;
  advanceGroundedActor(actor, state, footOffset, height, 1 / 60);
  assert.ok(actor.position.y > padBounds.max.y + footOffset);
  for (let i = 0; i < 120 && !state.grounded; i++) advanceGroundedActor(actor, state, footOffset, height, 1 / 60);
  assert.equal(state.grounded, true);
  assert.ok(Math.abs(actor.position.y - footOffset - padBounds.max.y) < 1e-6);
  assert.equal(foundationHeightAt(group, padBounds.min.x - 1, z, 2), 2);
  assert.equal(foundationHeightAt(null, 0, 0, 3), 3);
  const spawn = getBaseSpawn(group, ground);
  assert.ok(spawn.x > padBounds.min.x && spawn.x < padBounds.max.x);
  assert.ok(spawn.z > baseBounds.max.z + 0.35 && spawn.z < padBounds.max.z);
  assert.ok(Math.abs(spawn.y - padBounds.max.y) < 1e-6);
  const resolvedSpawn = spawn.clone();
  resolveBaseCollision(resolvedSpawn, spawn, group.userData.buildingBounds);
  assert.deepEqual(resolvedSpawn.toArray(), spawn.toArray());
  const spawnedActor = new THREE.Group();
  spawnedActor.position.copy(spawn).add(new THREE.Vector3(0, footOffset, 0));
  advanceGroundedActor(spawnedActor, { grounded: true, velocity: new THREE.Vector3() }, footOffset, spawn.y, 1 / 60);
  assert.ok(Math.abs(spawnedActor.position.y - footOffset - padBounds.max.y) < 1e-6);

  const liveBuilding = group.userData.buildingBounds;
  const liveFoundation = group.userData.foundationBounds;
  group.userData.avoidanceSphere = { x: 0, z: 0, r: 11 };
  const relocated = relocateSpaceBase(group, ground, 30, 25);
  assert.ok(Math.abs(relocated.x - 30) < 1e-6 && Math.abs(relocated.z - 25) < 1e-6);
  assert.equal(group.userData.buildingBounds, liveBuilding);
  assert.equal(group.userData.foundationBounds, liveFoundation);
  assert.ok(Math.abs(relocated.y - liveFoundation.max.y) < 1e-6);
  assert.ok(Math.abs(liveBuilding.min.y - liveFoundation.max.y) < 1e-6);
  assert.equal(group.userData.avoidanceSphere.x, group.userData.site.x);
  assert.equal(group.userData.avoidanceSphere.z, group.userData.site.z);
  const collided = relocated.clone();
  collided.z = liveBuilding.min.z - 2;
  resolveBaseCollision(collided, relocated, liveBuilding);
  assert.ok(collided.z > liveBuilding.max.z + 0.35);
  const before = liveBuilding.clone();
  const geometryBefore = foundation.geometry;
  assert.throws(() => relocateSpaceBase(group, {
    ...ground, bounds: new THREE.Box3(new THREE.Vector3(-100, 0, -100), new THREE.Vector3(100, 50, 100)),
  }, 100, 100), /terrain edge/);
  assert.deepEqual(liveBuilding, before);
  assert.equal(foundation.geometry, geometryBefore);

  const savedPlayerSpawn = JSON.parse(JSON.stringify({ x: -25, z: 18, yaw: 0.7, cameraYaw: -0.4 }));
  const restored = getPlayerSpawn(group, ground, savedPlayerSpawn);
  assert.equal(restored.custom, true);
  assert.equal(restored.position.x, -25);
  assert.equal(restored.position.z, 18);
  assert.equal(restored.position.y, ground.heightAt(-25, 18));
  assert.equal(restored.yaw, 0.7);
  assert.equal(restored.cameraYaw, -0.4);
  assert.deepEqual(liveBuilding, before, "Setting a player spawn does not move the base");
  const platformSpawn = getPlayerSpawn(group, ground, { x: relocated.x, z: relocated.z });
  assert.equal(platformSpawn.custom, true);
  assert.ok(Math.abs(platformSpawn.position.y - liveFoundation.max.y) < 1e-6);
  const buildingCenter = liveBuilding.getCenter(new THREE.Vector3());
  assert.equal(getPlayerSpawn(group, ground, { x: buildingCenter.x, z: buildingCenter.z }).custom, false);
  assert.equal(getPlayerSpawn(group, ground, { x: "invalid", z: 0 }).custom, false);
  assert.equal(getPlayerSpawn(group, { ...ground,
    bounds: new THREE.Box3(new THREE.Vector3(-100, 0, -100), new THREE.Vector3(100, 50, 100)),
  }, { x: 101, z: 0 }).custom, false);
});
