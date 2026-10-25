import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { ICE_ASSETS, buildIceBase } from "../src/ice-base.js";

const models = Object.fromEntries(ICE_ASSETS.map(name => {
  const buffer = readFileSync(new URL(`../public/assets/${name}.fbx`, import.meta.url));
  const model = new FBXLoader().parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), "");
  return [name, model];
}));
const ground = {
  bounds: new THREE.Box3(new THREE.Vector3(-200, -20, -200), new THREE.Vector3(200, 20, 200)),
  heightAt: (x, z) => 0.03 * x + 0.01 * z,
};

test("actual ice assets form an outpost at the requested location with a clear center", () => {
  const location = { x: 42, z: -35 };
  const base = buildIceBase({ models, ground, location });
  assert.equal(base.group.position.x, location.x);
  assert.equal(base.group.position.z, location.z);
  assert.deepEqual(new Set(base.group.children.map(piece => piece.name)), new Set(ICE_ASSETS));
  assert.equal(base.obstacles.length, base.group.children.length);
  const clearCenter = new THREE.Box3(new THREE.Vector3(40, -Infinity, -37), new THREE.Vector3(44, Infinity, -33));
  for (const bounds of base.obstacles) assert.equal(bounds.intersectsBox(clearCenter), false);
  for (const piece of base.group.children) {
    assert.ok(Math.abs(new THREE.Box3().setFromObject(piece).min.y - ground.heightAt(location.x + piece.position.x, location.z + piece.position.z)) < 1e-6);
  }
  assert.ok(base.group.children.some(piece => Math.abs(piece.rotation.x) > 0.01));
  assert.ok(models.iceberg.parent === null, "source models stay reusable");
});

test("rejects invalid, out-of-bounds, and occupied placement", () => {
  assert.throws(() => buildIceBase({ models, ground, location: { x: NaN, z: 0 } }), /valid position/);
  assert.throws(() => buildIceBase({ models, ground, location: { x: 199, z: 0 } }), /terrain edge/);
  const occupied = new THREE.Box3(new THREE.Vector3(-3, 0, -3), new THREE.Vector3(3, 5, 3));
  assert.throws(() => buildIceBase({ models, ground, location: { x: 0, z: 0 }, blockedBounds: [occupied] }), /open area/);
});
