import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { readFileSync } from "node:fs";
import { createApolloNarrator } from "../src/apollo-narrator.js";
import { APOLLO_DIALOGUE } from "../src/apollo-dialogue.mjs";
import { createDialogueSession } from "../src/dialogue-session.js";
import { createColonyInteraction } from "../src/colony-interaction.js";
import { createSpeechChallenge } from "../src/speech-verification.mjs";

function fixture() {
  const channel = createDialogueSession(), calls = [], captions = [];
  let options;
  const dubbing = { busy: false, start(entry, speaker) { this.busy = true; calls.push({ entry, speaker }); },
    setPaused(value) { this.paused = value; }, destroy() { this.busy = false; },
    finish() { this.busy = false; options.onChange({ status: "finished" }); } };
  const narrator = createApolloNarrator({ channel, dubbingFactory: config => { options = config; return dubbing; },
    captions: (audio, data) => { captions.push({ audio, data }); return () => {}; },
  });
  return { narrator, channel, calls, dubbing, captions, get options() { return options; } };
}

test("intro is generated once and precedes queued announcements with one Apollo speaker", () => {
  const f = fixture();
  f.narrator.say("Mission update");
  f.narrator.setPaused(false); f.narrator.update();
  assert.equal(f.calls.length, 0);
  f.narrator.startIntro(); f.narrator.startIntro(); f.narrator.update();
  assert.equal(f.calls[0].entry.text, APOLLO_DIALOGUE.intro);
  assert.equal(f.calls[0].speaker, "Apollo");
  assert.equal(f.channel.begin({}), false);
  f.dubbing.finish(); f.narrator.update();
  assert.deepEqual(f.calls.map(call => call.entry.text), [APOLLO_DIALOGUE.intro, "Mission update"]);
  assert.ok(f.calls.every(call => call.speaker === "Apollo"));
  f.narrator.destroy();
});

test("Apollo waits for an alien conversation, preserves pause, and deduplicates repeated updates", () => {
  const f = fixture(), alien = {};
  f.channel.begin(alien);
  f.narrator.startIntro(); f.narrator.setPaused(false); f.narrator.update();
  assert.equal(f.calls.length, 0);
  f.channel.end(alien);
  f.narrator.setPaused(true); f.narrator.update();
  assert.equal(f.calls.length, 0);
  f.narrator.setPaused(false); f.narrator.update();
  f.narrator.say("Sample sealed"); f.narrator.say("Sample sealed");
  f.dubbing.finish(); f.narrator.update();
  f.dubbing.finish(); f.narrator.say("Sample sealed"); f.narrator.update();
  assert.equal(f.calls.length, 2);
  f.options.onAudio({}, { text: "Same voice captions" });
  assert.deepEqual(f.captions[0].data, { speaker: "Apollo", text: "Same voice captions" });
  f.narrator.destroy(); assert.equal(f.channel.busy, false);
});

test("the runtime no longer loads the prerecorded intro or its caption JSON", () => {
  const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Apollo(?:%20| )Intro\.mp3|apollo-intro\.captions\.json|new Audio/);
  assert.match(source, /apolloNarrator\?\.startIntro/);
});

test("correct speech goes directly to the farmer without any Apollo verification audio", async () => {
  const oldDocument = globalThis.document, nodes = new Map();
  const node = key => { if (!nodes.has(key)) nodes.set(key, { hidden: true, textContent: "", setAttribute() {} }); return nodes.get(key); };
  globalThis.document = { createElement: () => ({ querySelector: node, remove() {} }), body: { appendChild() {} } };
  const calls = [], messages = [];
  let callbacks, voiceConfig, interaction;
  const dub = { busy: false, stop() { this.busy = false; }, destroy() {}, setPaused() {},
    start(entry, speaker) { this.busy = true; calls.push({ entry, speaker }); },
    finish() { this.busy = false; voiceConfig.onChange({ status: "finished" }); },
  };
  try {
    const worker = { phase: "tend", talking: false, visual: new THREE.Group(), profile: { name: "Iri", role: "Farmer" } };
    interaction = createColonyInteraction({ site: { x: 0, z: 0 }, workers: [worker], plots: [] }, {
      channel: createDialogueSession(), onApolloMessage: text => messages.push(text),
      dubbingFactory: config => { voiceConfig = config; return dub; },
      speechFactory: options => createSpeechChallenge({ ...options, connect: async cb => { callbacks = cb; return { close() {} }; } }),
    });
    const player = { position: new THREE.Vector3(0, 0, 1) };
    const step = key => interaction.update(player, { consumeJustPressed: code => code === key });
    step("KeyE");
    const expected = node("#colony-dialogue-text").textContent;
    step("KeyV"); await new Promise(done => setImmediate(done));
    callbacks.onCommit("Wrong sentence");
    assert.equal(calls.length, 0, "incorrect attempts only show a retry message");
    assert.equal(node("#colony-dialogue-text").textContent, expected);
    assert.match(node("#speech-feedback").textContent, /Incorrect/);
    step("KeyV"); await new Promise(done => setImmediate(done));
    callbacks.onCommit(expected);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].speaker, "Iri");
    assert.match(calls[0].entry.text, /regenerate the soil/);
    assert.equal(node("#speech-verification").hidden, true);
    const current = node("#colony-dialogue-text").textContent;
    step("KeyE"); assert.equal(node("#colony-dialogue-text").textContent, current);
    dub.finish(); step("KeyE");
    dub.finish(); step("KeyE");
    assert.equal(calls.at(-1).speaker, "Apollo");
    assert.match(calls.at(-1).entry.text, /Alien-reported/);
    assert.ok(messages.length > 0, "mission assistant messages are sent to the shared narrator");
  } finally { interaction?.destroy(); globalThis.document = oldDocument; }
});
