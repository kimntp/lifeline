import * as THREE from "three";
import { AstronautAnimator, cloneAstronaut } from "./astronaut-animations.js";
import { applyAstronautSuit } from "./astronaut-suit.js";
import { createAlienFarmer } from "./alien-farmers.js";
import { equipTaserBaton } from "./ice-encounter.js";

import { SURVEY_SHOTS, SURVEY_NARRATION } from "./survey-dialogue.mjs";
import { createDialogueDubbing } from "./alien-dubbing.js";
import { attachDialogueText } from "./narration-captions.js";
import { dialogueSession } from "./dialogue-session.js";
export { SURVEY_SHOTS } from "./survey-dialogue.mjs";

export function createSurveyMontage({ player, alienModels, cropModel, tomatoModel, domeModel, aspect = 1, reducedMotion = false, channel = dialogueSession, dubbingFactory = createDialogueDubbing }) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x211317);
  scene.fog = new THREE.Fog(0x211317, 35, 110);
  const camera = new THREE.PerspectiveCamera(46, aspect, 0.1, 200);
  scene.add(new THREE.HemisphereLight(0xd1d6eb, 0x49302a, 2));
  const sun = new THREE.DirectionalLight(0xffd0ac, 2.5); sun.position.set(-8, 14, 5); scene.add(sun);
  const rim = new THREE.DirectionalLight(0xa8c9ec, 1.4); rim.position.set(6, 7, -5); scene.add(rim);
  const impactLight = new THREE.PointLight(0x75d8ee, 0, 3); impactLight.position.set(-4, 0.9, -0.5); scene.add(impactLight);
  const owned = [];
  function mesh(geometry, color) {
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
    const object = new THREE.Mesh(geometry, material); scene.add(object);
    owned.push(geometry, material); return object;
  }
  const ground = mesh(new THREE.PlaneGeometry(100, 100), 0x805447); ground.rotation.x = -Math.PI / 2;
  for (let i = 0; i < 10; i++) {
    const hill = mesh(new THREE.IcosahedronGeometry(4 + i % 3, 1), 0x604346);
    hill.position.set((i - 5) * 7, -1, -17 - i % 3 * 5); hill.scale.y = 0.65;
  }
  function normalized(source, height, x, y, z) {
    if (!source) return;
    const group = new THREE.Group(), model = source.clone(true); group.add(model);
    let bounds = new THREE.Box3().setFromObject(model);
    model.scale.multiplyScalar(height / Math.max(0.001, bounds.getSize(new THREE.Vector3()).y));
    bounds = new THREE.Box3().setFromObject(model); const center = bounds.getCenter(new THREE.Vector3());
    model.position.add(new THREE.Vector3(-center.x, -bounds.min.y, -center.z));
    group.position.set(x, y, z); scene.add(group);
  }
  // Recreate Colony 1's habitat and four tomato/wheat beds from its own assets.
  normalized(domeModel, 6.4, 0, 0.15, -8);
  const pad = mesh(new THREE.CylinderGeometry(4.5, 4.6, 0.2, 32), 0x5d6265); pad.position.set(0, 0.1, -8);
  for (let row = 0; row < 2; row++) for (let col = 0; col < 2; col++) {
    const x = col ? 4 : -4, z = 2 + row * 6;
    const bed = mesh(new THREE.BoxGeometry(5, 0.22, 4), 0x493226); bed.position.set(x, 0.11, z);
    for (let iz = 0; iz < 3; iz++) for (let ix = 0; ix < 4; ix++) {
      normalized(col ? cropModel : tomatoModel ?? cropModel, col ? 0.62 : 0.68,
        x - 1.8 + ix * 1.2, 0.22, z - 1.2 + iz * 1.2);
    }
  }
  const guardSpots = [[-8, 1.5], [8, 1.5], [-8, 9], [8, 9]];
  const guards = guardSpots.map(([x, z], i) => {
    const visual = cloneAstronaut(player); visual.name = `Montage guard ${i + 1}`;
    for (const name of ["TaserBaton", "IceMiningPick", "SurveyShovel"]) visual.getObjectByName(name)?.removeFromParent();
    visual.position.set(0, 0, 0); visual.rotation.set(0, 0, 0);
    owned.push(...applyAstronautSuit(visual, "black"));
    const animator = new AstronautAnimator(visual); animator.setPreview("Armação|PistolIdle"); animator.mixer.update(0.25);
    visual.updateMatrixWorld(true);
    const footOffset = -new THREE.Box3().setFromObject(visual, true).min.y;
    visual.position.set(x, footOffset, z); visual.rotation.y = Math.atan2(-x, 4 - z);
    const baton = equipTaserBaton(visual); baton.visible = true;
    baton.traverse(node => { if (node.isMesh) owned.push(node.geometry, ...(Array.isArray(node.material) ? node.material : [node.material])); });
    visual.updateMatrixWorld(true);
    scene.add(visual); return { visual, animator, footOffset };
  });
  const workSpots = [[-4, -0.5], [4, -0.5], [-4, 5.5], [4, 5.5], [-6.3, 8], [6.3, 8]];
  const aliens = workSpots.map(([x, z], i) => {
    const visual = createAlienFarmer(alienModels.green, "green");
    visual.name = `Montage colonist ${i + 1}`;
    visual.position.set(x, 0, z); visual.rotation.y = i < 4 ? 0 : i === 4 ? Math.PI / 2 : -Math.PI / 2;
    scene.add(visual); return visual;
  });
  const root = document.createElement("section"); root.className = "survey-montage";
  root.setAttribute("aria-label", "Garden colony forced labor cutscene");
  root.innerHTML = `<div class="montage-letterbox montage-top"></div><p class="montage-region"></p>
    <div class="dialogue-box montage-bottom"><p class="colony-eyebrow">Narrator</p><p class="montage-caption" aria-live="polite"></p>
    <button class="colony-dialogue-hint" type="button">Enter — Skip cutscene</button></div><div class="montage-dissolve" aria-hidden="true"></div>`;
  document.body.appendChild(root);
  const region = root.querySelector(".montage-region"), caption = root.querySelector(".montage-caption"), dissolve = root.querySelector(".montage-dissolve");
  const owner = {};
  if (!channel.begin(owner)) { root.remove(); throw new Error("The montage needs the dialogue channel"); }
  const speaker = root.querySelector(".colony-eyebrow"), box = root.querySelector(".montage-bottom");
  const dubbing = dubbingFactory({ owner,
    onAudio: (audio, entry) => attachDialogueText(audio, entry, { box, speaker, line: caption }),
    onChange: ({ status }) => { if (["error", "finished", "completed"].includes(status)) caption.textContent = SURVEY_SHOTS[shotIndex].caption; },
  });
  let pendingSpeech = null;
  let resolve, shotIndex = 0, shotTime = 0, elapsed = 0, disposed = false, complete = false;
  const finished = new Promise(done => { resolve = done; });
  function finish() { if (!complete) { complete = true; pendingSpeech = null; dubbing.stop(); channel.end(owner); resolve(); } }
  function skip() {
    if (root.hidden || disposed || complete) return;
    if (pendingSpeech) { caption.textContent = pendingSpeech.text; pendingSpeech = null; }
    else if (dubbing.busy) dubbing.complete();
    else if (elapsed > 1) finish();
  }
  function key(event) { if (["Enter", "NumpadEnter"].includes(event.code) && !event.repeat) skip(); }
  window.addEventListener("keydown", key); root.querySelector("button").addEventListener("click", skip);
  function title() {
    const shot = SURVEY_SHOTS[shotIndex];
    dubbing.stop();
    pendingSpeech = SURVEY_NARRATION[shotIndex];
    region.textContent = shot.region; caption.textContent = "";
    for (const [i, alien] of aliens.entries()) {
      alien.position.set(workSpots[i][0], 0, workSpots[i][1]);
      alien.rotation.x = alien.rotation.z = 0;
    }
    if (shot.action === "batonStrike") {
      guards[0].visual.position.set(-4.1, guards[0].footOffset, -1.35);
      guards[0].visual.rotation.y = 0;
      guards[0].animator.mixer.stopAllAction(); guards[0].animator.current = null;
      guards[0].animator.setPreview("Armação|Minering");
      guards[0].animator.current.setEffectiveTimeScale(0);
    } else if (shot.action === "collapse") {
      guards[0].animator.mixer.stopAllAction(); guards[0].animator.current = null;
      guards[0].animator.setPreview("Armação|PistolIdle");
    }
  }
  title();
  const montage = {
    scene, camera, finished,
    setVisible(visible) { root.hidden = !visible; dubbing.setPaused(!visible); },
    get shot() { return SURVEY_SHOTS[shotIndex]; },
    update(delta, visible, nextAspect = aspect) {
      root.hidden = !visible;
      dubbing.setPaused(!visible);
      if (!visible || disposed || complete) return;
      if (pendingSpeech) { const entry = pendingSpeech; pendingSpeech = null; void dubbing.start(entry, entry.voiceSpeaker); }
      elapsed += delta; shotTime += delta;
      while (shotTime >= SURVEY_SHOTS[shotIndex].duration) {
        if (dubbing.busy) { shotTime = SURVEY_SHOTS[shotIndex].duration; break; }
        shotTime -= SURVEY_SHOTS[shotIndex].duration;
        if (shotIndex === SURVEY_SHOTS.length - 1) { finish(); return; }
        shotIndex++; title();
        if (pendingSpeech) { const entry = pendingSpeech; pendingSpeech = null; void dubbing.start(entry, entry.voiceSpeaker); }
      }
      if (camera.aspect !== nextAspect) { camera.aspect = nextAspect; camera.updateProjectionMatrix(); }
      const collapse = SURVEY_SHOTS[shotIndex].action === "collapse";
      const strike = SURVEY_SHOTS[shotIndex].action === "batonStrike";
      const t = shotTime / SURVEY_SHOTS[shotIndex].duration;
      for (const [i, guard] of guards.entries()) {
        if (strike && i === 0) {
          guard.animator.current.time = THREE.MathUtils.clamp((shotTime - 0.8) * 0.8, 0, guard.animator.current.getClip().duration);
          guard.animator.mixer.update(0);
        } else guard.animator.mixer.update(delta);
        guard.visual.updateMatrixWorld(true);
      }
      const impact = strike ? Math.max(0, 1 - Math.abs(shotTime - 1.3) / 0.18) : 0;
      impactLight.intensity = reducedMotion ? 0 : impact * 2;
      guards[0].visual.userData.strikeContact = strike && shotTime >= 1.3;
      for (const [i, alien] of aliens.entries()) {
        const collapses = collapse && [0, 3, 4].includes(i);
        const fall = collapses ? THREE.MathUtils.smoothstep(shotTime, 0.4 + i * 0.25, 1.9 + i * 0.25) : 0;
        alien.userData.animator.update(fall === 1 ? 0 : delta * 0.65, false, fall === 0 && !(strike && i === 0));
        if (strike && i === 0) {
          const recoil = THREE.MathUtils.smoothstep(shotTime, 1.3, 1.5) * (1 - THREE.MathUtils.smoothstep(shotTime, 2, 3.3));
          alien.rotation.x = 0.27 * recoil;
          alien.position.z = workSpots[0][1] + 0.16 * recoil;
          alien.userData.strikeRecoil = recoil;
        }
        if (collapses) {
          alien.rotation.z = (i % 2 ? 1 : -1) * Math.PI / 2 * fall;
          alien.position.y = 0.22 * fall;
        }
      }
      const drift = reducedMotion ? 0 : t * 0.6;
      const focus = strike ? new THREE.Vector3(-4.05, 1.05, -0.75)
        : new THREE.Vector3(collapse ? -1.5 : 0, 1, collapse ? 3 : 4);
      const offset = strike ? new THREE.Vector3(2.8 - drift * 0.2, 0.9, 2.1)
        : new THREE.Vector3(collapse ? 10 - drift : 14 - drift, collapse ? 5 : 10, collapse ? 12 : 18);
      camera.position.copy(focus).add(offset.multiplyScalar(Math.max(1, 1 / camera.aspect)));
      camera.lookAt(focus);
      dissolve.style.opacity = String(Math.max(0, 1 - shotTime / 0.35, dubbing.busy ? 0 : 1 - (SURVEY_SHOTS[shotIndex].duration - shotTime) / 0.35));
    },
    dispose() {
      if (disposed) return; disposed = true;
      pendingSpeech = null; dubbing.destroy(); channel.end(owner);
      window.removeEventListener("keydown", key); root.remove();
      for (const guard of guards) {
        guard.animator.mixer.stopAllAction(); guard.animator.mixer.uncacheRoot(guard.visual);
        guard.visual.traverse(node => { if (node.isSkinnedMesh) node.skeleton.dispose(); });
      }
      for (const alien of aliens) alien.userData.animator.dispose();
      for (const resource of owned) resource.dispose();
      scene.clear(); finish();
    },
  };
  montage.update(0, true); root.hidden = true;
  return montage;
}
