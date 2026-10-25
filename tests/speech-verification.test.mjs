import { silentDubbingFactory } from "./helpers/verified-speech.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { compareDialogue, normalizeSpeech, createSpeechChallenge, speechWordFeedback } from "../src/speech-verification.mjs";
import { createColonyInteraction } from "../src/colony-interaction.js";
import { GardenMission } from "../src/garden-mission.js";
import { createDialogueSession } from "../src/dialogue-session.js";

test("matching ignores case and punctuation and expands explicit contractions", () => {
  assert.equal(compareDialogue("How do you make enough water for your crops here?", "HOW do you make enough water for your crops here.").match, true);
  assert.equal(compareDialogue("I will not force them.", "I'll not force them").match, true);
  assert.equal(normalizeSpeech("We\u2019re here. Don't worry!"), "we are here do not worry");
  assert.equal(compareDialogue("Do not force them", "Do force them").match, false);
  assert.deepEqual(compareDialogue("Do not force them", "Do force them").missing, ["not"]);
  assert.equal(compareDialogue("Enough water", "water enough").match, false);
  assert.equal(compareDialogue("Enough water", "Enough water please").match, false);
  assert.equal(compareDialogue("", "").match, false);
});

function fixture() {
  let callbacks, closed = 0;
  const challenge = createSpeechChallenge({ connect: async options => {
    callbacks = options;
    return { close() { closed++; } };
  } });
  challenge.reset("How do you make enough water?");
  return { challenge, get callbacks() { return callbacks; }, get closed() { return closed; } };
}

test("only committed complete words pass; wrong attempts must retry the entire line", async () => {
  const f = fixture();
  await f.challenge.start();
  f.callbacks.onReady();
  f.callbacks.onPartial("How do you make enough water?");
  assert.equal(f.challenge.state.status, "listening");
  f.callbacks.onCommit("How do you make water?");
  assert.equal(f.challenge.state.status, "retry");
  assert.deepEqual(f.challenge.state.missing, ["enough"]);
  assert.equal(f.closed, 1);
  await f.challenge.start();
  f.callbacks.onCommit("How do you");
  assert.equal(f.challenge.state.status, "listening");
  f.callbacks.onCommit("make enough water?");
  assert.equal(f.challenge.state.status, "verified");
  assert.equal(f.challenge.state.message, "");
  f.challenge.destroy();
});

test("pause/cancel and changing dialogue invalidate delayed transcripts", async () => {
  const f = fixture();
  await f.challenge.start();
  const stale = f.callbacks;
  f.challenge.cancel();
  assert.equal(f.challenge.state.status, "idle");
  assert.equal(stale.signal.aborted, true);
  stale.onCommit("How do you make enough water?");
  assert.equal(f.challenge.state.status, "idle");
  await f.challenge.start();
  const old = f.callbacks;
  f.challenge.reset("New question?");
  old.onCommit("How do you make enough water?");
  assert.equal(f.challenge.state.expected, "New question?");
  assert.equal(f.challenge.state.status, "idle");
  f.challenge.destroy();
});

test("cancelling during connection setup closes a connection that arrives late", async () => {
  let resolve, closed = 0;
  const challenge = createSpeechChallenge({ connect: () => new Promise(done => { resolve = done; }) });
  challenge.reset("Hello");
  const starting = challenge.start();
  challenge.cancel();
  resolve({ close() { closed++; } });
  await starting;
  assert.equal(closed, 1);
  assert.equal(challenge.state.status, "idle");
  challenge.destroy();
});

test("microphone failure reports a service error instead of an incorrect answer", async () => {
  const challenge = createSpeechChallenge({ connect: async () => { const error = new Error(); error.name = "NotAllowedError"; throw error; } });
  challenge.reset("Hello");
  await challenge.start();
  assert.equal(challenge.state.status, "error");
  assert.match(challenge.state.message, /denied/);
  assert.deepEqual(challenge.state.missing, []);
  challenge.destroy();
});

test("inactivity timeout stops capture and allows another attempt", async () => {
  let closed = false;
  const challenge = createSpeechChallenge({ timeoutMs: 10, connect: async () => ({ close() { closed = true; } }) });
  challenge.reset("Hello");
  await challenge.start();
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(challenge.state.status, "error");
  assert.equal(closed, true);
  challenge.destroy();
});

