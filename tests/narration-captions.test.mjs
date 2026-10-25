import test from "node:test";
import assert from "node:assert/strict";
import { buildCaptionCues, captionAtTime, buildScriptCues, progressiveCaptionAtTime } from "../src/caption-timing.mjs";

const word = (text, start, end) => ({ type: "word", text, start, end });

test("groups speech into timed sentences and preserves silence", () => {
  const cues = buildCaptionCues([
    word("Hello", 1, 1.3), { type: "spacing", text: " " },
    word("Apollo!", 1.4, 2), word("Keep", 4, 4.3), word("moving.", 4.4, 5),
    word("invalid", NaN, 6),
  ]);
  assert.deepEqual(cues, [
    { start: 1, end: 2, text: "Hello Apollo!" },
    { start: 4, end: 5, text: "Keep moving." },
  ]);
  assert.equal(captionAtTime(cues, 0), "");
  assert.equal(captionAtTime(cues, 1.5), "Hello Apollo!");
  assert.equal(captionAtTime(cues, 3), "");
  assert.equal(captionAtTime(cues, 4.5), "Keep moving.");
  assert.equal(captionAtTime(cues, 1.1), "Hello Apollo!");
  assert.equal(captionAtTime(cues, 5), "");
});

test("splits long speech into readable captions", () => {
  const cues = buildCaptionCues(Array.from({ length: 24 }, (_, i) => word("narration", i * 0.4, i * 0.4 + 0.3)));
  assert.ok(cues.length > 1);
  assert.ok(cues.every(c => c.text.length <= 72 && c.end - c.start <= 5));
});

test("caption display follows playback, seeking, pauses, and ending", async () => {
  const original = Object.fromEntries(["document", "fetch", "requestAnimationFrame", "cancelAnimationFrame"].map(k => [k, globalThis[k]]));
  try {
    let box;
    const elements = new Map();
    globalThis.document = {
      getElementById: (id) => elements.get(id),
      createElement: () => ({
        hidden: true, textContent: "", setAttribute() {},
        append(...children) { children.forEach(child => elements.set(child.id, child)); },
      }),
      body: { appendChild(element) { box = element; elements.set(element.id, element); } },
    };
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ cues: [
      { start: 1, end: 2, text: "Hello Apollo!" },
      { start: 4, end: 5, text: "Keep moving." },
    ] }) });
    globalThis.requestAnimationFrame = () => 1;
    globalThis.cancelAnimationFrame = () => {};
    const { attachNarrationCaptions } = await import("../src/narration-captions.js");
    const audio = Object.assign(new EventTarget(), { paused: true, ended: false, currentTime: 0 });
    attachNarrationCaptions(audio, "/captions.json");
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(box.hidden, true);
    audio.currentTime = 1.5;
    audio.paused = false;
    audio.dispatchEvent(new Event("playing"));
    assert.equal(elements.get("narration-line").textContent, "Hello Apollo!");
    assert.equal(box.hidden, false);
    assert.equal(elements.get("narration-speaker").textContent, "Apollo");
    audio.paused = true;
    audio.dispatchEvent(new Event("pause"));
    assert.equal(elements.get("narration-line").textContent, "Hello Apollo!");
    audio.currentTime = 4.5;
    audio.dispatchEvent(new Event("seeked"));
    assert.equal(elements.get("narration-line").textContent, "Keep moving.");
    audio.ended = true;
    audio.dispatchEvent(new Event("ended"));
    assert.equal(box.hidden, true);

    // Supplied scripts work without an API and can load before duration metadata.
    globalThis.fetch = async () => ({ ok: true, json: async () => ({
      speaker: "Farmer", text: "One two three four five six seven eight nine ten.",
    }) });
    const scripted = Object.assign(new EventTarget(), {
      paused: false, ended: false, currentTime: 0, duration: NaN,
    });
    attachNarrationCaptions(scripted, "/script.json");
    await new Promise(resolve => setImmediate(resolve));
    scripted.duration = 10;
    scripted.dispatchEvent(new Event("loadedmetadata"));
    scripted.dispatchEvent(new Event("playing"));
    assert.equal(elements.get("narration-speaker").textContent, "Farmer");
    assert.equal(elements.get("narration-line").textContent, "One");
    scripted.currentTime = 3;
    scripted.dispatchEvent(new Event("timeupdate"));
    assert.equal(elements.get("narration-line").textContent, "One two three four");
  } finally {
    Object.assign(globalThis, original);
  }
});


test("script pages cover the duration and progressively reveal the supplied text", () => {
  const text = "Greetings, explorer. I'm Apollo, your personal AI research assistant.";
  const cues = buildScriptCues(text, 12);
  assert.equal(cues[0].start, 0);
  assert.equal(cues.at(-1).end, 12);
  assert.equal(cues.map(c => c.text).join(" "), text);
  assert.equal(progressiveCaptionAtTime(cues, 0), "Greetings,");
  assert.equal(progressiveCaptionAtTime(cues, 12), "");
  assert.deepEqual(buildScriptCues(text, NaN), []);
  const last = cues.at(-1);
  assert.equal(progressiveCaptionAtTime(cues, last.start + (last.end - last.start) * 0.9), last.text);
});
