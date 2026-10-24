import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { ASTRONAUT_CLIPS, AstronautAnimator } from "../src/astronaut-animations.js";

// Inspect the real rig in Node; image decoding is unrelated to animation binding.
globalThis.window = { URL: globalThis.URL };
const originalLoad = THREE.TextureLoader.prototype.load;
THREE.TextureLoader.prototype.load = () => new THREE.Texture();
const bytes = fs.readFileSync(new URL("../public/assets/Astronauta.fbx", import.meta.url));
const player = new FBXLoader().parse(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "",
);
const reference = new FBXLoader().parse(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "",
);
THREE.TextureLoader.prototype.load = originalLoad;
const animator = new AstronautAnimator(player);
const state = { isMoving: false, isSprinting: false, isGrounded: true, hit: false };

test("catalog contains every embedded clip exactly once", () => {
  assert.equal(player.animations.length, 16);
  assert.deepEqual([...ASTRONAUT_CLIPS].sort(), player.animations.map(c => c.name).sort());
  assert.equal(Object.keys(animator.actions).length, 16);
});

test("all suit skeletons are bound and every clip evaluates without binding warnings", () => {
  const warnings = [];
  const warn = console.warn;
  const error = console.error;
  console.warn = console.error = (...args) => warnings.push(args.join(" "));
  try {
    for (const name of ASTRONAUT_CLIPS) {
      const clip = animator.actions[name].getClip();
      const targets = new Set(clip.tracks.map(t => THREE.PropertyBinding.parseTrackName(t.name).nodeName));
      player.traverse(node => {
        if (!node.isSkinnedMesh) return;
        for (const bone of node.skeleton.bones) {
          let animatedBone = bone;
          while (animatedBone.parent?.isBone && animatedBone.ID === animatedBone.parent.ID) {
            animatedBone = animatedBone.parent;
          }
          assert.ok(targets.has(animatedBone.uuid), `${name}: ${bone.name}`);
          if (animatedBone !== bone) assert.ok(!targets.has(bone.uuid));
        }
      });
      animator.setPreview(name);
      animator.mixer.update(0.25);
      player.updateMatrixWorld(true);
      assert.equal(animator.current.getClip().name, name);
      for (const binding of animator.mixer._bindings) {
        assert.ok(binding.binding.targetObject, binding.binding.path);
      }
      player.traverse(node => {
        assert.ok([...node.position, ...node.quaternion, ...node.scale].every(Number.isFinite));
        if (node.isBone && node.parent?.isBone && node.ID === node.parent.ID) {
          assert.deepEqual(node.position.toArray(), [0, 0, 0], `${name}: copied bone position`);
          assert.deepEqual(node.quaternion.toArray(), [0, 0, 0, 1], `${name}: copied bone rotation`);
          assert.deepEqual(node.scale.toArray(), [1, 1, 1], `${name}: copied bone scale`);
          for (let i = 0; i < 16; i++) {
            assert.ok(Math.abs(node.matrixWorld.elements[i] - node.parent.matrixWorld.elements[i]) < 1e-8,
              `${name}: copied bone must inherit the parent transform exactly`);
          }
        }
      });
    }
  } finally {
    console.warn = warn;
    console.error = error;
    animator.setPreview("");
  }
  assert.deepEqual(warnings, []);
});

test("native locomotion transitions, repeats, and preserves player transform", () => {
  player.position.set(4, 2, -3);
  const scale = player.scale.clone();
  for (const [movement, name] of [
    [{}, "Idle"],
    [{ isMoving: true }, "Walk"],
    [{ isMoving: true, isSprinting: true }, "Running"],
    [{ isMoving: true, isGrounded: false }, "Idle"],
    [{ isMoving: true }, "Walk"],
    [{}, "Idle"],
  ]) {
    animator.update({ ...state, ...movement });
    animator.mixer.update(2);
    assert.equal(animator.current.getClip().name, `Armação|${name}`);
    assert.equal(animator.current.loop, THREE.LoopRepeat);
    assert.ok(animator.current.isRunning());
    assert.deepEqual(player.position.toArray(), [4, 2, -3]);
    assert.deepEqual(player.scale.toArray(), scale.toArray());
  }
});

test("mining swing finishes, returns to locomotion, and can restart", () => {
  for (let i = 0; i < 2; i++) {
    animator.update({ ...state, hit: true });
    assert.equal(animator.current.getClip().name, "Armação|Minering");
    assert.equal(animator.current.time, 0);
    assert.equal(animator.oneShot, true);
    animator.mixer.update(1);
    assert.equal(animator.oneShot, false);
    animator.update(state);
    assert.equal(animator.current.getClip().name, "Armação|Idle");
    animator.mixer.update(0.2);
  }
});

test("death preview holds its final pose until gameplay resumes", () => {
  animator.setPreview("Armação|Die");
  animator.mixer.update(2);
  animator.update({ ...state, isMoving: true });
  assert.equal(animator.current.getClip().name, "Armação|Die");
  assert.equal(animator.current.paused, true);
  animator.setPreview("");
  animator.update({ ...state, isMoving: true });
  assert.equal(animator.current.getClip().name, "Armação|Walk");
});

test("skinned suit vertices match the unmodified native clips for all 16 animations", () => {
  const referenceMixer = new THREE.AnimationMixer(reference);
  reference.position.copy(player.position);
  reference.quaternion.copy(player.quaternion);
  reference.scale.copy(player.scale);
  const meshes = [];
  player.traverse(node => { if (node.isSkinnedMesh) meshes.push(node); });
  const actual = new THREE.Vector3();
  const expected = new THREE.Vector3();
  for (const name of ASTRONAUT_CLIPS) {
    for (const fraction of [0, 0.25, 0.75]) {
      animator.mixer.stopAllAction();
      animator.current = null;
      animator.setPreview(name);
      referenceMixer.stopAllAction();
      const source = reference.animations.find(clip => clip.name === name);
      referenceMixer.clipAction(source).reset().play();
      const elapsed = source.duration * fraction;
      animator.mixer.update(elapsed);
      referenceMixer.update(elapsed);
      player.updateMatrixWorld(true);
      reference.updateMatrixWorld(true);
      for (const mesh of meshes) {
        const other = reference.getObjectByName(mesh.name);
        mesh.skeleton.update();
        other.skeleton.update();
        const count = mesh.geometry.attributes.position.count;
        for (let i = 0; i < count; i += Math.max(1, Math.floor(count / 30))) {
          mesh.getVertexPosition(i, actual).applyMatrix4(mesh.matrixWorld);
          other.getVertexPosition(i, expected).applyMatrix4(other.matrixWorld);
          assert.ok(actual.distanceTo(expected) < 1e-5, `${name}: ${mesh.name}, vertex ${i}, time ${elapsed}`);
        }
      }
    }
  }
  animator.setPreview("");
});
