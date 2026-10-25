import test from "node:test";
import assert from "node:assert/strict";
import { createNarrationController } from "../src/narration-audio.js";

class AudioStub extends EventTarget {
  paused = true;
  ended = false;
  seeking = false;
  readyState = 4;
  currentTime = 12;
  muted = false;
  playCount = 0;
  play() {
    this.playCount++;
    this.paused = false;
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  }
  pause() { this.paused = true; this.dispatchEvent(new Event("pause")); }
}

test("game pause stops active narration and repeated menu renders preserve its resume position", async () => {
  const controller = createNarrationController();
  const active = controller.register(new AudioStub());
  const unused = controller.register(new AudioStub());
  controller.setPaused(false);
  assert.equal(active.playCount, 0);
  await active.play();
  assert.equal(controller.isPlaying(), true);
  controller.setPaused(true);
  controller.setPaused(true);
  assert.equal(active.paused, true);
  assert.equal(controller.isPlaying(), false);
  controller.setPaused(false);
  controller.setPaused(false);
  assert.equal(active.paused, false);
  assert.equal(active.currentTime, 12);
  assert.equal(active.playCount, 2);
  assert.equal(unused.playCount, 0);
});

test("playback starting during pause is stopped and resumes only with gameplay", async () => {
  const controller = createNarrationController();
  const audio = controller.register(new AudioStub());
  await audio.play();
  assert.equal(audio.paused, true);
  controller.setPaused(false);
  assert.equal(audio.paused, false);
  assert.equal(audio.currentTime, 12);
});

test("mute applies to current and future audio without stopping its timeline", async () => {
  const controller = createNarrationController();
  controller.setPaused(false);
  const audio = controller.register(new AudioStub());
  await audio.play();
  controller.setMuted(true);
  assert.equal(audio.muted, true);
  assert.equal(audio.paused, false);
  assert.equal(controller.register(new AudioStub()).muted, true);
  controller.setPaused(true);
  controller.setPaused(false);
  assert.equal(audio.muted, true);
  controller.setMuted(false);
  assert.equal(audio.muted, false);
});

test("ended or manually paused narration does not restart on resume", async () => {
  const controller = createNarrationController();
  const audio = controller.register(new AudioStub());
  controller.setPaused(false);
  await audio.play();
  audio.pause();
  controller.setPaused(true);
  controller.setPaused(false);
  assert.equal(audio.playCount, 1);
  await audio.play();
  controller.setPaused(true);
  audio.ended = true;
  audio.dispatchEvent(new Event("ended"));
  controller.setPaused(false);
  assert.equal(audio.playCount, 2);
});
