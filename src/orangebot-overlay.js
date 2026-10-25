import * as THREE from "three";
import { isNarrationPlaying } from "./narration-audio.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";

// A separate transparent view keeps the companion fixed to the screen.
export async function createOrangeBotOverlay() {
  const base = `${import.meta.env.BASE_URL}assets/OrangeBOT/`;
  const textures = new THREE.TextureLoader().setPath(`${base}Textures/`);
  const loader = new FBXLoader().setResourcePath(`${base}Textures/`);
  const model = await loader.loadAsync(`${base}OrangeBOT_FBX.fbx`);
  const materials = new Map();
  const loadTexture = async (name, color = false) => {
    const texture = await textures.loadAsync(name);
    if (color) texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  };

  await Promise.all(["Orange", "Black", "White"].map(async (name) => {
    const [map, normalMap, roughnessMap, metalnessMap] = await Promise.all([
      loadTexture(`${name}_Base_Color.jpg`, true),
      loadTexture(`${name}_Normal_OpenGL.jpg`),
      loadTexture(`${name}_Roughness.jpg`),
      loadTexture(`${name}_Metallic.jpg`),
    ]);
    materials.set(name, new THREE.MeshStandardMaterial({
      map, normalMap, roughnessMap, metalnessMap, metalness: 1, roughness: 1,
    }));
  }));
  materials.set("FaceScreen", new THREE.MeshStandardMaterial({
    map: await loadTexture("Faces.jpg", true), roughness: 0.65,
  }));
  // Keep emission on the mouths in the atlas, leaving eyes unlit.
  const faceMaterial = materials.get("FaceScreen");
  const faceImage = faceMaterial.map.image;
  const mouthMask = document.createElement("canvas");
  mouthMask.width = faceImage.width;
  mouthMask.height = faceImage.height;
  const maskContext = mouthMask.getContext("2d");
  maskContext.fillStyle = "black";
  maskContext.fillRect(0, 0, mouthMask.width, mouthMask.height);
  for (const [top, bottom] of [[0.125, 0.2], [0.35, 0.45]]) {
    const y = Math.floor(top * mouthMask.height);
    const height = Math.ceil((bottom - top) * mouthMask.height);
    maskContext.drawImage(faceImage, 0, y, mouthMask.width, height,
      0, y, mouthMask.width, height);
  }
  faceMaterial.emissiveMap = new THREE.CanvasTexture(mouthMask);
  faceMaterial.emissiveMap.colorSpace = THREE.SRGBColorSpace;
  faceMaterial.emissive.set(0xffa52f);
  faceMaterial.emissiveIntensity = 0;

  model.traverse((object) => {
    if (!object.isMesh) return;
    const replace = (material) => materials.get(material.name.replace(/\.\d+$/, "")) ?? material;
    object.material = Array.isArray(object.material)
      ? object.material.map(replace) : replace(object.material);
  });

  // Normalize the FBX's export units and origin before framing it.
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const scale = 2 / Math.max(size.x, size.y, size.z);
  model.scale.multiplyScalar(scale);
  model.position.sub(bounds.getCenter(new THREE.Vector3()).multiplyScalar(scale));
  const scene = new THREE.Scene();
  const idlePivot = new THREE.Group();
  idlePivot.add(model);
  scene.add(idlePivot);
  // The supplied clip rotates the armature; use a gentle companion idle instead.
  const torso = model.getObjectByName("Torso");
  const head = model.getObjectByName("Head");
  const torsoRest = torso?.quaternion.clone();
  const headRest = head?.quaternion.clone();
  const idleRotation = new THREE.Quaternion();
  const idleEuler = new THREE.Euler();
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let idleTime = 0;
  let speechTime = 0;
  let speakingBlend = 0;
  const arms = [
    ["L_Bicep", 0.85], ["R_Bicep", -0.85],
    ["L_Forearm", 0.65], ["R_Forearm", -0.65],
  ].map(([name, angle]) => {
    const bone = model.getObjectByName(name);
    return { bone, angle, rest: bone?.quaternion.clone() };
  });
  scene.add(new THREE.HemisphereLight(0xffffff, 0x526080, 2));
  const light = new THREE.DirectionalLight(0xffffff, 3);
  light.position.set(3, 4, 5);
  scene.add(light);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  camera.position.set(0, 0.15, 3.6);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  // Supersample this small canvas even on standard-density displays.
  const pixelRatio = () => Math.min(3, Math.max(2, (window.devicePixelRatio || 1) * 1.5));
  renderer.setPixelRatio(pixelRatio());
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  for (const material of materials.values()) {
    for (const key of ["map", "normalMap", "roughnessMap", "metalnessMap"]) {
      if (!material[key]) continue;
      material[key].anisotropy = anisotropy;
      material[key].needsUpdate = true;
    }
  }
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.id = "orangebot-overlay";
  renderer.domElement.setAttribute("role", "img");
  renderer.domElement.setAttribute("aria-label", "OrangeBOT companion");
  document.body.appendChild(renderer.domElement);
  const resize = () => {
    const { width, height } = renderer.domElement.getBoundingClientRect();
    renderer.setPixelRatio(pixelRatio());
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(renderer.domElement);
  window.addEventListener("resize", resize);
  resize();
  return (delta) => {
    if (!reducedMotion.matches) idleTime += delta;
    const time = reducedMotion.matches ? 0 : idleTime;
    idlePivot.position.y = Math.sin(time * 1.7) * 0.045;
    idlePivot.rotation.y = Math.sin(time * 0.6) * 0.085;
    if (torso) {
      idleRotation.setFromEuler(idleEuler.set(Math.sin(time * 1.7) * 0.03, 0, 0));
      torso.quaternion.copy(torsoRest).multiply(idleRotation);
    }
    if (head) {
      idleRotation.setFromEuler(idleEuler.set(
        Math.sin(time * 1.1) * 0.05, Math.sin(time * 0.7) * 0.11, 0,
      ));
      head.quaternion.copy(headRest).multiply(idleRotation);
    }
    const speaking = isNarrationPlaying();
    speechTime += delta;
    speakingBlend = THREE.MathUtils.damp(speakingBlend, speaking ? 1 : 0, 7, delta);
    const gesture = reducedMotion.matches ? 0 : speakingBlend;
    for (const { bone, angle, rest } of arms) {
      if (!bone) continue;
      const emphasis = 1 + Math.sin(speechTime * 3) * 0.08;
      idleRotation.setFromEuler(idleEuler.set(angle * gesture * emphasis, 0, 0));
      bone.quaternion.copy(rest).multiply(idleRotation);
    }
    const pulse = reducedMotion.matches ? 1 : 0.8 + Math.sin(speechTime * 10) * 0.2;
    faceMaterial.emissiveIntensity = speakingBlend * 3.5 * pulse;
    renderer.render(scene, camera);
  };
}
