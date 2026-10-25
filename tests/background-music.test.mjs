import test from "node:test";
import assert from "node:assert/strict";
import { createBackgroundMusic, shouldUseUnsettlingMusic, OST_VOLUME } from "../src/background-music.js";

function fixture() {
  const clips = []; let notify, unsubscribed = false;
  const music = createBackgroundMusic({ audioFactory: () => {
    const clip = { paused: true, volume: 0, plays: 0, play() { this.paused = false; this.plays++; return Promise.resolve(); },
      pause() { this.paused = true; }, removeAttribute() {}, load() {} };
    clips.push(clip); return clip;
  }, subscribe(listener) { notify = listener; listener({ paused: false, muted: false }); return () => { unsubscribed = true; }; } });
  return { music, clips, notify: state => notify(state), get unsubscribed() { return unsubscribed; } };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
function advance(music, state, count = 8) { for (let i = 0; i < count; i++) music.update(0.25, { active: true, ...state }); }

test("OST uses unsettling music only for cutscenes or hostile aliens", () => {
  assert.equal(shouldUseUnsettlingMusic(), false);
  for (const alienPhase of ["neutral", "recognition", "lastDowned", "tasks", "complete"]) {
    assert.equal(shouldUseUnsettlingMusic({ alienPhase }), false);
  }
  assert.equal(shouldUseUnsettlingMusic({ alienPhase: "hostile" }), true);
  assert.equal(shouldUseUnsettlingMusic({ cutscene: true, alienPhase: "tasks" }), true);
});

test("normal OST loops quietly and crossfades to unsettling, then back without restarting tracks", async () => {
  const f = fixture(), [normal, unsettling] = f.clips;
  assert.equal(normal.src, "/assets/Normal%20Mix.mp3");
  assert.equal(unsettling.src, "/assets/Unsettling%20Mix.mp3");
  assert.ok(normal.loop && unsettling.loop);
  advance(f.music, {}); await settle();
  assert.equal(normal.volume, OST_VOLUME); assert.equal(normal.paused, false); assert.equal(unsettling.paused, true);
  f.music.update(0.25, { active: true, unsettling: true }); await settle();
  assert.ok(normal.volume > 0 && unsettling.volume > 0);
  advance(f.music, { unsettling: true }); await settle();
  assert.equal(normal.paused, true); assert.equal(unsettling.volume, OST_VOLUME);
  normal.currentTime = 14;
  advance(f.music, { dialogue: true }); await settle();
  assert.equal(normal.currentTime, 14); assert.equal(normal.volume, OST_VOLUME * 0.55);
  assert.equal(unsettling.paused, true);
  f.music.destroy();
});

test("pause and mute apply immediately; paused loads cannot start, menus stop music, cleanup unsubscribes", async () => {
  const f = fixture();
  f.music.update(0.25, { active: true });
  f.notify({ paused: true, muted: true }); await settle();
  assert.ok(f.clips.every(clip => clip.paused && clip.muted));
  f.notify({ paused: false, muted: false });
  f.music.update(0.25, { active: true }); await settle();
  assert.equal(f.clips[0].paused, false);
  f.music.update(0.25, { active: false });
  assert.ok(f.clips.every(clip => clip.paused));
  f.music.destroy(); assert.equal(f.unsubscribed, true);
  f.music.update(1, { active: true }); await settle();
  assert.ok(f.clips.every(clip => clip.paused));
});

test("blocked playback is caught and retried without requesting playback every frame", async () => {
  const f = fixture(); let attempts = 0;
  f.clips[0].play = () => { attempts++; return Promise.reject(new Error("Autoplay blocked")); };
  f.music.update(0.25, { active: true }); await settle();
  advance(f.music, {}, 4); await settle(); assert.equal(attempts, 1);
  advance(f.music, {}, 12); await settle(); assert.equal(attempts, 2);
  f.music.destroy();
});


test("home screen plays normal music while gameplay is paused, continues into play, and respects pause menus", async () => {
  const f = fixture(), [normal, unsettling] = f.clips;
  f.notify({ paused: true, muted: false });
  advance(f.music, { active: false, homeScreen: true, unsettling: true, dialogue: true }); await settle();
  assert.equal(normal.paused, false); assert.equal(normal.volume, OST_VOLUME);
  assert.equal(unsettling.paused, true);
  normal.currentTime = 12;
  f.notify({ paused: false, muted: false });
  f.music.update(0.1, { active: true }); await settle();
  assert.equal(normal.currentTime, 12); assert.equal(normal.plays, 1);
  f.notify({ paused: true, muted: true });
  assert.equal(normal.paused, true); assert.equal(normal.muted, true);
  f.music.update(0.1, { active: false }); await settle();
  assert.ok(f.clips.every(clip => clip.paused));
  f.music.destroy();
});
