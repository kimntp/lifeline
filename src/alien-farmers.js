import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";

export function createAlienLoader() {
  const manager = new THREE.LoadingManager();
  const missingTextures = new THREE.TextureLoader(manager);
  // The FBXs reference external PNGs that were not supplied. Preserve their
  // embedded diffuse colors without requesting missing images.
  missingTextures.load = function (_url, onLoad) {
    const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    texture.needsUpdate = true;
    queueMicrotask(() => onLoad?.(texture));
    return texture;
  };
  manager.addHandler(/\.png$/i, missingTextures);
  return new FBXLoader(manager);
}

export function prepareAlienModel(model) {
  model.traverse(node => {
    if (!node.isMesh) return;
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      for (const key of ["map", "normalMap", "bumpMap", "specularMap", "alphaMap", "emissiveMap"]) {
        material[key]?.dispose();
        material[key] = null;
      }
      material.needsUpdate = true;
    }
    node.castShadow = true;
    node.receiveShadow = true;
  });
  return model;
}

export function createAlienFarmer(source, variant) {
  // A normal Object3D.clone would leave the mesh bound to the source bones.
  const model = cloneSkeleton(source);
  const visual = new THREE.Group();
  visual.add(model);
  const mixer = new THREE.AnimationMixer(model);
  const actions = new Map();
  for (const clip of model.animations) {
    actions.set(clip.name.split("|").at(-1), mixer.clipAction(clip));
  }
  for (const name of ["Idle", "Walk", "Run"]) {
    if (!actions.has(name)) throw new Error(`Alien ${variant} is missing its native ${name} animation`);
  }
  let current = actions.get("Idle");
  current.play();
  mixer.update(0);
  visual.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(model, true);
  model.scale.multiplyScalar(1.65 / box.getSize(new THREE.Vector3()).y);
  visual.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(model, true);
  const center = box.getCenter(new THREE.Vector3());
  model.position.add(new THREE.Vector3(-center.x, -box.min.y, -center.z));
  visual.updateMatrixWorld(true);
  const spine = model.getObjectByName("mixamorigSpine");
  const leftArm = model.getObjectByName("mixamorigLeftArm");
  const rightArm = model.getObjectByName("mixamorigRightArm");
  const leftForearm = model.getObjectByName("mixamorigLeftForeArm");
  const rightForearm = model.getObjectByName("mixamorigRightForeArm");
  const nativePose = new Map([spine, leftArm, rightArm, leftForearm, rightForearm]
    .filter(Boolean).map(bone => [bone, new THREE.Quaternion()]));
  let hasTendingPose = false;
  let elapsed = 0;
  visual.userData.variant = variant;
  visual.userData.animator = {
    model, mixer, actions,
    update(delta, walking, tending) {
      elapsed += delta;
      // Restore last frame's native pose before mixing. Constant animation
      // tracks can skip writes, so procedural offsets must never accumulate.
      if (hasTendingPose) for (const [bone, rotation] of nativePose) bone.quaternion.copy(rotation);
      hasTendingPose = false;
      const next = actions.get(walking ? "Walk" : "Idle");
      if (next !== current) {
        next.reset().setEffectiveWeight(1).play();
        current.crossFadeTo(next, 0.18, false);
        current = next;
      }
      mixer.update(delta);
      // No farming clip is embedded. Apply a gentle reach over the native
      // idle pose; the mixer restores these bones before each frame's offset.
      if (tending) {
        for (const [bone, rotation] of nativePose) rotation.copy(bone.quaternion);
        hasTendingPose = true;
        if (spine) spine.rotation.x += 0.12;
        for (const [index, arm] of [leftArm, rightArm].entries()) {
          if (arm) arm.rotation.x -= 0.25 + Math.sin(elapsed * 3 + index) * 0.08;
        }
        for (const arm of [leftForearm, rightForearm]) if (arm) arm.rotation.x -= 0.3;
      }
    },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
      model.traverse(node => { if (node.isSkinnedMesh) node.skeleton.dispose(); });
    },
  };
  return visual;
}
