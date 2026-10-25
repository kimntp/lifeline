import test from "node:test";
import assert from "node:assert/strict";
import { buildCaptionCues, captionAtTime, buildScriptCues, progressiveCaptionAtTime, buildAlignedCaptionCues, groupCaptionPages } from "../src/caption-timing.mjs";

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
    scripted.duration = 20;
    scripted.dispatchEvent(new Event("durationchange"));
    assert.equal(elements.get("narration-line").textContent, "One two three four", "metadata changes cannot restart revealed words");
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


test("inline generated captions clean up without erasing a newer Apollo message", async () => {
  const originals = Object.fromEntries(["document", "fetch", "requestAnimationFrame", "cancelAnimationFrame"].map(key => [key, globalThis[key]]));
  const elements = new Map();
  try {
    globalThis.document = {
      getElementById: id => elements.get(id),
      createElement: () => ({ textContent: "", hidden: true, setAttribute() {}, append(...children) { children.forEach(child => elements.set(child.id, child)); } }),
      body: { appendChild(element) { elements.set(element.id, element); } },
    };
    globalThis.fetch = () => { throw new Error("generated captions must not fetch the old intro JSON"); };
    globalThis.requestAnimationFrame = () => 1; globalThis.cancelAnimationFrame = () => {};
    const { attachNarrationCaptions } = await import("../src/narration-captions.js");
    const audio = () => Object.assign(new EventTarget(), { paused: false, ended: false, currentTime: 0, duration: 10 });
    const first = audio(), second = audio();
    const detachFirst = attachNarrationCaptions(first, { speaker: "Apollo", text: "First message." });
    await new Promise(done => setImmediate(done)); first.dispatchEvent(new Event("playing"));
    assert.equal(elements.get("narration-line").textContent, "First");
    const detachSecond = attachNarrationCaptions(second, { speaker: "Apollo", text: "Second message." });
    await new Promise(done => setImmediate(done)); second.dispatchEvent(new Event("playing"));
    detachFirst();
    assert.equal(elements.get("narration-captions").hidden, false);
    assert.equal(elements.get("narration-line").textContent, "Second");
    detachSecond();
    assert.equal(elements.get("narration-captions").hidden, true);
    const complete = attachNarrationCaptions(null, { speaker: "Apollo", text: "Reveal this entire message immediately." });
    complete.complete();
    await new Promise(done => setImmediate(done));
    assert.equal(elements.get("narration-line").textContent, "Reveal this entire message immediately.");
    assert.equal(elements.get("narration-captions").hidden, false);
    complete();
  } finally { Object.assign(globalThis, originals); }
});


test("provider word times keep a sentence together through pauses and do not jump on estimated boundaries", () => {
  const text = "Hello Mars. We thrive.";
  const characters = [...text];
  const starts = characters.map((_, index) => index < 12 ? index * 0.1 : 10 + (index - 12) * 0.1);
  const cues = buildAlignedCaptionCues({ characters, characterStartTimesSeconds: starts, characterEndTimesSeconds: starts.map(time => time + 0.09) });
  assert.equal(cues.length, 1);
  assert.equal(cues[0].text, "Hello Mars. We thrive.");
  assert.equal(progressiveCaptionAtTime(cues, 0.4), "Hello");
  assert.equal(progressiveCaptionAtTime(cues, 8), "Hello Mars.");
  assert.equal(progressiveCaptionAtTime(cues, 10), "Hello Mars. We");
  const long = "This is a long single sentence that must not clear the dialogue box halfway through while Apollo is still speaking the same thought and explaining the mission.";
  assert.equal(buildScriptCues(long, 30).length, 1);
});


test("caption pages fill with several whole sentences without changing word timing", () => {
  const sentences = Array.from({ length: 8 }, (_, index) => ({
    text: `Sentence ${index} explains the mission and keeps the conversation visible.`,
    start: index * 5, end: (index + 1) * 5,
    words: [{ text: `Sentence ${index}`, start: index * 5, end: index * 5 + 1 }],
  }));
  const pages = groupCaptionPages(sentences);
  assert.ok(pages.length < sentences.length);
  assert.ok(pages.length > 1);
  assert.ok(pages.every(page => page.text.length <= 320));
  assert.equal(pages.map(page => page.text).join(" "), sentences.map(sentence => sentence.text).join(" "));
  assert.deepEqual(pages.flatMap(page => page.words), sentences.flatMap(sentence => sentence.words));
  assert.equal(sentences[0].text.startsWith("Sentence 0 explains"), true);
});


test("embedded dialogue reveals timed words, preserves its box, and Enter completion stops subsequent updates", async () => {
  const before = { requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: globalThis.cancelAnimationFrame };
  globalThis.requestAnimationFrame = () => 1; globalThis.cancelAnimationFrame = () => {};
  try {
    const { attachDialogueText } = await import("../src/narration-captions.js");
    const target = { box: { hidden: false }, speaker: { textContent: "" }, line: { textContent: "" } };
    const audio = Object.assign(new EventTarget(), { currentTime: 0, duration: 3, paused: false, ended: false });
    const detach = attachDialogueText(audio, { speaker: "Alien", text: "Help our people.", cues: [
      { start: 0, end: 3, text: "Help our people.", words: [
        { text: "Help", start: 0, end: .5 }, { text: "our", start: 1, end: 1.5 }, { text: "people.", start: 2, end: 2.5 },
      ] },
    ] }, target);
    await Promise.resolve();
    audio.dispatchEvent(new Event("playing")); assert.equal(target.line.textContent, "Help");
    audio.currentTime = 1.1; audio.dispatchEvent(new Event("timeupdate")); assert.equal(target.line.textContent, "Help our");
    audio.paused = true; audio.dispatchEvent(new Event("pause")); assert.equal(target.line.textContent, "Help our");
    detach.complete(); assert.equal(target.line.textContent, "Help our people.");
    audio.currentTime = 0; audio.dispatchEvent(new Event("timeupdate")); assert.equal(target.line.textContent, "Help our people.");
    detach(); assert.equal(target.box.hidden, false);
    const pending = attachDialogueText(null, { speaker: "Apollo", text: "Loading can be skipped." }, target);
    pending.complete(); assert.equal(target.line.textContent, "Loading can be skipped.");
    await Promise.resolve(); assert.equal(target.line.textContent, "Loading can be skipped.");
    pending();
  } finally { Object.assign(globalThis, before); }
});
