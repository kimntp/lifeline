import { silentDubbingFactory } from "./helpers/verified-speech.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import * as THREE from "three";
import { createAlienLoader, prepareAlienModel } from "../src/alien-farmers.js";
import { equipShovel } from "../src/player-inventory.js";
import { IceEncounter, equipTaserBaton, equipMiningPick } from "../src/ice-encounter.js";
import { createIceInteraction } from "../src/ice-interaction.js";
import { createDialogueSession } from "../src/dialogue-session.js";
import { ICE_ASSETS, buildIceBase } from "../src/ice-base.js";

const bytes = fs.readFileSync(new URL("../public/assets/Alien_Low_Gray.fbx", import.meta.url));
const source = prepareAlienModel(createAlienLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), ""));
function setup(onPlayerDown, base = {}) {
  return new IceEncounter({ source, ground: { heightAt: () => 0 },
    iceBase: { location: { x: 0, z: 0 }, obstacles: [], group: new THREE.Group(), ...base }, onPlayerDown });
}

function subdue(encounter) {
  encounter.recognize(); encounter.turnHostile();
  const player = { position: new THREE.Vector3() }, state = { health: 100 };
  for (let i = 0; i < 6; i++) {
    for (const unit of encounter.units) unit.visual.position.set(30 + unit.id, 0, 30);
    encounter.units[i].visual.position.set(0, 0, 1);
    encounter.batonCooldown = 0;
    assert.equal(encounter.strike(player.position, new THREE.Vector3(0, 0, 1)), true);
    assert.equal(encounter.strike(player.position, new THREE.Vector3(0, 0, 1)), false, "Baton cooldown prevents hit spam");
    encounter.update(0.7, player, state);
    assert.equal(encounter.units[i].hits, 1);
    assert.equal(encounter.units[i].state, i === 5 ? "downed" : "asleep");
  }
}

test("Colony 2 has six gray aliens and only attacks after recognition dialogue", () => {
  const encounter = setup();
  assert.equal(encounter.units.length, 6);
  assert.ok(encounter.units.every(unit => unit.visual.userData.variant === "gray"));
  const player = { position: encounter.units[0].visual.position.clone() }, state = { health: 100 };
  encounter.update(1, player, state);
  assert.equal(state.health, 100);
  encounter.recognize(); encounter.update(1, player, state);
  assert.equal(state.health, 100);
  encounter.turnHostile(); encounter.update(0.01, player, state);
  assert.equal(state.health, 92);
  encounter.update(0.1, player, state);
  assert.equal(state.health, 92, "Damage cooldown prevents six simultaneous hits");
  state.health = 3;
  encounter.update(1.5, player, state);
  assert.equal(state.health, 0);
  encounter.dispose();
});

test("baton leaves five asleep and the last alien downed, alive and talkable", () => {
  const encounter = setup();
  assert.equal(encounter.strike(new THREE.Vector3(), new THREE.Vector3(0, 0, 1)), false);
  subdue(encounter);
  assert.equal(encounter.asleep, 5);
  assert.equal(encounter.phase, "lastDowned");
  assert.ok(encounter.lastAlien);
  assert.equal(encounter.lastAlien.state, "downed");
  assert.ok(encounter.units.every(unit => !Object.hasOwn(unit, "dead")));
  assert.equal(encounter.collect("ice"), false);
  assert.equal(encounter.strike(new THREE.Vector3(), new THREE.Vector3(0, 0, 1)), false);
  assert.equal(encounter.assignTasks(), true);
  assert.equal(encounter.phase, "tasks");
  assert.equal(encounter.collect("ice"), false, "Ice cannot be collected without a pickaxe");
  assert.equal(encounter.collect("ice", "pickaxe"), true);
  assert.equal(encounter.collect("ice"), false);
  assert.equal(encounter.collect("water"), true);
  assert.equal(encounter.collect("crystal"), true);
  assert.equal(encounter.phase, "complete");
  encounter.dispose();
});