test("E cannot skip speech; only a verified attempt unlocks the alien reply and mission effects", async () => {
  const originalDocument = globalThis.document;
  const elements = new Map();
  const node = selector => {
    if (!elements.has(selector)) elements.set(selector, { hidden: true, textContent: "", setAttribute() {} });
    return elements.get(selector);
  };
  const root = { querySelector: node, remove() {} };
  globalThis.document = { createElement: () => root, body: { appendChild() {} } };
  let interaction;
  try {
    const channel = createDialogueSession(), mission = new GardenMission();
    const worker = { phase: "tend", talking: false, visual: new THREE.Group(), profile: { name: "Iri", role: "Soilkeeper" } };
    const colony = { site: { x: 0, z: 0 }, workers: [worker], plots: [] };
    let callbacks;
    interaction = createColonyInteraction(colony, { channel, mission, dubbingFactory: silentDubbingFactory,
      speechFactory: options => createSpeechChallenge({ ...options, connect: async cb => {
        callbacks = cb; return { close() {} };
      } }),
    });
    const player = { position: new THREE.Vector3(0, 0, 1) };
    const press = key => interaction.update(player, { consumeJustPressed: code => code === key });
    interaction.setVisible(true);
    press("KeyE");
    const expected = node("#colony-dialogue-text").textContent;
    assert.match(expected, /How are you able/);
    press("KeyE");
    assert.equal(node("#colony-dialogue-text").textContent, expected);
    press("KeyV"); await new Promise(resolve => setImmediate(resolve));
    callbacks.onCommit("I want tomatoes.");
    press("KeyE");
    assert.equal(node("#colony-dialogue-text").textContent, expected);
    assert.equal(mission.explained, false);
    assert.match(node("#speech-feedback").textContent, /Incorrect/);
    assert.equal(channel.begin({}), false);
    press("KeyV"); await new Promise(resolve => setImmediate(resolve));
    callbacks.onCommit(expected);
    assert.match(node("#colony-dialogue-text").textContent, /regenerate the soil/);
    assert.equal(node("#speech-verification").hidden, true);
    assert.doesNotMatch(node("#speech-feedback").textContent, /Correct|Translation sent|Press E/);
    press("KeyE");
    assert.equal(mission.explained, true);
    // Leaving and re-entering starts a fresh challenge; pause cancels the mic.
    player.position.x = 10; press(null);
    player.position.x = 0; press("KeyE");
    press("KeyV"); await new Promise(resolve => setImmediate(resolve));
    const stale = callbacks;
    interaction.setVisible(false);
    stale.onCommit(node("#colony-dialogue-text").textContent);
    assert.equal(stale.signal.aborted, true);
    assert.equal(mission.waterKnown, false);
  } finally { interaction?.destroy(); globalThis.document = originalDocument; }
});


test("live word feedback aligns repeated words and only completes entire contractions", () => {
  assert.deepEqual(speechWordFeedback("Do you do research?", "Do you").map(word => word.status),
    ["correct", "correct", "pending", "pending"]);
  assert.deepEqual(speechWordFeedback("I'm ready.", "I").map(word => word.status), ["pending", "pending"]);
  assert.deepEqual(speechWordFeedback("I'm ready.", "I am ready").map(word => word.status), ["correct", "correct"]);
  assert.deepEqual(speechWordFeedback("Do not force them", "Do force them", true).map(word => word.status),
    ["correct", "missed", "correct", "correct"]);
});

test("partial revisions remove outdated highlights and retries clear all highlights", async () => {
  const f = fixture();
  await f.challenge.start();
  f.callbacks.onReady();
  f.callbacks.onPartial("How do you");
  assert.equal(speechWordFeedback(f.challenge.state.expected, f.challenge.state.transcript).filter(word => word.status === "correct").length, 3);
  f.callbacks.onPartial("How could you");
  assert.equal(speechWordFeedback(f.challenge.state.expected, f.challenge.state.transcript)[1].status, "pending");
  assert.notEqual(f.challenge.state.status, "verified");
  f.challenge.cancel();
  assert.ok(speechWordFeedback(f.challenge.state.expected, f.challenge.state.transcript).every(word => word.status === "pending"));
  f.challenge.destroy();
});

test("word display renders expected text safely without inserting transcript markup", async () => {
  const { renderSpeechWords } = await import("../src/speech-word-display.mjs");
  const element = { innerHTML: "" };
  renderSpeechWords(element, { expected: "<hello> world", transcript: "hello <script>", status: "listening" });
  assert.match(element.innerHTML, /speech-word-correct/);
  assert.match(element.innerHTML, /&lt;hello&gt;/);
  assert.doesNotMatch(element.innerHTML, /<script>|<hello>/);
});
