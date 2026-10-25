import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createIceAftermath, ALIEN_PAIN_LINE } from "../src/ice-aftermath.js";
import { createDialogueSession } from "../src/dialogue-session.js";

test("alien close-up owns dialogue, speaks once, pauses, and restores its injured pose", async () => {
  const previous = Object.fromEntries(["document", "window", "speechSynthesis", "SpeechSynthesisUtterance"].map(key => [key, globalThis[key]]));
  const listeners = new Map();
  let spoken = 0, removed = false, paused = 0, cancelled = 0, click;
  const root = { hidden: false, setAttribute() {}, remove() { removed = true; },
    querySelector: () => ({ addEventListener(_event, fn) { click = fn; } }) };
  globalThis.document = { createElement: () => root, body: { appendChild() {} } };
  globalThis.window = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  globalThis.speechSynthesis = { speak(voice) { spoken++; assert.equal(voice.text, ALIEN_PAIN_LINE); },
    pause() { paused++; }, cancel() { cancelled++; } };
  const visual = new THREE.Group(); visual.position.set(3, 0.3, 2); visual.rotation.z = -0.8;
  const channel = createDialogueSession(), camera = new THREE.PerspectiveCamera();
  let scene;
  try {
    scene = createIceAftermath({ alien: { visual }, camera, ground: { heightAt: () => 0 }, channel });
    assert.equal(channel.busy, true);
    assert.ok(camera.position.y > 1);
    let finished = false; scene.finished.then(() => { finished = true; });
    listeners.get("keydown")({ code: "KeyE" });
    await Promise.resolve(); assert.equal(finished, false, "Sample keypress cannot instantly skip the scene");
    scene.update(0.1, true); scene.update(0.1, true);
    assert.equal(spoken, 1);
    scene.update(2, false); click();
    await Promise.resolve(); assert.equal(finished, false, "Pause freezes reading time and dismissal");
    assert.equal(paused, 1);
    scene.update(1, true); click(); await scene.finished;
    scene.dispose();
    assert.equal(channel.busy, false); assert.equal(removed, true);
    assert.equal(cancelled, 1); assert.equal(listeners.size, 0);
    assert.equal(visual.rotation.z, -0.8); assert.equal(visual.position.y, 0.3);
  } finally {
    if (channel.busy) scene?.dispose();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});
