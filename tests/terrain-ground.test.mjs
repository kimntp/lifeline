import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import * as THREE from "three";
import { TerrainGround, advanceGroundedActor, measureFootOffset } from "../src/terrain-ground.js";
import { createTerrainSurround } from "../src/terrain-surround.js";

// Decode the real GLB's positions, indices and node transforms without loading
// browser-only textures. Compare the height index to Three.js ray intersections.
function loadTerrainGeometry() {
  const bytes = fs.readFileSync(new URL("../public/assets/city.glb", import.meta.url));
  const jsonLength = bytes.readUInt32LE(12);
  const data = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  const binaryStart = 20 + jsonLength + 8;
  function attribute(id) {
    const accessor = data.accessors[id];
    const view = data.bufferViews[accessor.bufferView];
    const size = accessor.type === "VEC3" ? 3 : 1;
    const readers = { 5126: [4, "readFloatLE"], 5125: [4, "readUInt32LE"], 5123: [2, "readUInt16LE"], 5121: [1, "readUInt8"] };
    const [width, method] = readers[accessor.componentType];
    const values = [];
    for (let i = 0; i < accessor.count; i++) {
      for (let c = 0; c < size; c++) {
        const offset = binaryStart + (view.byteOffset || 0) + (accessor.byteOffset || 0)
          + i * (view.byteStride || width * size) + c * width;
        values.push(bytes[method](offset));
      }
    }
    return { values, size };
  }
  const nodes = data.nodes.map(node => {
    const group = new THREE.Group();
    if (node.matrix) new THREE.Matrix4().fromArray(node.matrix).decompose(group.position, group.quaternion, group.scale);
    else {
      group.position.fromArray(node.translation || [0, 0, 0]);
      group.quaternion.fromArray(node.rotation || [0, 0, 0, 1]);
      group.scale.fromArray(node.scale || [1, 1, 1]);
    }
    if (node.mesh !== undefined) {
      for (const primitive of data.meshes[node.mesh].primitives) {
        const geometry = new THREE.BufferGeometry();
        const position = attribute(primitive.attributes.POSITION);
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(position.values, 3));
        if (primitive.indices !== undefined) geometry.setIndex(attribute(primitive.indices).values);
        group.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })));
      }
    }
    return group;
  });
  data.nodes.forEach((node, i) => (node.children || []).forEach(child => nodes[i].add(nodes[child])));
  const root = new THREE.Group();
  for (const i of data.scenes[data.scene || 0].nodes) root.add(nodes[i]);
  root.scale.setScalar(100);
  root.position.y -= new THREE.Box3().setFromObject(root).min.y;
  root.updateMatrixWorld(true);
  return root;
}

const terrain = loadTerrainGeometry();
const ground = new TerrainGround(terrain);

test("real scaled terrain heights match downward raycasts across hills and seams", () => {
  const ray = new THREE.Raycaster();
  const heights = [];
  for (const x of [-90, -60, -25, 0, 25, 60, 90]) {
    for (const z of [-90, -25, 0, 25, 90]) {
      ray.set(new THREE.Vector3(x, ground.bounds.max.y + 10, z), new THREE.Vector3(0, -1, 0));
      const hits = ray.intersectObject(terrain, true);
      assert.ok(hits.length > 0, `Missing terrain at ${x}, ${z}`);
      const height = ground.heightAt(x, z);
      assert.ok(Math.abs(height - hits[0].point.y) < 1e-5, `${x}, ${z}`);
      heights.push(height);
    }
  }
  assert.ok(Math.max(...heights) - Math.min(...heights) > 5, "Actual terrain includes hills");
  assert.equal(ground.heightAt(1000, 1000), 0);
});

test("grounded actor feet follow uphill and downhill terrain without hovering", () => {
  const actor = new THREE.Group();
  const state = { grounded: true, velocity: new THREE.Vector3() };
  const footOffset = 0.42;
  for (let x = -80; x <= 80; x += 2) {
    actor.position.x = x;
    const y = ground.heightAt(x, 10);
    advanceGroundedActor(actor, state, footOffset, y, 1 / 60);
    assert.ok(Math.abs(actor.position.y - footOffset - y) < 1e-8);
    assert.equal(state.grounded, true);
    assert.equal(state.velocity.y, 0);
  }
});

