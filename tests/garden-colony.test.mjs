import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import * as THREE from "three";
import { createAlienLoader, prepareAlienModel, createAlienFarmer } from "../src/alien-farmers.js";
import { buildGardenColony, GARDEN_COLONY, nearestGardenWorker } from "../src/garden-colony.js";
import { resolveBaseCollision } from "../src/base-collision.js";
import { createColonyInteraction } from "../src/colony-interaction.js";

function model(file) {
  const bytes = fs.readFileSync(new URL(`../public/assets/${file}`, import.meta.url));
  return createAlienLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
}
const ground = {
  bounds: new THREE.Box3(new THREE.Vector3(-100, 0, -100), new THREE.Vector3(100, 30, 100)),
  heightAt: (x, z) => 2 + Math.sin(x * 0.03) + Math.cos(z * 0.04),
};
const models = { tomato: model("Tomato Plant.fbx"), wheat: model("Wheat Crop.fbx"), dome: model("hab_dome.fbx"),
  aliens: { gray: prepareAlienModel(model("Alien_Low_Gray.fbx")), green: prepareAlienModel(model("Alien_Low_Green.fbx")) } };
const baseBounds = new THREE.Box3(new THREE.Vector3(-84, 0, -4), new THREE.Vector3(-68, 8, 12));
const colony = buildGardenColony({ ...models, ground, baseBounds });

test("colony uses the supplied dome, tomato and wheat assets at human scale", () => {
  assert.equal(colony.plots.length, 4);
  assert.equal(colony.workers.length, 3);
  assert.deepEqual(colony.workers.map(worker => worker.visual.userData.variant), ["green", "gray", "green"]);
  for (const worker of colony.workers) {
    const animator = worker.visual.userData.animator;
    assert.deepEqual([...animator.actions.keys()].sort(), ["Idle", "Run", "Walk"]);
    worker.visual.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(worker.visual, true);
    assert.ok(Math.abs(box.getSize(new THREE.Vector3()).y - 1.65) < 1e-5);
    let skinned = 0;
    const ownBones = new Set();
    worker.visual.traverse(node => { if (node.isBone) ownBones.add(node); });
    worker.visual.traverse(node => {
      if (!node.isSkinnedMesh) return;
      skinned++;
      for (const bone of node.skeleton.bones) assert.ok(ownBones.has(bone), "Farmer must bind to its own cloned skeleton");
    });
    assert.equal(skinned, 1);
  }
  assert.equal(colony.plots.filter(plot => plot.crop === "tomato").length, 2);
  assert.equal(colony.plots.filter(plot => plot.crop === "wheat").length, 2);
  assert.equal(colony.plots.flatMap(plot => plot.plants).length, 48);
  const habitat = colony.group.getObjectByName("GardenHabDome");
  const size = new THREE.Box3().setFromObject(habitat).getSize(new THREE.Vector3());
  assert.ok(Math.abs(size.y - 6.4) < 1e-5);
  assert.ok(Math.abs(size.x - 8) < 1e-5);
  assert.ok(colony.bounds.min.x > ground.bounds.min.x && colony.bounds.max.x < ground.bounds.max.x);
  assert.ok(colony.bounds.min.z > ground.bounds.min.z && colony.bounds.max.z < ground.bounds.max.z);
  for (const plot of colony.plots) {
    for (const plant of plot.plants) {
      const box = new THREE.Box3().setFromObject(plant);
      assert.ok(Math.abs(box.min.y - plot.center.y) < 1e-5);
      assert.ok(box.max.y - box.min.y < 1.2);
    }
  }
});

test("player cannot cross the dome from any side or through its entrance", () => {
  const box = colony.domeBounds;
  const center = box.getCenter(new THREE.Vector3());
  for (const axis of ["x", "z"]) {
    for (const sign of [-1, 1]) {
      const previous = center.clone();
      previous[axis] = sign < 0 ? box.min[axis] - 3 : box.max[axis] + 3;
      const position = center.clone();
      position[axis] = sign < 0 ? box.max[axis] + 3 : box.min[axis] - 3;
      resolveBaseCollision(position, previous, box);
      assert.ok(sign < 0 ? position[axis] < box.min[axis] - 0.35 : position[axis] > box.max[axis] + 0.35);
    }
  }
});

