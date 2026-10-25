import test from "node:test";
import assert from "node:assert/strict";
import { getMinimapState, projectMinimapPoint } from "../src/minimap-state.mjs";
import { GardenMission } from "../src/garden-mission.js";
import { LEVEL_LAYOUT } from "../src/level-layout.js";
import { createMinimap } from "../src/minimap.js";

const input = { player: LEVEL_LAYOUT.spawn, base: LEVEL_LAYOUT.base,
  colony1: LEVEL_LAYOUT.garden, colony2: LEVEL_LAYOUT.ice, yaw: Math.PI };

test("Colony 2 is absent until samples are deposited and Phase 2 starts", () => {
  const mission = new GardenMission();
  const state = () => getMinimapState({ ...input, phase2: mission.completed });
  assert.deepEqual(state().markers.map(marker => marker.id), ["base", "colony1"]);
  mission.learnGrowth(); mission.learnWater(LEVEL_LAYOUT.garden);
  for (const sample of ["soil", "tomato", "wheat"]) mission.collect(sample, "shovel");
  assert.equal(mission.readyToReport, true);
  assert.equal(state().markers.some(marker => marker.id === "colony2"), false);
  mission.beginDeposit();
  assert.equal(state().markers.some(marker => marker.id === "colony2"), false);
  mission.finishDeposit();
  assert.equal(state().markers.some(marker => marker.id === "colony2"), true);
  assert.equal(state().target.id, "colony2");
});

test("locked colony coordinates cannot leak into zoom, bounds, destination or distance", () => {
  const first = getMinimapState({ ...input, phase2: false });
  const changed = getMinimapState({ ...input, phase2: false, colony2: { x: 999999, z: -999999 } });
  assert.deepEqual(changed, first);
});

test("navigation targets Colony 1, returns to base for deposit, and keeps visible markers in the circle", () => {
  const state = getMinimapState(input);
  assert.equal(state.target.id, "colony1");
  assert.equal(state.distance, Math.hypot(input.colony1.x - input.player.x, input.colony1.z - input.player.z));
  assert.equal(getMinimapState({ ...input, returning: true }).target.id, "base");
  for (const phase2 of [false, true]) {
    const visible = getMinimapState({ ...input, phase2 });
    for (const point of [...visible.markers, visible.player]) {
      const projected = projectMinimapPoint(point, visible, 180);
      assert.ok(Math.hypot(projected.x - 90, projected.y - 90) < 90 - 20);
    }
  }
  assert.equal(getMinimapState({ ...input, player: null }), null);
});

test("the rendered minimap hides the Colony 2 marker before Phase 2", () => {
  const keys = ["document", "window", "getComputedStyle", "ResizeObserver"];
  const original = Object.fromEntries(keys.map(key => [key, globalThis[key]]));
  let disconnected = false, minimap;
  const drawn = [], attributes = {};
  const ctx = new Proxy({}, { get: (_target, key) => key === "createRadialGradient"
    ? () => ({ addColorStop() {} }) : key === "fillText" ? text => drawn.push(text) : () => {} });
  const canvas = { getContext: () => ctx, getBoundingClientRect: () => ({ width: 180 }), setAttribute: (key, value) => { attributes[key] = value; } };
  const label = {}, legend = {}, nodes = new Map([["#minimap-canvas", canvas], ["#minimap-target", label], ["#minimap-legend-colony2", legend]]);
  const root = { hidden: true, setAttribute() {}, querySelector: key => nodes.get(key), remove() {} };
  globalThis.document = { createElement: () => root, body: { appendChild() {} } };
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.getComputedStyle = () => ({ fontFamily: "sans-serif" });
  globalThis.ResizeObserver = class { constructor(fn) { this.fn = fn; } observe() { this.fn(); } disconnect() { disconnected = true; } };
  try {
    minimap = createMinimap();
    minimap.update(input);
    assert.equal(root.hidden, false);
    assert.equal(drawn.includes("2"), false);
    assert.doesNotMatch(attributes["aria-label"], /Colony 2/);
    assert.match(label.textContent, /Colony 1/);
    minimap.update({ ...input, phase2: true });
    assert.equal(drawn.includes("2"), true);
    assert.match(attributes["aria-label"], /Colony 2/);
    minimap.update(input, false);
    assert.equal(root.hidden, true);
  } finally { minimap?.destroy(); Object.assign(globalThis, original); }
  assert.equal(disconnected, true);
});
