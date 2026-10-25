import assert from "node:assert/strict";
import test from "node:test";
import { createHomeStarfield } from "../src/home-starfield.js";

function createEventTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
    },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
    dispatch(type, event = {}) {
      for (const callback of listeners.get(type) ?? []) callback({ type, ...event });
    },
    listenerCount() { return [...listeners.values()].reduce((count, entries) => count + entries.size, 0); },
  };
}

function createHarness({ reduced = false } = {}) {
  const activity = [];
  const frames = new Map();
  let frameId = 0;
  let timestamp = 0;
  const motion = Object.assign(createEventTarget(), { matches: reduced });
  const view = Object.assign(createEventTarget(), {
    innerWidth: 1200, innerHeight: 800, devicePixelRatio: 3,
    matchMedia: () => motion,
    requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame(identifier) { frames.delete(identifier); },
  });
  const context = {
    arcs: [], trails: [], totalTrails: 0, draws: 0, sparkles: 0,
    setTransform(...transform) { this.transform = transform; },
    clearRect() { this.arcs = []; this.trails = []; this.draws++; },
    drawImage() {},
    beginPath() {},
    closePath() { this.sparkles++; },
    arc(...arguments_) { this.arcs.push({ geometry: arguments_, opacity: this.globalAlpha }); },
    fill() {},
    createLinearGradient() { return { addColorStop() {} }; },
    moveTo(...position) { this.tail = position; },
    lineTo(...position) { this.head = position; },
    stroke() { this.totalTrails++; this.trails.push({ tail: this.tail, head: this.head }); },
  };
  const page = Object.assign(createEventTarget(), {
    hidden: false, defaultView: view,
    createElement: () => ({ getContext: () => ({
      createRadialGradient: () => ({ addColorStop() {} }), fillRect() {},
    }) }),
  });
  const canvas = { ownerDocument: page, getContext: () => context };
  return {
    starfield: createHomeStarfield(canvas, { onActivityChange: value => activity.push(value) }),
    canvas, context, view, page, motion, frames, activity,
    advance(milliseconds) {
      timestamp += milliseconds;
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) callback(timestamp);
    },
  };
}

test("starfield starts once, pauses in hidden tabs, and releases resources when leaving home", () => {
  const harness = createHarness();
  const { starfield, frames, canvas, context, view, page, motion } = harness;
  assert.equal(frames.size, 0);
  starfield.setActive(true);
  assert.equal(frames.size, 1);
  assert.equal(canvas.width, 1800);
  assert.equal(canvas.height, 1200);
  assert.deepEqual(context.transform, [1.5, 0, 0, 1.5, 0, 0]);
  const initialDraws = context.draws;
  starfield.setActive(true);
  assert.equal(context.draws, initialDraws);
  assert.equal(frames.size, 1);

  harness.advance(0);
  const positions = context.arcs.map(star => star.geometry.slice(0, 2));
  harness.advance(100);
  assert.notDeepEqual(context.arcs.map(star => star.geometry.slice(0, 2)), positions);
  page.hidden = true;
  page.dispatch("visibilitychange");
  assert.equal(frames.size, 0);
  assert.equal(harness.activity.at(-1), false);
  assert.equal(view.listeners.get("pointermove").size, 0);
  page.hidden = false;
  page.dispatch("visibilitychange");
  assert.equal(frames.size, 1);
  assert.equal(harness.activity.at(-1), true);

  starfield.setActive(false);
  assert.equal(frames.size, 0);
  assert.equal(view.listenerCount(), 0);
  assert.equal(page.listenerCount(), 0);
  assert.equal(motion.listenerCount(), 0);
  assert.equal(canvas.width, 0);
  assert.equal(canvas.height, 0);
  const stoppedDraws = context.draws;
  harness.advance(100);
  assert.equal(context.draws, stoppedDraws);
  starfield.setActive(true);
  assert.equal(frames.size, 1);
  assert.equal(canvas.width, 1800);
  starfield.setActive(false);
});

test("reduced motion renders static stars and responds to preference changes live", () => {
  const harness = createHarness({ reduced: true });
  const { starfield, frames, context, motion, view } = harness;
  starfield.setActive(true);
  assert.ok(context.arcs.length > 0);
  assert.equal(frames.size, 0);
  assert.equal(view.listeners.has("pointermove"), false);
  const staticDraws = context.draws;
  harness.advance(20000);
  assert.equal(context.draws, staticDraws);
  assert.equal(context.totalTrails, 0);
  assert.equal(context.sparkles, 0);
  motion.matches = false;
  motion.dispatch("change");
  assert.equal(frames.size, 1);
  assert.equal(view.listeners.get("pointermove").size, 1);
  motion.matches = true;
  motion.dispatch("change");
  assert.equal(frames.size, 0);
  assert.equal(view.listeners.get("pointermove").size, 0);
  starfield.setActive(false);
});