test("farmers tend and grow crops, enter and exit the dome, and stay in the colony", () => {
  const phases = colony.workers.map(() => new Set());
  let fertile = false;
  for (let frame = 0; frame < 4000; frame++) {
    colony.update(0.05);
    for (let i = 0; i < colony.workers.length; i++) {
      const worker = colony.workers[i];
      phases[i].add(worker.phase);
      assert.ok(colony.bounds.containsPoint(worker.visual.position), `${worker.profile.name} left the colony`);
      if (worker.phase === "inside") {
        assert.equal(worker.visual.visible, false);
        assert.ok(colony.domeBounds.containsPoint(worker.visual.position));
      } else assert.equal(worker.visual.visible, true);
      worker.visual.traverse(node => assert.ok([...node.position, ...node.rotation.toArray().slice(0, 3)].every(Number.isFinite)));
    }
    if (colony.plots.some(plot => plot.growth > 0)) fertile = true;
  }
  for (const observed of phases) for (const phase of ["toCrop", "tend", "toDome", "enter", "inside", "exit"]) assert.ok(observed.has(phase), phase);
  assert.equal(fertile, true);
  assert.ok(colony.plots.every(plot => plot.growth > 0));
  assert.ok(colony.plots.every(plot => plot.plants.every(plant => plant.scale.y > 0.65)));
});

test("talking holds a farmer in place and hidden farmers cannot be selected", () => {
  const worker = colony.workers[0];
  worker.phase = "tend";
  worker.visual.visible = true;
  worker.talking = true;
  const position = worker.visual.position.clone(), timer = worker.timer;
  worker.update(2);
  assert.deepEqual(worker.visual.position, position);
  assert.equal(worker.timer, timer);
  assert.equal(nearestGardenWorker([worker], position), worker);
  worker.phase = "inside";
  worker.visual.visible = false;
  assert.equal(nearestGardenWorker([worker], position), null);
  worker.talking = false;
});

test("E opens, advances and closes dialogue, revealing the colony's company objective", () => {
  // Small DOM fixture exercises interaction state without requiring WebGL.
  const elements = new Map();
  const root = { hidden: true, set innerHTML(value) {
    for (const match of value.matchAll(/id="([^"]+)"/g)) elements.set(`#${match[1]}`, { hidden: false, textContent: "" });
    elements.set("h2", { textContent: "" });
  }, querySelector: selector => elements.get(selector) };
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: () => root, body: { appendChild() {} } };
  try {
    const worker = colony.workers[1];
    worker.phase = "tend"; worker.visual.visible = true; worker.talking = false;
    const player = { position: worker.visual.position.clone() };
    let pressed = false;
    const keyboard = { consumeJustPressed(code) { assert.equal(code, "KeyE"); const value = pressed; pressed = false; return value; } };
    const interaction = createColonyInteraction(colony);
    interaction.setVisible(true);
    interaction.update(player, keyboard);
    assert.ok(elements.get("#colony-talk-prompt").textContent.includes(worker.profile.name));
    const lines = [];
    for (let i = 0; i < worker.profile.lines.length; i++) {
      pressed = true;
      interaction.update(player, keyboard);
      assert.equal(worker.talking, true);
      lines.push(elements.get("#colony-dialogue-text").textContent);
    }
    assert.ok(lines.join(" ").includes("slavery"));
    pressed = true;
    interaction.update(player, keyboard);
    assert.equal(worker.talking, false);
    assert.equal(elements.get("#colony-dialogue").hidden, true);
    pressed = true;
    interaction.update(player, keyboard);
    player.position.x += 10;
    interaction.update(player, keyboard);
    assert.equal(worker.talking, false);
    interaction.setVisible(false);
    assert.equal(root.hidden, true);
    assert.equal(GARDEN_COLONY.objective, "Enslave farmers and export crops to Earth");
  } finally {
    globalThis.document = originalDocument;
  }
});