test("obstacles and distance prevent baton hits through walls or outside reach", () => {
  const encounter = setup();
  encounter.recognize(); encounter.turnHostile();
  for (const unit of encounter.units) unit.visual.position.set(30, 0, 30);
  encounter.units[0].visual.position.set(0, 0, 2);
  encounter.base.obstacles.push(new THREE.Box3(new THREE.Vector3(-1, -1, 0.7), new THREE.Vector3(1, 3, 1)));
  assert.equal(encounter.strike(new THREE.Vector3(), new THREE.Vector3(0, 0, 1)), false);
  assert.equal(encounter.units[0].hits, 0);
  encounter.dispose();
});

test("downed alien dialogue unlocks Apollo's tasks without giving an exact translation", () => {
  const encounter = setup(); subdue(encounter);
  const elements = new Map();
  const root = { hidden: true, remove() {}, set innerHTML(html) {
    for (const match of html.matchAll(/id="([^"]+)"/g)) elements.set(`#${match[1]}`, { hidden: false, textContent: "", addEventListener() {} });
  }, querySelector: selector => elements.get(selector) };
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => root, body: { appendChild() {} } };
  try {
    let completed = 0;
    const ui = createIceInteraction(encounter, { dubbingFactory: silentDubbingFactory, channel: createDialogueSession(), onComplete: () => completed++ });
    const player = { position: encounter.lastAlien.visual.position.clone() };
    let pressed = false;
    const keyboard = { consumeJustPressed(code) { if (code !== "KeyE") return false; const value = pressed; pressed = false; return value; } };
    const press = () => { pressed = true; ui.update(player, keyboard); };
    press();
    assert.match(elements.get("#ice-line").textContent, /untranslated language/);
    assert.equal(encounter.phase, "lastDowned");
    press(); assert.match(elements.get("#ice-line").textContent, /translate/);
    press();
    assert.equal(encounter.phase, "tasks");
    assert.equal(elements.get("#ice-speaker").textContent, "Apollo");
    assert.equal(elements.get("#ice-line").textContent, "", "Dubbed text waits for audio rather than appearing all at once");
    press(); assert.equal(ui.conversing, false);
    encounter.collect("ice", "pickaxe"); encounter.collect("crystal");
    assert.equal(completed, 0, "Partial sampling does not start the scene");
    player.position.copy(encounter.water.position);
    press();
    assert.equal(completed, 1, "Final water scan starts the scene");
    assert.equal(encounter.phase, "complete");
    press(); assert.equal(completed, 1, "Completed samples cannot retrigger the scene");
    ui.leave(); // The guard cutscene closes the encounter UI before unlocking direct contact.
    encounter.directContact = true;
    player.position.copy(encounter.lastAlien.visual.position);
    press(); press();
    assert.equal(elements.get("#ice-line").textContent, "", "Alien disclosures reveal with their voice");
    assert.doesNotMatch(elements.get("#ice-line").textContent, /Translation processed/);
    ui.destroy();
  } finally { globalThis.document = previousDocument; }
  encounter.dispose();
});

test("astronaut has a left-hand nonlethal baton available to equip", () => {
  const player = new THREE.Group();
  const hand = new THREE.Bone(); hand.name = "maoL";
  const right = new THREE.Bone(); right.name = "maoR";
  player.add(hand, right);
  const baton = equipTaserBaton(player);
  assert.equal(baton.parent, hand);
  assert.equal(baton.name, "TaserBaton");
  assert.ok(baton.children.length >= 2);
  assert.ok(baton.scale.toArray().every(Number.isFinite));
});

test("neutral gray aliens walk to ice deposits and repeatedly mine them", () => {
  const group = new THREE.Group();
  const rock = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 2), new THREE.MeshStandardMaterial());
  rock.name = "ice_block"; rock.position.set(0, 1.5, 5);
  group.add(rock); group.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(rock);
  const encounter = setup(undefined, { group, obstacles: [bounds] });
  const player = { position: new THREE.Vector3(50, 0, 50) }, state = { health: 100 };
  for (let frame = 0; frame < 1200; frame++) encounter.update(0.05, player, state);
  assert.equal(state.health, 100);
  for (const unit of encounter.units) {
    assert.ok(unit.minedCycles > 0, `${unit.visual.name} should finish a mining cycle`);
    assert.ok(unit.walkedDistance > 1, "miner travels between work sites");
    assert.equal(unit.pick.visible, true);
    assert.ok(!bounds.containsPoint(unit.visual.position));
  }
  encounter.dispose();
});

