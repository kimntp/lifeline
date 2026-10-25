import { verifiedSpeechFactory, silentDubbingFactory } from "./helpers/verified-speech.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { GardenMission, GROWING_CONDITIONS, nearestSamplePlot, surveyDialogue } from "../src/garden-mission.js";
import { createColonyInteraction } from "../src/colony-interaction.js";
import { createSampleStation } from "../src/sample-station.js";

function finishSurvey(mission, order = ["soil", "tomato", "wheat"]) {
  mission.learnGrowth();
  for (const type of order) mission.collect(type, "shovel");
  mission.learnWater({ x: 20, z: 20 });
}

test("mission gates sampling and deposits until peaceful contact and every objective is complete", () => {
  const mission = new GardenMission();
  assert.equal(mission.phase, "contact");
  assert.doesNotMatch(mission.apolloMessage, /Peaceful contact only/i);
  assert.deepEqual(mission.objectives.map(item => item.label), ["Talk to one of the aliens"]);
  assert.equal(mission.collect("soil", "shovel"), false);
  assert.equal(mission.learnWater({ x: 0, z: 0 }), false);
  assert.equal(mission.beginDeposit(), false);
  assert.equal(mission.learnGrowth(), true);
  assert.equal(mission.phase, "survey");
  assert.equal(mission.objectives.length, 4);
  assert.equal(GROWING_CONDITIONS.length, 4);
  assert.equal(mission.collect("soil"), false, "Soil sampling requires the shovel");
  assert.equal(mission.collect("soil", "shovel"), true);
  assert.equal(mission.collect("soil", "shovel"), false);
  assert.equal(mission.collect("unknown"), false);
  mission.collect("tomato"); mission.collect("wheat");
  assert.equal(mission.beginDeposit(), false, "Water supply must be learned before reporting");
  mission.learnWater({ x: 20, z: 20 });
  assert.equal(mission.phase, "return");
  assert.match(mission.apolloMessage, /base FIRST/);
  assert.equal(mission.inventory.length, 3);
  assert.equal(mission.beginDeposit(), true);
  assert.equal(mission.beginDeposit(), false);
  assert.equal(mission.phase, "depositing");
  assert.equal(mission.finishDeposit(), true);
  assert.equal(mission.phase, "complete");
  assert.deepEqual(mission.inventory, []);
  assert.ok(mission.objectives.every(item => item.done));
  assert.equal(mission.collect("soil", "shovel"), false);
  assert.equal(mission.beginDeposit(), false);
});

test("learning water first still requires every crop; cancellation preserves samples for a retry", () => {
  for (const missing of ["soil", "tomato", "wheat"]) {
    const mission = new GardenMission();
    mission.learnGrowth(); mission.learnWater({ x: -20, z: -20 });
    for (const type of ["soil", "tomato", "wheat"]) if (type !== missing) mission.collect(type, "shovel");
    assert.equal(mission.beginDeposit(), false);
    mission.collect(missing, "shovel");
    assert.equal(mission.phase, "return");
    assert.equal(mission.beginDeposit(), true);
    mission.cancelDeposit();
    assert.equal(mission.phase, "return");
    assert.equal(mission.inventory.length, 3);
    assert.equal(mission.beginDeposit(), true);
    assert.equal(mission.finishDeposit(), true);
  }
});

test("progress and water coordinates survive reload without losing samples during a fade", () => {
  const mission = new GardenMission();
  finishSurvey(mission);
  const coords = { ...mission.coordinates };
  mission.beginDeposit();
  const restored = new GardenMission(JSON.parse(JSON.stringify(mission.serialize())));
  assert.equal(restored.phase, "return");
  assert.equal(restored.inventory.length, 3);
  assert.deepEqual(restored.waterDestination({ x: -50, z: -50 }), coords);
  restored.beginDeposit(); restored.finishDeposit();
  const complete = new GardenMission(restored.serialize());
  assert.equal(complete.phase, "complete");
  assert.deepEqual(complete.inventory, []);
  assert.equal(new GardenMission({ version: 1, completed: true }).completed, false);
  assert.equal(new GardenMission({ version: 2, explained: true }).explained, false);
});