test("jump rises above the hills and lands on the current terrain with foot offset", () => {
  const actor = new THREE.Group();
  const footOffset = 0.3;
  const state = { grounded: false, velocity: new THREE.Vector3(0, 11, 0) };
  actor.position.set(0, ground.heightAt(0, 0) + footOffset, 0);
  advanceGroundedActor(actor, state, footOffset, ground.heightAt(0, 0), 1 / 60);
  assert.equal(state.grounded, false);
  assert.ok(actor.position.y > ground.heightAt(0, 0) + footOffset);
  for (let frame = 0; frame < 180 && !state.grounded; frame++) {
    actor.position.x += 0.03;
    advanceGroundedActor(actor, state, footOffset, ground.heightAt(actor.position.x, 0), 1 / 60);
  }
  assert.equal(state.grounded, true);
  assert.ok(Math.abs(actor.position.y - footOffset - ground.heightAt(actor.position.x, 0)) < 1e-8);
});

test("height lookup honors transformed indexed geometry and cell boundaries", () => {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(10, 10, 2, 2));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(5, 7, -3);
  mesh.scale.setScalar(2);
  const sampler = new TerrainGround(mesh, 4);
  for (const x of [-5, 0, 5, 10, 15]) {
    for (const z of [-13, -8, -3, 2, 7]) assert.ok(Math.abs(sampler.heightAt(x, z) - 7) < 1e-6);
  }
});

test("scaled character feet are placed on terrain without applying scale twice", () => {
  for (const height of [1.7, 1.8]) {
    const actor = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1));
    body.position.y = 0.7;
    actor.add(body);
    actor.scale.setScalar(height / 2);
    actor.position.set(25, 20, -25);
    const footOffset = measureFootOffset(actor);
    const groundY = ground.heightAt(actor.position.x, actor.position.z);
    actor.position.y = groundY + footOffset;
    actor.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(actor, true);
    assert.ok(Math.abs(box.min.y - groundY) < 1e-8);
  }
});

test("terrain horizon matches the real model border and extends past the fog limit", () => {
  const surround = createTerrainSurround(terrain, ground);
  assert.equal(surround.children.length, 48);
  surround.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(surround);
  assert.ok(bounds.min.x < -650 && bounds.max.x > 650);
  assert.ok(bounds.min.z < -650 && bounds.max.z > 650);
  const position = surround.children[0].geometry.attributes.position;
  const sourceEdges = [];
  const actual = new THREE.Vector3();
  terrain.traverse(mesh => {
    if (!mesh.isMesh) return;
    const vertices = mesh.geometry.attributes.position;
    for (let i = 0; i < vertices.count; i++) {
      actual.fromBufferAttribute(vertices, i).applyMatrix4(mesh.matrixWorld);
      if (Math.abs(actual.x - ground.bounds.min.x) < 0.001 || Math.abs(actual.x - ground.bounds.max.x) < 0.001
        || Math.abs(actual.z - ground.bounds.min.z) < 0.001 || Math.abs(actual.z - ground.bounds.max.z) < 0.001) {
        sourceEdges.push(actual.clone());
      }
    }
  });
  const border = [];
  const key = p => `${p.x.toFixed(3)},${p.z.toFixed(3)}`;
  for (let i = 0; i < position.count; i++) {
    actual.fromBufferAttribute(position, i);
    if (Math.abs(actual.x - ground.bounds.min.x) < 0.001 || Math.abs(actual.x - ground.bounds.max.x) < 0.001
      || Math.abs(actual.z - ground.bounds.min.z) < 0.001 || Math.abs(actual.z - ground.bounds.max.z) < 0.001) {
      border.push(actual.clone());
    }
  }
  assert.ok(sourceEdges.length > 1000);
  for (const vertex of sourceEdges) {
    assert.ok(border.some(point => Math.abs(point.x - vertex.x) < 0.0002
      && Math.abs(point.z - vertex.z) < 0.0002 && Math.abs(point.y - vertex.y) < 0.002),
    `Crack at ${key(vertex)}`);
  }
  assert.ok(surround.children[0].geometry.index.count / 3 < 15000, "Distant tiles use reduced detail");
});
