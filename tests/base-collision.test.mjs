import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { resolveBaseCollision, resolvePlatformCollision } from "../src/base-collision.js";
import { advanceGroundedActor } from "../src/terrain-ground.js";

const bounds = new THREE.Box3(new THREE.Vector3(-5, 0, -4), new THREE.Vector3(5, 6, 4));

test("solid base blocks walking, sprinting and full-frame crossings on every side", () => {
  for (const [from, to, axis, side] of [
    [[-10, 0], [10, 0], "x", -1], [[10, 0], [-10, 0], "x", 1],
    [[0, -10], [0, 10], "z", -1], [[0, 10], [0, -10], "z", 1],
  ]) {
    for (const height of [0, 3, 10]) {
      const previous = new THREE.Vector3(from[0], height, from[1]);
      const position = new THREE.Vector3(to[0], height, to[1]);
      resolveBaseCollision(position, previous, bounds);
      assert.ok(side < 0 ? position[axis] < bounds.min[axis] - 0.35 : position[axis] > bounds.max[axis] + 0.35);
      assert.equal(position.y, height);
    }
  }
});

test("player slides along a wall and can move away from it", () => {
  const previous = new THREE.Vector3(-6, 1, -2);
  const position = new THREE.Vector3(-4, 1, 2);
  resolveBaseCollision(position, previous, bounds);
  assert.ok(position.x < -5.35);
  assert.equal(position.z, 2);
  const away = position.clone().add(new THREE.Vector3(-2, 0, 0));
  resolveBaseCollision(away, position, bounds);
  assert.ok(away.x < -7.35);
});

test("existing penetration is corrected and distant movement is untouched", () => {
  const inside = new THREE.Vector3(0, 2, 0);
  resolveBaseCollision(inside, inside, bounds);
  assert.ok(inside.x < -5.35 || inside.x > 5.35 || inside.z < -4.35 || inside.z > 4.35);
  const distant = new THREE.Vector3(20, 1, 21);
  resolveBaseCollision(distant, new THREE.Vector3(19, 1, 20), bounds);
  assert.deepEqual(distant.toArray(), [20, 1, 21]);
});

test("platform sides block walking and jumps that have not cleared the top", () => {
  const platform = new THREE.Box3(new THREE.Vector3(-2, 0, -2), new THREE.Vector3(2, 1, 2));
  const offset = 0.4;
  for (const feetY of [0, 0.25, 0.9]) {
    const previous = new THREE.Vector3(-3, feetY + offset, 0);
    const next = new THREE.Vector3(0, feetY + offset, 0);
    resolvePlatformCollision(next, previous, platform, offset);
    assert.ok(next.x < platform.min.x - 0.35);
    assert.equal(next.y, previous.y);
    const state = { grounded: feetY === 0, velocity: new THREE.Vector3() };
    advanceGroundedActor({ position: next }, state, offset, 0, 1 / 60);
    assert.ok(next.y <= previous.y, "Blocked movement cannot teleport the player up");
  }
});

test("jumping above the platform permits entry and gravity lands on the top", () => {
  const platform = new THREE.Box3(new THREE.Vector3(-2, 0, -2), new THREE.Vector3(2, 1, 2));
  const offset = 0.4;
  const actor = new THREE.Group();
  actor.position.set(0, 1.8 + offset, 0);
  resolvePlatformCollision(actor.position, new THREE.Vector3(-3, actor.position.y, 0), platform, offset);
  assert.equal(actor.position.x, 0);
  const state = { grounded: false, velocity: new THREE.Vector3(0, -1, 0) };
  for (let frame = 0; frame < 120 && !state.grounded; frame++) advanceGroundedActor(actor, state, offset, platform.max.y, 1 / 60);
  assert.equal(state.grounded, true);
  assert.equal(actor.position.y, platform.max.y + offset);
  const onTop = actor.position.clone();
  actor.position.x = 1;
  resolvePlatformCollision(actor.position, onTop, platform, offset);
  assert.equal(actor.position.x, 1, "Walking along the top remains allowed");
});
