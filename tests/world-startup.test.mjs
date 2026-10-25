import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import * as THREE from "three";
import { LEVEL_LAYOUT } from "../src/level-layout.js";
import { GameSession } from "../src/game-menu.js";
import { GardenMission } from "../src/garden-mission.js";
import { ASTRONAUT_CLIPS } from "../src/astronaut-animations.js";
import { placeSpaceBase, getPlayerSpawn } from "../src/space-base.js";
import { resolveBaseCollision, resolvePlatformCollision } from "../src/base-collision.js";
import { createSampleStation } from "../src/sample-station.js";
import { ICE_ASSETS, buildIceBase } from "../src/ice-base.js";

test("world startup wires a fresh mission, base sample station and deposit callback", async () => {
  // Execute the actual entry module's startup functions, substituting browser
  // APIs and asset fetching. Unit tests alone miss undefined startup bindings.
  let source = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  source = source.slice(0, source.lastIndexOf("\nmain().catch"))
    .replace(/^import[^\n]*\n/gm, "")
    .replace(/^export /gm, "")
    .replaceAll("import.meta.env.BASE_URL", JSON.stringify("/"));
  const fetched = [];
  let interactionOptions;
  class AssetLoader {
    async loadAsync(path) {
      fetched.push(path);
      const root = new THREE.Group();
      root.add(new THREE.Mesh(new THREE.BoxGeometry(10, 4, 8), new THREE.MeshStandardMaterial()));
      return root;
    }
  }
  const noop = () => {};
  let transitions = 0, montageDisposed = false, finishMontage;
  const montageDone = new Promise(resolve => { finishMontage = resolve; });
  const menuHarness = { render: noop, transitioning: false, async transitionToGame(fn) { fn(); transitions++; } };
  const bodyClasses = new Set();
  const api = vm.runInNewContext(`${source}\n({ shared, session, loadSpaceBase, placeIceBase, updateWorldProgression, updateColonyInteraction, selectPlayerTool, createSurveyInteraction, step9_collision, callbacks: _previewFns, loop: _loopShared, depositSurveySamples, getFlags: () => flags, getMission: () => gardenMission });`, {
    THREE, GameSession, GardenMission, ASTRONAUT_CLIPS, placeSpaceBase, getPlayerSpawn, createSampleStation, LEVEL_LAYOUT,
    FBXLoader: AssetLoader, ICE_ASSETS, buildIceBase, resolveBaseCollision, resolvePlatformCollision, dialogueSession: { busy: false },
    createColonyInteraction(_colony, options) { interactionOptions = options; return {}; },
    createGameMenu: () => menuHarness,
    createBackgroundMusic: () => ({ update: noop }), createPlayerSounds: () => ({ update: noop, swingBaton: noop }),
    createSurveyMontage() {
      assert.equal(api.getMission().completed, true, "Sample deposit commits before the montage");
      return { finished: montageDone, dispose() { montageDisposed = true; } };
    },
    window: { addEventListener: noop, matchMedia: () => ({ matches: false }) }, document: { addEventListener: noop, body: { classList: { add: name => bodyClasses.add(name), remove: name => bodyClasses.delete(name) } } },
    localStorage: { getItem() { throw new Error("World locations must not read browser storage"); }, setItem() { throw new Error("World locations must not write browser storage"); } }, console, queueMicrotask,
  });
  api.shared.scene = new THREE.Scene();
  api.shared.terrainGround = { heightAt: () => 0,
    bounds: new THREE.Box3(new THREE.Vector3(-100, 0, -100), new THREE.Vector3(100, 0, 100)) };
  await api.loadSpaceBase();
  assert.deepEqual(fetched, ["/assets/Base.fbx"]);
  assert.ok(api.shared.scene.getObjectByName("SpaceBase"));
  assert.equal(api.shared.spaceBase.userData.site.x, LEVEL_LAYOUT.base.x);
  assert.equal(api.shared.spaceBase.userData.site.z, LEVEL_LAYOUT.base.z);
  assert.ok(api.shared.scene.getObjectByName("BaseSampleStation"));
  assert.ok(api.shared.sampleStation.target.toArray().every(Number.isFinite));
  api.createSurveyInteraction({});
  assert.equal(interactionOptions.mission, api.getMission());
  assert.equal(interactionOptions.mission.phase, "contact");
  assert.deepEqual(interactionOptions.mission.inventory, []);
  assert.equal(typeof interactionOptions.onDeposit, "function");
  await interactionOptions.onDeposit();
  assert.equal(api.getMission().phase, "contact", "Cannot deposit samples from the home screen");
  await api.placeIceBase({ x: 50, z: 50 });
  api.shared.baton = new THREE.Group();
  api.shared.shovel = new THREE.Group();
  api.selectPlayerTool("shovel");
  assert.equal(api.shared.shovel.visible, true);
  api.selectPlayerTool("baton");
  assert.equal(api.shared.selectedTool, "shovel", "Combat tools remain locked during the first mission");
  api.updateWorldProgression();
  assert.equal(api.shared.baton.visible, false, "Baton stays hidden during the first survey");
  assert.equal(api.shared.iceBase.group.visible, false);
  const mission = api.getMission();
  mission.learnGrowth();
  for (const type of ["soil", "tomato", "wheat"]) mission.collect(type, "shovel");
  mission.learnWater({ x: -30, z: -30 });
  api.updateWorldProgression();
  assert.equal(api.shared.iceBase.group.visible, false, "Collected samples alone do not reveal the ice base");
  mission.beginDeposit();
  api.updateWorldProgression();
  assert.equal(api.shared.iceBase.group.visible, false, "Ice base remains hidden until the report commits");
  mission.finishDeposit();
  api.selectPlayerTool("baton");
  api.updateWorldProgression();
  assert.equal(api.shared.iceBase.group.visible, true);
  let leftGarden = 0, iceFrames = 0;
  api.shared.colonyInteraction = { leave() { leftGarden++; }, update() { assert.fail("Completed garden must not resume its objectives"); } };
  api.shared.iceInteraction = { update() { iceFrames++; } };
  api.shared.iceEncounter = { phase: "neutral", group: new THREE.Group() };
  api.shared.player = { position: new THREE.Vector3() };
  for (let i = 0; i < 3; i++) api.updateColonyInteraction(1 / 60);
  assert.equal(leftGarden, 3); assert.equal(iceFrames, 3, "Phase two keeps updating after sample turn-in");
  assert.equal(api.shared.baton.visible, true, "Baton appears after the sample-report wake-up");
  assert.equal(api.shared.shovel.visible, false, "Only the equipped tool is visible");
  api.shared.pickaxe = new THREE.Group();
  api.selectPlayerTool("pickaxe"); api.updateWorldProgression();
  assert.equal(api.shared.baton.visible, false);
  assert.equal(api.shared.pickaxe.visible, true);
  api.selectPlayerTool("baton"); api.updateWorldProgression();
  assert.equal(api.shared.baton.visible, true);
  assert.equal(api.shared.pickaxe.visible, false);
  api.shared.colony = {
    bounds: new THREE.Box3(new THREE.Vector3(30, 0, 0), new THREE.Vector3(50, 20, 20)),
    domeBounds: new THREE.Box3(new THREE.Vector3(35, 0, 3), new THREE.Vector3(43, 7, 11)), plots: [],
  };
  api.shared.player = { position: new THREE.Vector3(40, 10, 15) };
  api.loop.prevPlayerPos = new THREE.Vector3(26, 10, 15);
  api.step9_collision();
  const collision = api.callbacks.at(-1);
  collision();
  assert.ok(api.shared.player.position.x < 28.5, "Completed colony blocks jumping and large movement steps");
  mission.completed = false;
  api.shared.player.position.set(32, 10, 15);
  collision();
  assert.equal(api.shared.player.position.x, 32, "Garden stays accessible before completion");
  api.session.ready = true; api.session.play();
  api.shared.player = new THREE.Group(); api.shared.camera = new THREE.PerspectiveCamera();
  api.shared.stateMachine = { setPreview: noop }; api.shared.mixer = { update: noop };
  api.shared.colonyInteraction = { leave: noop, update: noop, refresh: noop };
  api.shared.colonyModels = { aliens: {}, wheat: new THREE.Group() };
  const deposit = api.depositSurveySamples();
  await Promise.resolve();
  assert.ok(api.shared.surveyMontage, "Phase-one turn-in opens the regional montage");
  assert.equal(bodyClasses.has("survey-cinematic"), true);
  assert.equal(transitions, 1, "Montage remains on screen until finished or skipped");
  finishMontage(); await deposit;
  assert.equal(transitions, 2, "A second fade returns to gameplay");
  assert.equal(montageDisposed, true); assert.equal(api.shared.surveyMontage, null);
  assert.equal(bodyClasses.size, 0); assert.equal(api.getFlags().missionTransition, false);
  assert.equal(mission.completed, true); assert.deepEqual(mission.inventory, []);
  assert.equal(api.shared.player.position.x, LEVEL_LAYOUT.spawn.x);
  assert.equal(api.shared.player.position.z, LEVEL_LAYOUT.spawn.z);
});
