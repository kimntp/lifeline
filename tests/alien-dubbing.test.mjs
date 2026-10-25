import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createAlienDubbing } from "../src/alien-dubbing.js";
import { createNarrationController } from "../src/narration-audio.js";
import { createDialogueSession } from "../src/dialogue-session.js";
import { createColonyInteraction } from "../src/colony-interaction.js";
import { verifiedSpeechFactory } from "./helpers/verified-speech.mjs";

class AudioStub extends EventTarget {
  paused = true; ended = false; readyState = 4; currentTime = 7; playCount = 0;
  play() { this.paused = false; this.playCount++; this.dispatchEvent(new Event("play")); return Promise.resolve(); }
  pause() { this.paused = true; this.dispatchEvent(new Event("pause")); }
  removeAttribute() {} load() {}
}
const reply = { text: "Welcome to the garden." };
const response = () => ({ ok: true, blob: async () => new Blob(["simulated audio"]) });
function fixture(overrides = {}) {
  const channel = createDialogueSession(), owner = {}, controller = createNarrationController(channel);
  channel.begin(owner); controller.setPaused(false);
  const clips = [], changes = [], revoked = [];
  const dub = createAlienDubbing({ owner, site: { x: 0, z: 0 }, request: async () => response(),
    audioFactory: () => { const audio = new AudioStub(); clips.push(audio); return audio; },
    register: controller.register, play: controller.play, unregister: controller.unregister,
    makeUrl: () => "blob:test", revokeUrl: url => revoked.push(url), onChange: state => changes.push(state), ...overrides,
  });
  dub.setPaused(false);
  return { dub, channel, owner, controller, clips, changes, revoked };
}

test("farmer dubbing owns the existing conversation, respects mute, and does not animate Apollo", async () => {
  const f = fixture();
  f.controller.setMuted(true);
  await f.dub.start(reply, "Iri");
  assert.equal(f.dub.busy, true);
  assert.equal(f.clips[0].paused, false);
  assert.equal(f.clips[0].muted, true);
  assert.equal(f.controller.isPlaying(), false);
  assert.equal(f.channel.begin({}), false);
  f.clips[0].ended = true;
  f.clips[0].dispatchEvent(new Event("ended"));
  assert.equal(f.dub.busy, false);
  assert.equal(f.channel.begin({}), false, "conversation still owns the channel after the clip ends");
  assert.deepEqual(f.revoked, ["blob:test"]);
  f.dub.destroy();
});

test("paused reply resumes from the same position and stopping prevents stale resumption", async () => {
  const f = fixture();
  await f.dub.start(reply, "Vela");
  f.dub.setPaused(true); f.controller.setPaused(true);
  assert.equal(f.clips[0].paused, true);
  f.controller.setPaused(false); f.dub.setPaused(false);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.clips[0].paused, false);
  assert.equal(f.clips[0].currentTime, 7);
  f.controller.setPaused(true);
  f.dub.stop();
  const plays = f.clips[0].playCount;
  f.controller.setPaused(false);
  assert.equal(f.clips[0].playCount, plays);
});

test("a clip that loads while paused waits for resume; leaving cancels late replies", async () => {
  let resolve;
  const f = fixture({ request: () => new Promise(done => { resolve = done; }) });
  const starting = f.dub.start(reply, "Naru");
  f.dub.setPaused(true); f.controller.setPaused(true);
  resolve(response()); await starting;
  assert.equal(f.clips[0].playCount, 0);
  assert.equal(f.dub.busy, true);
  f.controller.setPaused(false); f.dub.setPaused(false);
  await new Promise(done => setImmediate(done));
  assert.equal(f.clips[0].playCount, 1);
  f.dub.stop();
  const again = f.dub.start(reply, "Naru");
  f.dub.stop(); resolve(response()); await again;
  assert.equal(f.clips.length, 1);
});

test("voice service and playback errors unlock text fallback", async () => {
  const f = fixture({ request: async () => ({ ok: false }) });
  await f.dub.start(reply, "Iri");
  assert.equal(f.dub.busy, false);
  assert.equal(f.changes.at(-1).status, "error");
  f.dub.destroy();
  const g = fixture();
  await g.dub.start(reply, "Iri");
  g.clips[0].dispatchEvent(new Event("error"));
  assert.equal(g.dub.busy, false);
  assert.equal(g.changes.at(-1).status, "error");
  g.dub.destroy();
});

test("E cannot interrupt dubbed replies; ending and walking away clean up playback", () => {
  const original = globalThis.document, elements = new Map();
  const node = key => {
    if (!elements.has(key)) elements.set(key, { hidden: true, textContent: "", setAttribute() {} });
    return elements.get(key);
  };
  globalThis.document = { createElement: () => ({ querySelector: node, remove() {} }), body: { appendChild() {} } };
  let interaction, dubbing;
  try {
    const channel = createDialogueSession();
    const worker = { visual: new THREE.Group(), phase: "tend", talking: false, profile: { name: "Iri", role: "Farmer" } };
    interaction = createColonyInteraction({ site: { x: 0, z: 0 }, workers: [worker], plots: [] }, {
      channel, speechFactory: verifiedSpeechFactory, dubbingFactory: () => (dubbing = {
        busy: false, stop() { this.busy = false; }, destroy() {}, setPaused() {}, start() { this.busy = true; },
      }),
    });
    const player = { position: new THREE.Vector3(0, 0, 1) };
    const step = key => interaction.update(player, { consumeJustPressed: code => code === key });
    step("KeyE"); step("KeyE");
    const first = node("#colony-dialogue-text").textContent;
    assert.match(first, /regenerate the soil/);
    step("KeyE");
    assert.equal(node("#colony-dialogue-text").textContent, first);
    assert.equal(channel.begin({}), false);
    dubbing.busy = false;
    step("KeyE");
    assert.notEqual(node("#colony-dialogue-text").textContent, first);
    player.position.x = 10; step(null);
    assert.equal(dubbing.busy, false);
    assert.equal(channel.busy, false);
  } finally { interaction?.destroy(); globalThis.document = original; }
});
