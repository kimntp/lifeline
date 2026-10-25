import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { createHomeSpaceship } from "../src/home-spaceship.js";

const settle = () => new Promise(resolve => setImmediate(resolve));

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
    },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
    dispatch(type) { for (const callback of listeners.get(type) ?? []) callback(); },
    listenerCount: () => [...listeners.values()].reduce((count, entries) => count + entries.size, 0),
  };
}

function fixture({ reduced = false, loadShip } = {}) {
  const frames = new Map(), renderers = [];
  let identifier = 0, time = 0, disconnected = 0;
  const motion = Object.assign(eventTarget(), { matches: reduced });
  const view = Object.assign(eventTarget(), {
    innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 3,
    matchMedia: () => motion,
    requestAnimationFrame(callback) { frames.set(++identifier, callback); return identifier; },
    cancelAnimationFrame(frame) { frames.delete(frame); },
    ResizeObserver: class { observe() {} disconnect() { disconnected++; } },
  });
  const page = Object.assign(eventTarget(), { defaultView: view, hidden: false });
  const children = new Set();
  const host = { ownerDocument: page, appendChild: child => children.add(child) };
  const menuBounds = { left: 1430, top: 40, right: 1880, bottom: 400 };
  const menu = { getBoundingClientRect: () => ({ ...menuBounds }) };
  const model = new THREE.Group();
  model.userData.radiusRatio = 0.74;
  const geometry = new THREE.BufferGeometry();
  const material = new THREE.MeshStandardMaterial();
  let geometryDisposals = 0;
  geometry.addEventListener("dispose", () => { geometryDisposals++; });
  model.add(new THREE.Mesh(geometry, material));
  const spaceship = createHomeSpaceship(host, menu, {
    loadShip: loadShip ?? (async () => model),
    createRenderer(options) {
      const renderer = {
        options, draws: 0, disposed: false, contextLost: false,
        domElement: { setAttribute() {}, remove() { children.delete(this); } },
        capabilities: { getMaxAnisotropy: () => 8 },
        setClearColor(color, alpha) { this.clearAlpha = alpha; },
        setPixelRatio(ratio) { this.pixelRatio = ratio; },
        setSize(width, height) { this.width = width; this.height = height; },
        render() { this.draws++; },
        dispose() { this.disposed = true; },
        forceContextLoss() { this.contextLost = true; },
      };
      renderers.push(renderer);
      return renderer;
    },
  });
  return {
    spaceship, model, frames, view, page, motion, children, renderers, menuBounds,
    get disconnected() { return disconnected; }, get geometryDisposals() { return geometryDisposals; },
    advance(milliseconds) {
      time += milliseconds;
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) callback(time);
    },
  };
}

test("ship renderer is transparent, pauses without jumping, and releases all home resources", async () => {
  const harness = fixture();
  const { spaceship, model, frames, page, view, motion, children, renderers } = harness;
  spaceship.setActive(true);
  await settle();
  const renderer = renderers[0];
  assert.equal(renderer.options.alpha, true);
  assert.equal(renderer.clearAlpha, 0);
  assert.equal(renderer.domElement.tabIndex, -1);
  assert.ok(renderer.width * renderer.height * renderer.pixelRatio ** 2 <= 2000001);
  assert.equal(frames.size, 1);
  harness.advance(0);
  harness.advance(100);
  const position = model.position.clone();
  page.hidden = true;
  page.dispatch("visibilitychange");
  const draws = renderer.draws;
  harness.advance(15000);
  assert.equal(renderer.draws, draws);
  assert.equal(frames.size, 0);
  page.hidden = false;
  page.dispatch("visibilitychange");
  harness.advance(100);
  assert.ok(model.position.distanceTo(position) < 0.0001);
  harness.menuBounds.bottom = 360;
  view.dispatch("resize");
  assert.ok(model.position.distanceTo(position) < 0.0001);
  spaceship.setActive(false);
  assert.equal(frames.size, 0);
  assert.equal(children.size, 0);
  assert.equal(view.listenerCount(), 0);
  assert.equal(page.listenerCount(), 0);
  assert.equal(motion.listenerCount(), 0);
  assert.equal(harness.disconnected, 1);
  assert.equal(harness.geometryDisposals, 1);
  assert.equal(renderer.disposed, true);
  assert.equal(renderer.contextLost, true);
});

test("reduced motion keeps a stationary ship and changes preferences live", async () => {
  const harness = fixture({ reduced: true });
  harness.spaceship.setActive(true);
  await settle();
  assert.equal(harness.frames.size, 0);
  const position = harness.model.position.clone();
  harness.advance(10000);
  assert.deepEqual(harness.model.position, position);
  harness.motion.matches = false;
  harness.motion.dispatch("change");
  assert.equal(harness.frames.size, 1);
  harness.motion.matches = true;
  harness.motion.dispatch("change");
  assert.equal(harness.frames.size, 0);
  harness.spaceship.setActive(false);
});

test("leaving home during FBX loading disposes the late result without adding an overlay", async () => {
  let finishLoading;
  const harness = fixture({ loadShip: () => new Promise(resolve => { finishLoading = resolve; }) });
  harness.spaceship.setActive(true);
  harness.spaceship.setActive(false);
  finishLoading(harness.model);
  await settle();
  assert.equal(harness.children.size, 0);
  assert.equal(harness.frames.size, 0);
  assert.equal(harness.geometryDisposals, 1);
});

test("asset failure releases the decorative renderer without breaking the menu", async testing => {
  testing.mock.method(console, "warn", () => {});
  const harness = fixture({ loadShip: async () => { throw new Error("Asset unavailable"); } });
  assert.doesNotThrow(() => harness.spaceship.setActive(true));
  await settle();
  assert.equal(harness.children.size, 0);
  assert.equal(harness.frames.size, 0);
  assert.equal(harness.view.listenerCount(), 0);
  assert.equal(harness.renderers[0].disposed, true);
});

test("flight elapsed time is consistent at 30 and 60 browser frames per second", async testing => {
  testing.mock.method(Math, "random", () => 0.5);
  const slow = fixture(), fast = fixture();
  slow.spaceship.setActive(true);
  fast.spaceship.setActive(true);
  await settle();
  slow.advance(0);
  fast.advance(0);
  for (let step = 0; step < 60; step++) slow.advance(1000 / 30);
  for (let step = 0; step < 120; step++) fast.advance(1000 / 60);
  slow.advance(100);
  fast.advance(100);
  assert.ok(slow.model.position.distanceTo(fast.model.position) < 0.0001);
  slow.spaceship.setActive(false);
  fast.spaceship.setActive(false);
});