function fixture() {
  const worker = { profile: { name: "Iri", role: "Soilkeeper" }, phase: "tend", talking: false,
    visual: new THREE.Group() };
  worker.visual.position.set(16, 0, 16);
  const plots = ["tomato", "wheat"].map((crop, index) => ({ crop,
    center: new THREE.Vector3(22 + index * 8, 1.2, 22),
    bounds: new THREE.Box3(new THREE.Vector3(20 + index * 8, 0, 20), new THREE.Vector3(24 + index * 8, 1.2, 24)) }));
  return { site: { x: 24, z: 20 }, workers: [worker], plots };
}

test("sampling selects only the nearby crop, requires contact, and never grants a duplicate", () => {
  const colony = fixture(), mission = new GardenMission();
  const position = colony.plots[0].center.clone();
  assert.equal(nearestSamplePlot(colony, position, mission), null);
  mission.learnGrowth();
  assert.equal(nearestSamplePlot(colony, position, mission).type, "soil");
  mission.collect("soil", "shovel");
  assert.equal(nearestSamplePlot(colony, position, mission).type, "tomato");
  mission.collect("tomato");
  assert.equal(nearestSamplePlot(colony, position, mission), null);
  assert.equal(nearestSamplePlot(colony, colony.plots[1].center, mission).type, "wheat");
  assert.equal(nearestSamplePlot(colony, new THREE.Vector3(100, 0, 100), mission), null);
  assert.equal(nearestSamplePlot(colony, new THREE.Vector3(30, 10, 22), mission), null);
});

test("E completes the entire peaceful survey, then deposits only at the base station", () => {
  const elements = new Map();
  const root = { hidden: true, remove() {}, set innerHTML(value) {
    for (const match of value.matchAll(/id="([^"]+)"/g)) elements.set(`#${match[1]}`, { hidden: false, textContent: "" });
    elements.set("h2", { textContent: "" });
  }, querySelector: selector => elements.get(selector) };
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: () => root, body: { appendChild() {} } };
  try {
    const colony = fixture(), mission = new GardenMission();
    const player = { position: new THREE.Vector3(16, 0.4, 16) };
    let pressed = false, qPressed = false, deposits = 0, saved = null;
    const samples = [];
    const keyboard = { consumeJustPressed(code) {
      if (code === "KeyQ") { const value = qPressed; qPressed = false; return value; }
      if (code !== "KeyE") return false;
      const value = pressed; pressed = false; return value;
    } };
    let equipped = "none";
    const interaction = createColonyInteraction(colony, { getTool: () => equipped, dubbingFactory: silentDubbingFactory, speechFactory: verifiedSpeechFactory, mission, getFootOffset: () => 0.4,
      getBaseTarget: () => new THREE.Vector3(0, 1, 0),
      onProgress: () => { saved = mission.serialize(); }, onSample: type => samples.push(type),
      onDeposit: () => { if (mission.beginDeposit()) deposits++; } });
    const step = (key = true) => { pressed = key; interaction.update(player, keyboard); };
    step(false);
    assert.equal(elements.get("#mission-panel").className, "mission-panel is-open", "First contact objective opens automatically");
    assert.match(elements.get("#mission-objectives").innerHTML, /Talk to one of the aliens/);
    assert.doesNotMatch(elements.get("#mission-objectives").innerHTML, /Collect a soil sample/);
    qPressed = true; step(false);
    assert.equal(elements.get("#mission-panel").className, "mission-panel");
    assert.equal(elements.get("#objectives-toggle").ariaExpanded, "false");
    step(false);
    assert.equal(elements.get("#mission-panel").className, "mission-panel", "One key press must only toggle once");
    assert.equal(elements.get("#mission-conditions").hidden, true);
    for (let i = 0; i < 5; i++) step();
    assert.equal(mission.explained, true);
    assert.equal(colony.workers[0].talking, false);
    assert.equal(elements.get("#mission-conditions").hidden, false);
    assert.match(elements.get("#mission-objectives").innerHTML, /Collect a soil sample/);
    assert.equal(elements.get("#mission-panel").className, "mission-panel is-open", "New survey tasks open the tab");
    assert.equal(elements.has("#apollo-radio"), false);
    player.position.copy(colony.plots[0].center).add(new THREE.Vector3(0, 0.4, 0));
    step();
    assert.deepEqual(samples, [], "Soil cannot be collected with bare hands");
    assert.equal(interaction.dig(player), false);
    equipped = "shovel";
    assert.equal(interaction.dig({ position: new THREE.Vector3(100, 0.4, 100) }), false, "Shovel requires nearby soil");
    assert.equal(interaction.dig(player), true, "Shovel digging collects soil");
    assert.equal(interaction.dig(player), false, "Soil cannot be collected twice");
    step();
    assert.deepEqual(samples, ["soil", "tomato"]);
    player.position.copy(colony.plots[1].center).add(new THREE.Vector3(0, 0.4, 0));
    step();
    assert.deepEqual(samples, ["soil", "tomato", "wheat"]);
    player.position.set(0, 1.4, 0); step();
    assert.equal(deposits, 0, "Cannot deposit before asking about water");
    player.position.set(16, 0.4, 16);
    for (let i = 0; i < 4; i++) step();
    assert.equal(mission.waterKnown, true);
    assert.equal(mission.phase, "return");
    assert.deepEqual(saved.coordinates, mission.coordinates);
    assert.match(elements.get("#mission-apollo").textContent, /base FIRST/);
    assert.match(elements.get("#mission-water").textContent, /Ares Water Colony/);
    player.position.set(0, 5, 0); step();
    assert.equal(deposits, 0, "Cannot deposit while above the station");
    player.position.set(0, 1.4, 0); step(false);
    assert.match(elements.get("#colony-talk-prompt").textContent, /Deposit samples/);
    step(); step();
    assert.equal(deposits, 1);
    assert.equal(mission.phase, "depositing");
    mission.finishDeposit(); interaction.refresh();
    assert.doesNotThrow(() => interaction.leave(), "Phase two can release the garden dialogue without stopping the game loop");
    assert.equal(elements.get("#mission-title").textContent, "SURVEY COMPLETE");
    assert.deepEqual(mission.inventory, []);
    interaction.setVisible(true);
    assert.equal(root.hidden, true);
  } finally { globalThis.document = originalDocument; }
});

