import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createBaseRest } from "../src/base-rest.js";
import { createDialogueSession } from "../src/dialogue-session.js";

test("acknowledge samples before gradually returning to base, becoming drowsy, and sleeping", async () => {
  const before = globalThis.document, elements = new Map(); let removed = false, finishAcknowledgment;
  const root = { hidden: true, remove() { removed = true; }, querySelector(selector) {
    if (!elements.has(selector)) elements.set(selector, { style: {}, textContent: "" }); return elements.get(selector);
  } };
  globalThis.document = { createElement: () => root, body: { appendChild() {} } };
  const channel = createDialogueSession(), acknowledgmentOwner = {};
  const player = new THREE.Group(); player.position.set(0, 0, 6);
  const camera = new THREE.PerspectiveCamera(); camera.position.set(0, 2, 12);
  const obstacle = new THREE.Box3(new THREE.Vector3(-.5, -1, 3), new THREE.Vector3(.5, 3, 4));
  let rest, disposedDialogue = false, animations = 0;
  try {
    rest = createBaseRest({ player, camera, target: new THREE.Vector3(0, 0, 1), obstacles: [obstacle],
      heightAt: () => 0, animator: { update() { animations++; }, mixer: { update() {} } },
      channel, dialogueFactory(options) {
        assert.match(options.lines[0].text, /benefit society/); assert.equal(options.lines[0].voiceSpeaker, "Apollo");
        channel.begin(acknowledgmentOwner);
        return { finished: new Promise(resolve => { finishAcknowledgment = () => { channel.end(acknowledgmentOwner); resolve(); }; }),
          update() {}, setVisible() {}, dispose() { disposedDialogue = true; } };
      } });
    rest.update(10, true); assert.equal(rest.phase, "acknowledgment"); assert.equal(player.position.z, 6);
    finishAcknowledgment(); await Promise.resolve();
    assert.equal(disposedDialogue, true); assert.equal(rest.phase, "drowsy"); assert.equal(channel.begin({}), false);
    rest.update(5, false); assert.equal(player.position.z, 6);
    rest.update(.1, true); const earlyHaze = Number(elements.get(".rest-haze").style.opacity);
    for (let i = 0; i < 500 && rest.phase !== "sleep"; i++) {
      rest.update(.1, true);
      assert.equal(obstacle.containsPoint(player.position), false, "Returning to base avoids the sample station");
    }
    assert.equal(rest.phase, "sleep");
    assert.ok(player.position.distanceTo(new THREE.Vector3(0, 0, 1)) < .05);
    assert.ok(Number(elements.get(".rest-haze").style.opacity) > earlyHaze);
    assert.match(elements.get(".rest-thought").textContent, /base and sleep/);
    let done = false; rest.finished.then(() => { done = true; });
    rest.update(10, false); await Promise.resolve(); assert.equal(done, false);
    rest.update(3, true); await rest.finished;
    assert.equal(elements.get(".rest-blackout").style.opacity, "1"); assert.equal(channel.busy, false);
    assert.ok(animations > 0);
    rest.update(.1, false); assert.equal(root.hidden, false, "Sleep stays black under the transition into the nightmare");
    rest.dispose(); assert.equal(removed, true);
  } finally { rest?.dispose(); globalThis.document = before; }
});