test("nearby stars brighten smoothly and fade after the pointer moves away", () => {
  const harness = createHarness();
  const { starfield, context, view } = harness;
  starfield.setActive(true);
  harness.advance(0);
  const initialStar = context.arcs[0];
  view.dispatch("pointermove", {
    clientX: initialStar.geometry[0], clientY: initialStar.geometry[1], pointerType: "mouse",
  });
  harness.advance(100);
  const highlightedStar = context.arcs[0];
  assert.ok(highlightedStar.geometry[2] > initialStar.geometry[2]);
  assert.ok(highlightedStar.opacity > initialStar.opacity);
  view.dispatch("pointerout", { relatedTarget: null });
  harness.advance(100);
  assert.ok(context.arcs[0].geometry[2] < highlightedStar.geometry[2]);
  assert.ok(context.arcs[0].geometry[2] > initialStar.geometry[2]);
  starfield.setActive(false);
});

test("star density and pixel resolution stay bounded as the viewport changes", () => {
  const { starfield, view, canvas, context } = createHarness({ reduced: true });
  starfield.setActive(true);
  view.innerWidth = 390;
  view.innerHeight = 844;
  view.dispatch("resize");
  assert.equal(canvas.width, 585);
  assert.equal(canvas.height, 1266);
  assert.equal(context.arcs.length, 59);
  view.innerWidth = 7680;
  view.innerHeight = 4320;
  view.dispatch("resize");
  assert.equal(context.arcs.length, 317);
  assert.ok(canvas.width * canvas.height < 4010000);
  assert.ok(context.arcs.some(star => star.geometry[2] >= 0.5 && star.geometry[2] <= 1));
  assert.ok(context.arcs.some(star => star.geometry[2] > 1 && star.geometry[2] <= 1.5));
  assert.ok(context.arcs.some(star => star.geometry[2] > 1.5 && star.geometry[2] <= 2.5));
  starfield.setActive(false);
});

test("shooting stars appear occasionally, travel diagonally, and disappear", () => {
  const harness = createHarness();
  const { starfield, context } = harness;
  starfield.setActive(true);
  harness.advance(0);
  for (let step = 0; step < 150 && context.totalTrails === 0; step++) harness.advance(100);
  assert.ok(context.totalTrails > 0);
  const trail = context.trails[0];
  assert.ok(trail.head[0] > trail.tail[0]);
  assert.ok(trail.head[1] > trail.tail[1]);
  for (let step = 0; step < 20; step++) harness.advance(100);
  assert.equal(context.trails.length, 0);
  starfield.setActive(false);
});

test("canvas failure leaves the home menu usable", () => {
  const starfield = createHomeStarfield({ getContext: () => null });
  assert.doesNotThrow(() => {
    starfield.setActive(true);
    starfield.setActive(false);
    starfield.setWarp(true);
  });
});

test("layers ease through different parallax depths and return to neutral; touch does not add parallax", testing => {
  testing.mock.method(Math, "random", () => 0.5);
  const harness = createHarness();
  const { starfield, context, view } = harness;
  starfield.setActive(true);
  harness.advance(0);
  const centerX = view.innerWidth / 2;
  view.dispatch("pointermove", { clientX: 1200, clientY: 400, pointerType: "mouse" });
  harness.advance(100);
  const offset = radius => context.arcs.find(star => star.geometry[2] === radius).geometry[0] - centerX;
  const distant = offset(0.75);
  assert.ok(distant > 0 && distant < 4);
  assert.ok(Math.abs(offset(1.25) / distant - 2.5) < 0.001);
  assert.ok(Math.abs(offset(2) / distant - 4.5) < 0.001);
  view.dispatch("pointerout", { relatedTarget: null });
  harness.advance(100);
  assert.ok(offset(0.75) < distant);
  starfield.setActive(false);

  starfield.setActive(true);
  harness.advance(0);
  view.dispatch("pointermove", { clientX: 1200, clientY: 400, pointerType: "touch" });
  harness.advance(100);
  assert.ok(Math.abs(offset(0.75)) < 0.001);
  starfield.setActive(false);
});

test("warp streaks accelerate outward and are disabled for reduced motion", () => {
  const harness = createHarness();
  const { starfield, context, view } = harness;
  starfield.setActive(true);
  harness.advance(0);
  starfield.setWarp(true);
  harness.advance(100);
  assert.ok(context.trails.length > 30);
  for (const trail of context.trails) {
    const headDistance = Math.hypot(trail.head[0] - view.innerWidth / 2, trail.head[1] - view.innerHeight / 2);
    const tailDistance = Math.hypot(trail.tail[0] - view.innerWidth / 2, trail.tail[1] - view.innerHeight / 2);
    assert.ok(headDistance > tailDistance);
  }
  starfield.setWarp(false);
  harness.advance(100);
  assert.equal(context.trails.length, 0);
  starfield.setActive(false);

  const staticHarness = createHarness({ reduced: true });
  staticHarness.starfield.setActive(true);
  staticHarness.starfield.setWarp(true);
  staticHarness.advance(1000);
  assert.equal(staticHarness.frames.size, 0);
  assert.equal(staticHarness.context.totalTrails, 0);
  staticHarness.starfield.setActive(false);
});
