import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createDialogueSession } from "../src/dialogue-session.js";
import { createNarrationController } from "../src/narration-audio.js";
import { createColonyInteraction } from "../src/colony-interaction.js";

class AudioStub extends EventTarget {
  paused = true;
  ended = false;
  readyState = 4;
  play() { this.paused = false; this.dispatchEvent(new Event("play")); return Promise.resolve(); }
  pause() { this.paused = true; this.dispatchEvent(new Event("pause")); }
}

test("narration reserves the channel before loading and blocks all other audio or chat", async () => {
  const channel = createDialogueSession();
  const controller = createNarrationController(channel);
  controller.setPaused(false);
  let finish;
  const audio = controller.register(new AudioStub());
  audio.play = () => new Promise(resolve => { finish = resolve; });
  const pending = controller.play(audio);
  assert.equal(channel.busy, true);
  assert.equal(channel.begin({}), false);
  assert.equal(await controller.play(controller.register(new AudioStub())), false);
  finish();
  await pending;
  audio.dispatchEvent(new Event("error"));
  assert.equal(channel.busy, false);
});

test("muting, buffering, and game pause retain the narration channel until it ends", async () => {
  const channel = createDialogueSession();
  const controller = createNarrationController(channel);
  controller.setPaused(false);
  const audio = controller.register(new AudioStub());
  await controller.play(audio);
  controller.setMuted(true);
  audio.dispatchEvent(new Event("waiting"));
  controller.setPaused(true);
  assert.equal(channel.begin({}), false);
  controller.setPaused(false);
  assert.equal(channel.begin({}), false);
  audio.ended = true;
  audio.dispatchEvent(new Event("ended"));
  assert.equal(channel.busy, false);
});

test("failed playback releases the channel", async () => {
  const channel = createDialogueSession();
  const controller = createNarrationController(channel);
  controller.setPaused(false);
  const audio = controller.register(new AudioStub());
  audio.play = async () => { throw new Error("Unavailable"); };
  await assert.rejects(controller.play(audio), /Unavailable/);
  assert.equal(channel.busy, false);
});

test("alien interaction cannot interrupt narration, and retains ownership while advancing lines", () => {
  const original = globalThis.document;
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { hidden: true, textContent: "" });
    return nodes.get(id);
  };
  globalThis.document = {
    createElement: () => ({ querySelector: node, remove() {} }),
    body: { appendChild() {} },
  };
  try {
    const channel = createDialogueSession();
    const narrator = {};
    channel.begin(narrator);
    const worker = {
      phase: "idle", talking: false,
      visual: { visible: true, position: new THREE.Vector3(), rotation: { y: 0 } },
      profile: { name: "Iri", role: "Soilkeeper", lines: ["Welcome.", "Our garden."] },
    };
    const interaction = createColonyInteraction({ site: { x: 0, z: 0 }, workers: [worker] }, channel);
    const player = { position: new THREE.Vector3(0, 0, 1) };
    const press = { consumeJustPressed: () => true };
    interaction.update(player, press);
    assert.equal(worker.talking, false);
    assert.equal(node("#colony-talk-prompt").hidden, true);
    channel.end(narrator);
    interaction.update(player, press);
    assert.equal(worker.talking, true);
    assert.equal(node("#colony-dialogue-text").textContent, "Welcome.");
    assert.equal(channel.begin(narrator), false);
    interaction.update(player, press);
    assert.equal(node("#colony-dialogue-text").textContent, "Our garden.");
    interaction.update(player, press);
    assert.equal(worker.talking, false);
    assert.equal(channel.busy, false);
    interaction.update(player, press);
    player.position.x = 10;
    interaction.update(player, { consumeJustPressed: () => false });
    assert.equal(channel.busy, false);
    player.position.x = 0;
    interaction.update(player, press);
    interaction.destroy();
    assert.equal(channel.busy, false);
  } finally { globalThis.document = original; }
});
