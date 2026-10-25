import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { colonyInterferenceStrength, createColonyInterference } from "../src/colony-interference.js";

const state = { completed: true, active: true,
  colonyBounds: new THREE.Box3(new THREE.Vector3(-10, 0, -10), new THREE.Vector3(10, 20, 10)),
  baseBounds: new THREE.Box3(new THREE.Vector3(-60, 0, -10), new THREE.Vector3(-45, 10, 10)) };

test("interference only activates after reporting and gets stronger approaching Colony 1", () => {
  const strengths = [50, 32, 24, 16, 10, 0].map(x => colonyInterferenceStrength({ ...state, position: { x, z: 0 } }));
  assert.equal(strengths[0], 0);
  for (let i = 1; i < strengths.length; i++) assert.ok(strengths[i] >= strengths[i - 1]);
  assert.equal(strengths.at(-1), 1);
  assert.equal(colonyInterferenceStrength({ ...state, completed: false, position: { x: 0, z: 0 } }), 0);
  assert.equal(colonyInterferenceStrength({ ...state, active: false, position: { x: 0, z: 0 } }), 0);
  assert.equal(colonyInterferenceStrength({ ...state, position: null }), 0);
});

test("base remains clear even when it is near the finished colony", () => {
  const nearbyBase = new THREE.Box3(new THREE.Vector3(15, 0, -5), new THREE.Vector3(25, 10, 5));
  assert.equal(colonyInterferenceStrength({ ...state, baseBounds: nearbyBase, position: { x: 16, z: 0 } }), 0);
  assert.ok(colonyInterferenceStrength({ ...state, baseBounds: nearbyBase, position: { x: 12, z: 0 } }) > 0);
});

test("blur and grain clear immediately in menus or fades, including tiny effects", () => {
  const original = globalThis.document;
  const grain = { hidden: true, style: {}, setAttribute() {} };
  globalThis.document = { createElement: () => grain, body: { appendChild() {} } };
  try {
    const canvas = { style: {} };
    const effect = createColonyInterference(canvas);
    effect.update({ ...state, position: { x: 0, z: 0 } });
    assert.match(canvas.style.filter, /blur\(6.00px\)/);
    assert.equal(grain.hidden, false);
    effect.update({ ...state, position: { x: 0, z: 0 }, active: false });
    assert.equal(canvas.style.filter, "");
    assert.equal(grain.hidden, true);
    effect.update({ ...state, position: { x: 33.9, z: 0 } });
    effect.update({ ...state, position: { x: 33.9, z: 0 }, active: false });
    assert.equal(canvas.style.filter, "");
    assert.equal(grain.hidden, true);
  } finally { globalThis.document = original; }
});