test("clear baton strikes are not rejected by broad ice bounding boxes", () => {
  const group = new THREE.Group();
  const rock = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial());
  rock.position.set(10, 1, 10); group.add(rock);
  const encounter = setup(undefined, { group,
    obstacles: [new THREE.Box3(new THREE.Vector3(-2, 0, 0.7), new THREE.Vector3(2, 3, 1))] });
  encounter.recognize(); encounter.turnHostile();
  for (const unit of encounter.units) unit.visual.position.set(30, 0, 30);
  const target = encounter.units[0]; target.visual.position.set(0, 0, 2);
  assert.equal(encounter.strike(new THREE.Vector3(), new THREE.Vector3(0, 0, 1)), true);
  assert.equal(target.hits, 1);
  assert.ok(target.flashTime > 0);
  assert.match(encounter.feedback, /Taser connected/);
  encounter.dispose();
});

test("swinging during recognition releases dialogue ownership and registers a stun", () => {
  const encounter = setup();
  for (const unit of encounter.units) unit.visual.position.set(30, 0, 30);
  encounter.units[0].visual.position.set(0, 0, 1);
  const elements = new Map();
  const root = { remove() {}, set innerHTML(html) {
    for (const match of html.matchAll(/id="([^"]+)"/g)) elements.set(`#${match[1]}`, { hidden: false, textContent: "", addEventListener() {} });
  }, querySelector: selector => elements.get(selector) };
  const previous = globalThis.document;
  globalThis.document = { createElement: () => root, body: { appendChild() {} } };
  try {
    const channel = createDialogueSession();
    let equipped = "baton";
    const ui = createIceInteraction(encounter, { dubbingFactory: silentDubbingFactory, channel, getTool: () => equipped });
    ui.update({ position: new THREE.Vector3() }, { consumeJustPressed: code => code === "KeyE" });
    assert.equal(channel.busy, true);
    assert.equal(encounter.phase, "recognition");
    assert.equal(elements.get("#ice-mission-panel").className, "mission-panel is-open", "Colony 2 objectives open on assignment");
    ui.update({ position: new THREE.Vector3() }, { consumeJustPressed: code => code === "KeyQ" });
    assert.equal(elements.get("#ice-mission-panel").className, "mission-panel");
    ui.update({ position: new THREE.Vector3() }, { consumeJustPressed: () => false });
    assert.equal(elements.get("#ice-mission-panel").className, "mission-panel", "Unchanged tasks respect closing the panel");
    ui.prepareStrike();
    assert.equal(channel.busy, false);
    assert.equal(encounter.phase, "hostile");
    ui.update({ position: new THREE.Vector3() }, { consumeJustPressed: () => false });
    assert.equal(elements.get("#ice-mission-panel").className, "mission-panel is-open", "New defense objectives reopen the panel");
    assert.equal(encounter.strike(new THREE.Vector3(), new THREE.Vector3(0, 0, 1)), true);
    assert.equal(encounter.units[0].hits, 1);
    const idleKeys = { consumeJustPressed: () => false };
    ui.update({ position: new THREE.Vector3() }, idleKeys, 5);
    assert.equal(elements.has("#ice-equipped"), false);
    equipped = "pickaxe";
    ui.update({ position: new THREE.Vector3() }, idleKeys, 0);
    assert.equal(elements.has("#ice-equipped"), false, "Switching tools does not show an equipped popup");
    ui.update({ position: new THREE.Vector3() }, idleKeys, 5);
    assert.equal(elements.has("#ice-equipped"), false);
    ui.destroy();
  } finally { globalThis.document = previous; }
  encounter.dispose();
});

