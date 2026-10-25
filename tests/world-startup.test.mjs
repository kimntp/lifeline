import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import * as THREE from "three";
import { GameSession } from "../src/game-menu.js";
import { GardenMission } from "../src/garden-mission.js";
import { ASTRONAUT_CLIPS } from "../src/astronaut-animations.js";
import { placeSpaceBase } from "../src/space-base.js";
import { createSampleStation } from "../src/sample-station.js";

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
  const api = vm.runInNewContext(`${source}\n({ shared, session, loadSpaceBase, createSurveyInteraction, getMission: () => gardenMission });`, {
    THREE, GameSession, GardenMission, ASTRONAUT_CLIPS, placeSpaceBase, createSampleStation,
    FBXLoader: AssetLoader,
    createColonyInteraction(_colony, options) { interactionOptions = options; return {}; },
    createGameMenu: () => ({ render: noop }),
    window: { addEventListener: noop }, document: { addEventListener: noop },
    localStorage: { getItem: () => null }, console, queueMicrotask,
  });
  api.shared.scene = new THREE.Scene();
  api.shared.terrainGround = { heightAt: () => 0,
    bounds: new THREE.Box3(new THREE.Vector3(-100, 0, -100), new THREE.Vector3(100, 0, 100)) };
  await api.loadSpaceBase();
  assert.deepEqual(fetched, ["/assets/Base.fbx"]);
  assert.ok(api.shared.scene.getObjectByName("SpaceBase"));
  assert.ok(api.shared.scene.getObjectByName("BaseSampleStation"));
  assert.ok(api.shared.sampleStation.target.toArray().every(Number.isFinite));
  api.createSurveyInteraction({});
  assert.equal(interactionOptions.mission, api.getMission());
  assert.equal(interactionOptions.mission.phase, "contact");
  assert.deepEqual(interactionOptions.mission.inventory, []);
  assert.equal(typeof interactionOptions.onDeposit, "function");
  await interactionOptions.onDeposit();
  assert.equal(api.getMission().phase, "contact", "Cannot deposit samples from the home screen");
});