test("sample table and intake tube stand off the foundation and follow the base", () => {
  const base = { userData: {
    foundationBounds: new THREE.Box3(new THREE.Vector3(-8, 0, -8), new THREE.Vector3(8, 1, 8)),
    buildingBounds: new THREE.Box3(new THREE.Vector3(-7, 1, -7), new THREE.Vector3(7, 7, 7)),
  } };
  const mission = new GardenMission(), station = createSampleStation();
  station.update(base, null, mission);
  const samples = ["soil", "tomato", "wheat"].map(type => station.group.getObjectByName(`SampleContainer_${type}`));
  assert.ok(samples.every(child => !child.visible));
  assert.ok(station.group.getObjectByName("SampleStationTable"));
  assert.ok(station.group.getObjectByName("SampleIntakeTube"));
  assert.equal(station.bounds.intersectsBox(base.userData.foundationBounds), false);
  assert.equal(station.target.y, 0);
  finishSurvey(mission);
  station.update(base, null, mission);
  assert.equal(station.group.getObjectByName("SampleStationMarker").visible, true);
  mission.beginDeposit(); mission.finishDeposit();
  station.update(base, null, mission);
  assert.equal(station.group.getObjectByName("SampleStationMarker").visible, false);
  assert.ok(samples.every(child => child.visible));
  const old = station.target.clone();
  base.userData.foundationBounds.translate(new THREE.Vector3(20, 0, 10));
  base.userData.buildingBounds.translate(new THREE.Vector3(20, 0, 10));
  station.update(base, null, mission);
  assert.equal(station.target.x, old.x + 20);
  assert.equal(station.target.z, old.z + 10);
});