test("chosen colony position restores exactly and rebuilds terrain support and farmer routes", () => {
  const location = JSON.parse(JSON.stringify({ x: 32.25, z: -16.5 }));
  const moved = buildGardenColony({ ...models, ground, baseBounds, location });
  assert.equal(moved.site.x, location.x);
  assert.equal(moved.site.z, location.z);
  const domeCenter = moved.domeBounds.getCenter(new THREE.Vector3());
  assert.ok(Math.abs(domeCenter.x - location.x) < 1e-5);
  assert.ok(Math.abs(domeCenter.z - (location.z - 8)) < 1e-5);
  const seen = new Set();
  for (let frame = 0; frame < 2000; frame++) {
    moved.update(0.05);
    for (const worker of moved.workers) {
      seen.add(worker.phase);
      assert.ok(moved.bounds.containsPoint(worker.visual.position));
      if (worker.phase === "inside") assert.ok(moved.domeBounds.containsPoint(worker.visual.position));
    }
  }
  assert.ok(seen.has("tend") && seen.has("inside") && seen.has("exit"));
  const before = { ...colony.site };
  assert.throws(() => buildGardenColony({ ...models, ground, baseBounds, location: { x: 99, z: 99 } }), /inland/);
  assert.throws(() => buildGardenColony({ ...models, ground, baseBounds, location: { x: -76, z: 4 } }), /overlap/);
  assert.deepEqual(colony.site, before);
  let disposedSource = false, disposedBeds = 0;
  for (const source of [models.tomato, models.wheat, models.dome, ...Object.values(models.aliens)]) source.traverse(node => {
    if (node.isMesh) node.geometry.addEventListener("dispose", () => { disposedSource = true; });
  });
  moved.group.traverse(node => {
    if (node.isMesh && node.geometry.type === "BoxGeometry") node.geometry.addEventListener("dispose", () => { disposedBeds++; });
  });
  moved.dispose();
  assert.equal(disposedSource, false);
  assert.equal(disposedBeds, 4);
});

test("native alien skeletons animate independently and tending offsets do not accumulate", () => {
  for (const variant of ["gray", "green"]) {
    const idle = createAlienFarmer(models.aliens[variant], variant);
    const tending = createAlienFarmer(models.aliens[variant], variant);
    const a = idle.userData.animator, b = tending.userData.animator;
    const original = models.aliens[variant].getObjectByName("mixamorigLeftForeArm").quaternion.clone();
    for (let frame = 0; frame < 600; frame++) {
      a.update(1 / 60, false, false);
      b.update(1 / 60, false, true);
    }
    for (const name of ["mixamorigSpine", "mixamorigLeftArm", "mixamorigRightArm", "mixamorigLeftForeArm", "mixamorigRightForeArm"]) {
      const left = a.model.getObjectByName(name), right = b.model.getObjectByName(name);
      assert.notEqual(left, right);
      assert.ok(left.quaternion.angleTo(right.quaternion) < 0.35, `${variant}: ${name} must have a bounded farming offset`);
    }
    a.update(1 / 60, false, false);
    b.update(1 / 60, false, false);
    assert.ok(a.model.getObjectByName("mixamorigLeftForeArm").quaternion.angleTo(b.model.getObjectByName("mixamorigLeftForeArm").quaternion) < 1e-6);
    assert.ok(models.aliens[variant].getObjectByName("mixamorigLeftForeArm").quaternion.angleTo(original) < 1e-6);
    idle.updateMatrixWorld(true); tending.updateMatrixWorld(true);
    assert.ok(new THREE.Box3().setFromObject(tending, true).getSize(new THREE.Vector3()).y < 1.8);
    a.dispose(); b.dispose();
  }
});
