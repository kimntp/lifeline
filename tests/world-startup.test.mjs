import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import * as THREE from "three";
import { LEVEL_LAYOUT } from "../src/level-layout.js";
import { GameSession } from "../src/game-menu.js";
import { GardenMission } from "../src/garden-mission.js";
import { ASTRONAUT_CLIPS } from "../src/astronaut-animations.js";
import { placeSpaceBase } from "../src/space-base.js";
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
  const api = vm.runInNewContext(`${source}\n({ shared, session, loadSpaceBase, placeIceBase, updateWorldProgression, selectPlayerTool, createSurveyInteraction, step9_collision, callbacks: _previewFns, loop: _loopShared, getMission: () => gardenMission });`, {
    THREE, GameSession, GardenMission, ASTRONAUT_CLIPS, placeSpaceBase, createSampleStation, LEVEL_LAYOUT,
    FBXLoader: AssetLoader, ICE_ASSETS, buildIceBase, resolveBaseCollision, resolvePlatformCollision, dialogueSession: { busy: false },
    createColonyInteraction(_colony, options) { interactionOptions = options; return {}; },
    createGameMenu: () => ({ render: noop }),
    window: { addEventListener: noop }, document: { addEventListener: noop },
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
  api.updateWorldProgression();
  assert.equal(api.shared.baton.visible, false, "Baton stays hidden during the first survey");
  assert.equal(api.shared.iceBase.group.visible, false);
  const mission = api.getMission();
  mission.learnGrowth();
  for (const type of ["soil", "tomato", "wheat"]) mission.collect(type);
  mission.learnWater({ x: -30, z: -30 });
  api.updateWorldProgression();
  assert.equal(api.shared.iceBase.group.visible, false, "Collected samples alone do not reveal the ice base");
  mission.beginDeposit();
  api.updateWorldProgression();
  assert.equal(api.shared.iceBase.group.visible, false, "Ice base remains hidden until the report commits");
  mission.finishDeposit();
  api.updateWorldProgression();
  assert.equal(api.shared.iceBase.group.visible, true);
  assert.equal(api.shared.baton.visible, true, "Baton appears after the sample-report wake-up");
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
});