test("all six miners have usable work positions in the real ice-outpost layout", () => {
  const models = Object.fromEntries(ICE_ASSETS.map(name => {
    const asset = fs.readFileSync(new URL(`../public/assets/${name}.fbx`, import.meta.url));
    return [name, createAlienLoader().parse(asset.buffer.slice(asset.byteOffset, asset.byteOffset + asset.byteLength), "")];
  }));
  const base = buildIceBase({ models, ground: { heightAt: () => 0 }, location: { x: 0, z: 0 } });
  const encounter = setup(undefined, base);
  for (const unit of encounter.units) {
    assert.ok(unit.home.distanceTo(unit.rock) < 7, "Miner must be assigned to an actual ice face");
    assert.ok(!base.obstacles.some(box => unit.home.x > box.min.x - 0.3 && unit.home.x < box.max.x + 0.3
      && unit.home.z > box.min.z - 0.3 && unit.home.z < box.max.z + 0.3));
  }
  const player = { position: new THREE.Vector3(50, 0, 50) };
  for (let frame = 0; frame < 400; frame++) encounter.update(0.05, player, { health: 100 });
  assert.ok(encounter.units.every(unit => unit.minedCycles > 0));
  assert.ok(encounter.units.every(unit => unit.walkedDistance > 0.5), "All six miners circulate around the scattered outpost");
  encounter.dispose();
});


test("mining requires the pickaxe, reach, facing, and three paced strikes on the same block", () => {
  const group = new THREE.Group();
  const block = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial());
  block.name = "ice_block"; block.position.set(0, 1, 3); group.add(block); group.updateMatrixWorld(true);
  const encounter = setup(undefined, { group, obstacles: [new THREE.Box3().setFromObject(block)] });
  encounter.phase = "tasks";
  const origin = new THREE.Vector3(), forward = new THREE.Vector3(0, 0, 1);
  assert.equal(encounter.mine(origin, forward, "baton"), false);
  assert.equal(encounter.collect("ice"), false, "E collection cannot bypass mining");
  assert.equal(encounter.mine(new THREE.Vector3(0, 0, -10), forward, "pickaxe"), false);
  assert.equal(encounter.mine(origin, forward.clone().negate(), "pickaxe"), false);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 0.2), new THREE.MeshStandardMaterial());
  wall.position.set(0, 1, 1); wall.updateMatrixWorld(true); encounter.occluders.push(wall);
  assert.equal(encounter.mine(origin, forward, "pickaxe"), false, "Mining cannot pass through another structure");
  encounter.occluders.pop();
  assert.equal(encounter.mine(origin, forward, "pickaxe"), true);
  assert.equal(encounter.mine(origin, forward, "pickaxe"), false, "Cooldown prevents instant mining");
  for (let i = 0; i < 2; i++) {
    encounter.miningCooldown = 0;
    assert.equal(encounter.mine(origin, forward, "pickaxe"), true);
  }
  assert.equal(encounter.tasks.ice, true);
  assert.equal(encounter.units.every(unit => unit.hits === 0), true, "The pickaxe never harms aliens");
  assert.equal(encounter.mine(origin, forward, "pickaxe"), false, "Sample is mined once");
  encounter.dispose();
});

test("astronaut pickaxe attaches to the same hand as the baton", () => {
  const player = new THREE.Group(), hand = new THREE.Bone(); hand.name = "maoL";
  player.scale.setScalar(0.01); player.add(hand);
  const pickaxe = equipMiningPick(player, true);
  assert.equal(pickaxe.parent, hand);
  assert.ok(Math.abs(pickaxe.getWorldScale(new THREE.Vector3()).x - 1) < 1e-6);
});


test("survey shovel is a hidden inventory tool attached at world scale to the left hand", () => {
  const player = new THREE.Group(), hand = new THREE.Bone(); hand.name = "maoL";
  player.scale.setScalar(0.01); player.add(hand);
  const shovel = equipShovel(player);
  assert.equal(shovel.parent, hand); assert.equal(shovel.visible, false);
  assert.equal(shovel.name, "SurveyShovel");
  assert.ok(Math.abs(shovel.getWorldScale(new THREE.Vector3()).x - 1) < 1e-6);
});
