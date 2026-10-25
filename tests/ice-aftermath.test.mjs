import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as THREE from "three";
import { createIceAftermath, ALIEN_PAIN_LINE, DIRECT_ALIEN_DIALOGUE } from "../src/ice-aftermath.js";
import { createAftermathActors } from "../src/aftermath-actors.js";
import { createDialogueSession } from "../src/dialogue-session.js";
import { createAlienLoader, prepareAlienModel, createAlienFarmer } from "../src/alien-farmers.js";

function asset(name) {
  const bytes = fs.readFileSync(new URL(`../public/assets/${name}.fbx`, import.meta.url));
  return createAlienLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
}

test("four guards march in, knock the astronaut down, and Apollo glitches into an unfiltered alien conversation", async () => {
  const names = ["document", "window", "speechSynthesis", "SpeechSynthesisUtterance"];
  const previous = Object.fromEntries(names.map(key => [key, globalThis[key]]));
  const listeners = new Map(), elements = new Map(), classes = new Set(), spoken = [];
  let removed = false, paused = 0, cancelled = 0, directContacts = 0;
  const root = { hidden: false, setAttribute() {}, remove() { removed = true; }, querySelector(selector) {
    if (!elements.has(selector)) elements.set(selector, { textContent: "", addEventListener() {} });
    return elements.get(selector);
  } };
  globalThis.document = { createElement: () => root, body: { appendChild() {}, classList: {
    toggle(name, on) { if (on) classes.add(name); else classes.delete(name); }, remove: name => classes.delete(name),
  } } };
  globalThis.window = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  globalThis.speechSynthesis = { speak: voice => spoken.push(voice.text), pause() { paused++; }, cancel() { cancelled++; } };
  const source = asset("Astronauta");
  source.scale.multiplyScalar(1.8 / new THREE.Box3().setFromObject(source, true).getSize(new THREE.Vector3()).y);
  source.position.set(-20, 5, -20); source.visible = false;
  const visual = createAlienFarmer(prepareAlienModel(asset("Alien_Low_Gray")), "gray");
  visual.position.set(3, 0.3, 2); visual.rotation.z = -0.8;
  const originalPosition = visual.position.clone(), originalRotation = visual.quaternion.clone();
  const world = new THREE.Scene(); world.add(visual, source);
  const channel = createDialogueSession(), camera = new THREE.PerspectiveCamera();
  let cutscene, routingActors;
  try {
    cutscene = createIceAftermath({ alien: { visual }, player: source, scene: world, camera, ground: { heightAt: () => 0 }, channel, onDirectContact: () => directContacts++ });
    assert.equal(channel.busy, true); assert.equal(cutscene.phase, "pain");
    let finished = false; cutscene.finished.then(() => { finished = true; });
    const pressE = () => listeners.get("keydown")({ code: "KeyE" });
    cutscene.update(0.1, true); cutscene.update(0.1, true);
    assert.deepEqual(spoken, [ALIEN_PAIN_LINE]);
    pressE(); await Promise.resolve(); assert.equal(finished, false, "E cannot skip the guard sequence");
    cutscene.update(2, false); assert.equal(paused, 1); assert.equal(cutscene.phase, "pain");
    cutscene.update(3, true); assert.equal(cutscene.phase, "march");
    assert.equal(cutscene.actors.guards.length, 4);
    const starts = cutscene.actors.guards.map(guard => guard.visual.position.clone());
    cutscene.update(2, true);
    for (const [i, guard] of cutscene.actors.guards.entries()) {
      assert.equal(guard.visual.userData.suitColor, "black"); assert.equal(guard.baton.visible, true);
      assert.ok(guard.visual.position.distanceTo(starts[i]) > 1, "Each guard marches into the scene");
    }
    cutscene.update(3, true); assert.equal(cutscene.phase, "strike");
    cutscene.update(1.2, true); assert.equal(cutscene.actors.astronaut.visual.userData.knockedDown, true);
    cutscene.update(1, true); assert.equal(cutscene.phase, "down");
    cutscene.actors.astronaut.visual.updateMatrixWorld(true);
    assert.ok(new THREE.Box3().setFromObject(cutscene.actors.astronaut.visual, true).getSize(new THREE.Vector3()).y < 1.2,
      "The native fall clip leaves the white astronaut on the ground");
    cutscene.update(1.7, true); assert.equal(cutscene.phase, "glitch");
    assert.equal(classes.has("apollo-glitch"), true);
    cutscene.update(5, false); assert.equal(cutscene.phase, "glitch"); assert.equal(classes.has("apollo-glitch"), false);
    cutscene.update(3, true); assert.equal(cutscene.phase, "dialogue");
    assert.equal(directContacts, 1);
    assert.equal(classes.has("apollo-glitch"), false);
    assert.match(elements.get("#aftermath-link").textContent, /DIRECT ALIEN CHANNEL/);
    assert.ok(DIRECT_ALIEN_DIALOGUE.some(entry => /Earth/.test(entry.text) && /forced to work/.test(entry.text)));
    for (let i = 0; i < DIRECT_ALIEN_DIALOGUE.length; i++) { cutscene.update(0.4, true); pressE(); }
    await cutscene.finished; assert.equal(finished, true); assert.equal(directContacts, 1);
    cutscene.dispose(); cutscene.dispose();
    assert.equal(channel.busy, false); assert.equal(removed, true); assert.equal(classes.size, 0);
    assert.ok(cancelled > 0); assert.equal(listeners.size, 0);
    assert.deepEqual(visual.position, originalPosition); assert.ok(visual.quaternion.equals(originalRotation));
    assert.equal(world.getObjectByName("IceAftermathActors"), undefined);
    assert.deepEqual(source.position.toArray(), [-20, 5, -20]); assert.equal(source.visible, false);
    const obstacle = new THREE.Box3(new THREE.Vector3(1, -1, 6), new THREE.Vector3(5, 4, 8));
    routingActors = createAftermathActors({ scene: world, player: source, alienPosition: originalPosition,
      ground: { heightAt: () => 0 }, obstacles: [obstacle], viewDirection: new THREE.Vector3(0, 0, 1) });
    for (let i = 0; i <= 10; i++) {
      routingActors.update("march", i / 2, i / 2);
      for (const guard of routingActors.guards) {
        const p = guard.visual.position;
        assert.ok(!(p.x > obstacle.min.x - 0.28 && p.x < obstacle.max.x + 0.28
          && p.z > obstacle.min.z - 0.28 && p.z < obstacle.max.z + 0.28), "Marching guards go around ice obstacles");
      }
    }
    routingActors.dispose();
  } finally {
    routingActors?.dispose(); cutscene?.dispose();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});
