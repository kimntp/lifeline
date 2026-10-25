import test from "node:test";
import assert from "node:assert/strict";
import { createWakingDialogue } from "../src/waking-dialogue.js";
import { WAKING_DIALOGUE } from "../src/survey-dialogue.mjs";
import { createDialogueSession } from "../src/dialogue-session.js";

test("the player silently reflects before Apollo redirects them, with pause, skip, and exclusive conversation ownership", async () => {
  const before = { document: globalThis.document, window: globalThis.window };
  const elements = new Map(), listeners = new Map(), spoken = [], pauses = [];
  let removed = false, busy = false, onChange, completed = 0, destroyed = false;
  const root = { hidden: true, setAttribute() {}, classList: { toggle() {} }, remove() { removed = true; },
    querySelector(selector) { if (!elements.has(selector)) elements.set(selector, { textContent: "", addEventListener() {} }); return elements.get(selector); } };
  globalThis.document = { createElement: () => root, body: { appendChild() {} } };
  globalThis.window = { addEventListener: (name, listener) => listeners.set(name, listener), removeEventListener: name => listeners.delete(name) };
  const channel = createDialogueSession(); let scene;
  try {
    scene = createWakingDialogue({ channel, dubbingFactory(options) {
      onChange = options.onChange;
      return { get busy() { return busy; }, setPaused(value) { pauses.push(value); },
        stop() { busy = false; }, destroy() { destroyed = true; },
        start(entry, voice) { spoken.push({ entry, voice }); busy = true; },
        complete() { completed++; busy = false; onChange({ status: "completed" }); },
      };
    } });
    const press = () => listeners.get("keydown")({ code: "Enter" });
    let finished = false; scene.finished.then(() => { finished = true; });
    press(); assert.equal(spoken.length, 0);
    scene.update(.1, true);
    assert.equal(scene.musicMood, "unsettling");
    assert.equal(channel.begin({}), false);
    assert.match(elements.get(".colony-eyebrow").textContent, /Inner thoughts/);
    assert.ok(elements.get(".waking-line").textContent.length < WAKING_DIALOGUE[0].text.length);
    assert.equal(spoken.length, 0, "Inner dialogue never requests a voice");
    scene.update(10, false); assert.equal(pauses.at(-1), true);
    press(); assert.equal(spoken.length, 0);
    scene.update(.1, true); press();
    assert.equal(elements.get(".waking-line").textContent, WAKING_DIALOGUE[0].text);
    press(); scene.update(.1, true);
    assert.equal(spoken.length, 1); assert.equal(spoken[0].voice, "Apollo");
    assert.equal(scene.musicMood, "normal");
    assert.match(spoken[0].entry.text, /Did you hear what I said/);
    assert.match(spoken[0].entry.text, /water collection methods/);
    assert.doesNotMatch(spoken[0].entry.text, /second|colony 2/i);
    press(); await Promise.resolve(); assert.equal(completed, 1); assert.equal(finished, false);
    assert.equal(elements.get(".waking-line").textContent, WAKING_DIALOGUE[1].text);
    press(); await scene.finished; assert.equal(finished, true); assert.equal(channel.busy, false);
    scene.dispose(); assert.ok(removed && destroyed); assert.equal(listeners.size, 0);
  } finally { scene?.dispose(); Object.assign(globalThis, before); }
});
