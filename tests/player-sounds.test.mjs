import test from "node:test";
import assert from "node:assert/strict";
import { createPlayerSounds } from "../src/player-sounds.js";
function fixture(options = {}) {
  const clips = []; let notify, removed = false;
  const sounds = createPlayerSounds({ audioFactory: () => {
    const audio = { paused: true, currentTime: 0, plays: 0,
      play() { this.paused = false; this.plays++; return Promise.resolve(); },
      pause() { this.paused = true; }, removeAttribute() {}, load() {} };
    clips.push(audio); return audio;
  }, subscribe(listener) { notify = listener; listener({ paused: false, muted: false }); return () => { removed = true; }; }, ...options });
  let x = 0;
  const step = (distance = 0, state = {}) => { x += distance; sounds.update({ active: true, grounded: true, position: { x, z: 0 }, delta: 0.1, ...state }); };
  return { clips, sounds, step, notify: state => notify(state), get removed() { return removed; } };
}
const settle = () => new Promise(done => setImmediate(done));

test("footsteps track grounded movement, switch between walk/run, and stop at walls or in the air", async () => {
  const f = fixture(), [walk, run] = f.clips;
  f.step(); f.step(0.5); await settle();
  assert.equal(walk.paused, false); assert.equal(run.paused, true);
  assert.equal(walk.src, "/assets/Walking.mp3"); assert.ok(walk.loop && run.loop);
  f.step(0.5); await settle(); assert.equal(walk.plays, 1);
  f.step(1, { sprinting: true }); await settle();
  assert.equal(walk.paused, true); assert.equal(run.paused, false);
  f.step(); assert.equal(run.paused, true);
  f.step(0.5, { grounded: false }); assert.ok(walk.paused && run.paused);
  f.step(0.5, { swinging: true }); assert.ok(walk.paused && run.paused);
  f.step(100); assert.ok(walk.paused && run.paused, "Teleporting does not produce footsteps");
  f.sounds.destroy();
});

test("baton swings restart their one-shot clip, respect mute and pause, and stop during cutscenes", async () => {
  const f = fixture(), baton = f.clips[2];
  f.step(); f.sounds.swingBaton(); await settle();
  assert.equal(baton.loop, false); assert.equal(baton.paused, false);
  assert.equal(baton.src, "/assets/Baton%20Attack.mp3");
  baton.currentTime = 2; f.sounds.swingBaton(); await settle();
  assert.equal(baton.currentTime, 0); assert.equal(baton.plays, 2);
  f.notify({ paused: true, muted: true }); assert.ok(f.clips.every(audio => audio.paused && audio.muted));
  f.sounds.swingBaton(); assert.equal(baton.plays, 2);
  f.notify({ paused: false, muted: true });
  f.step(0.5); await settle(); assert.equal(f.clips[0].muted, true);
  f.step(0.5, { active: false }); assert.ok(f.clips.every(audio => audio.paused));
  f.sounds.swingBaton(); assert.equal(baton.plays, 2);
  f.sounds.destroy(); assert.equal(f.removed, true);
});

test("pending audio cannot restart after pause or cleanup", async () => {
  const f = fixture(); f.step(); f.step(0.5);
  f.notify({ paused: true, muted: false }); await settle();
  assert.ok(f.clips.every(audio => audio.paused));
  f.sounds.destroy(); f.step(0.5); await settle();
  assert.ok(f.clips.every(audio => audio.paused));
});


test("each baton swing plays at most 1.5 seconds and a new strike replaces its cutoff", async () => {
  const timers = new Map(); let next = 0;
  const f = fixture({ schedule(callback, milliseconds) { assert.equal(milliseconds, 1500); timers.set(++next, callback); return next; },
    cancel(id) { timers.delete(id); } });
  const baton = f.clips[2]; f.step();
  f.sounds.swingBaton(); await settle(); assert.equal(timers.size, 1);
  const first = [...timers.keys()][0];
  f.sounds.swingBaton(); await settle();
  assert.equal(timers.has(first), false); assert.equal(timers.size, 1);
  const cutoff = [...timers.values()][0]; timers.clear(); cutoff();
  assert.equal(baton.paused, true);
  f.sounds.swingBaton(); await settle();
  baton.currentTime = 1.5; f.step();
  assert.equal(baton.paused, true); assert.equal(timers.size, 0);
  f.sounds.destroy();
});
