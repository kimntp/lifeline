import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as THREE from "three";
import { createAlienLoader, prepareAlienModel } from "../src/alien-farmers.js";
import { createSurveyMontage, SURVEY_SHOTS } from "../src/survey-montage.js";
import { applyAstronautSuit } from "../src/astronaut-suit.js";
import { equipShovel } from "../src/player-inventory.js";

function asset(name) {
  const bytes = fs.readFileSync(new URL(`../public/assets/${name}.fbx`, import.meta.url));
  return createAlienLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
}

test("Colony 1 guards retain correct proportions and visibly strike an alien in a close-up before workers collapse", async () => {
  const original = { document: globalThis.document, window: globalThis.window };
  const events = new Map(), elements = new Map();
  let removed = false;
  const root = { hidden: false, setAttribute() {}, remove() { removed = true; }, querySelector(selector) {
    if (!elements.has(selector)) elements.set(selector, { style: {}, addEventListener() {} });
    return elements.get(selector);
  } };
  globalThis.document = { createElement: () => root, body: { appendChild() {} } };
  globalThis.window = { addEventListener: (name, fn) => events.set(name, fn), removeEventListener: name => events.delete(name) };
  let montage;
  try {
    const player = asset("Astronauta");
    player.scale.multiplyScalar(1.7 / new THREE.Box3().setFromObject(player, true).getSize(new THREE.Vector3()).y);
    player.position.set(-72, 12, -49); const position = player.position.clone();
    applyAstronautSuit(player, "white");
    const shovel = equipShovel(player); shovel.visible = true;
    const models = { green: prepareAlienModel(asset("Alien_Low_Green")) };
    montage = createSurveyMontage({ player, alienModels: models, cropModel: asset("Wheat Crop"), tomatoModel: asset("Tomato Plant"), domeModel: asset("hab_dome"), aspect: 16 / 9 });
    assert.ok(montage.camera.position.length() > 1, "The camera is staged before the reveal fade");
    assert.equal(montage.shot.action, "forcedFarming");
    assert.equal(SURVEY_SHOTS[0].duration, 7);
    assert.equal(SURVEY_SHOTS.length, 3, "The additional close-up stays in Colony 1");
    assert.ok(SURVEY_SHOTS.every(shot => shot.region.includes("GALE CRATER")));
    const guards = montage.scene.children.filter(node => node.name.startsWith("Montage guard"));
    assert.equal(guards.length, 4);
    for (const guard of guards) {
      assert.equal(guard.userData.suitColor, "black");
      assert.equal(guard.getObjectByName("Astronauta").material.color.getHex(), 0x111820);
      assert.equal(guard.getObjectByName("TaserBaton").visible, true);
      assert.equal(guard.getObjectByName("SurveyShovel"), undefined);
      guard.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(guard, true);
      assert.ok(bounds.getSize(new THREE.Vector3()).y > 1.5 && bounds.getSize(new THREE.Vector3()).y < 2,
        "Cloned rigs must not stretch or animate nested skin bones twice");
      assert.ok(Math.abs(bounds.min.y) < 0.05, "Guard feet stay on the ground");
    }
    assert.equal(player.getObjectByName("Astronauta").material.color.getHex(), 0xf0f2ef, "Black guards cannot tint the white main astronaut");
    const colonists = montage.scene.children.filter(node => node.name.startsWith("Montage colonist"));
    assert.equal(colonists.length, 6);
    assert.ok(colonists.every(node => node.userData.variant === "green"));
    const sourceGeometry = player.getObjectByProperty("isSkinnedMesh", true).geometry;
    let sourceDisposed = false; sourceGeometry.addEventListener("dispose", () => { sourceDisposed = true; });
    montage.update(20, false);
    assert.equal(montage.shot.action, "forcedFarming", "Pause freezes the cutscene timeline");
    montage.update(6.99, true);
    assert.equal(montage.shot.action, "forcedFarming", "Guards police the farm for the full seven seconds");
    montage.update(0.02, true); assert.equal(montage.shot.action, "batonStrike");
    const farmer = colonists[0];
    assert.ok(montage.camera.position.distanceTo(farmer.position) < 5, "The strike is framed as a close-up");
    montage.update(1.3, true);
    assert.equal(guards[0].userData.strikeContact, true);
    const tip = guards[0].getObjectByName("TaserBaton").localToWorld(new THREE.Vector3(0, 0.5, 0));
    assert.ok(tip.distanceTo(farmer.position.clone().add(new THREE.Vector3(0, 0.85, 0))) < 0.6,
      "The baton reaches the alien instead of swinging through empty space");
    montage.update(0.2, true);
    assert.ok(farmer.userData.strikeRecoil > 0.9, "Alien flinches after contact");
    montage.update(2.5, true); assert.equal(montage.shot.action, "collapse");
    montage.update(3.5, true);
    assert.equal(colonists.filter(alien => Math.abs(alien.rotation.z) > 1).length, 3, "Several exhausted farmers collapse");
    assert.ok(guards.every(guard => guard.visible && guard.getObjectByName("TaserBaton").visible));
    montage.update(1.5, true); await montage.finished;
    assert.equal(SURVEY_SHOTS.reduce((sum, shot) => sum + shot.duration, 0), 16);
    montage.dispose();
    assert.deepEqual(player.position, position); assert.equal(shovel.visible, true);
    assert.equal(sourceDisposed, false, "Shared source geometry remains usable");
    assert.equal(removed, true); assert.equal(events.size, 0);
    montage.dispose();
    montage = createSurveyMontage({ player, alienModels: models, reducedMotion: true });
    const cameraPosition = montage.camera.position.clone();
    montage.update(2, false);
    let skipped = false; montage.finished.then(() => { skipped = true; });
    events.get("keydown")({ code: "Enter" }); await Promise.resolve();
    assert.equal(skipped, false, "Paused or covered montage cannot be skipped accidentally");
    montage.update(2, true);
    assert.deepEqual(montage.camera.position, cameraPosition, "Reduced motion disables camera drift");
    events.get("keydown")({ code: "Enter" }); await montage.finished;
    assert.equal(skipped, true);
    montage.dispose();
  } finally {
    montage?.dispose();
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[name]; else globalThis[name] = value;
    }
  }
});
