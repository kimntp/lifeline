import { renderDialogueText } from "./dialogue-text.mjs";
import { attachDialogueText } from "./narration-captions.js";
import * as THREE from "three";
import { createDialogueDubbing } from "./alien-dubbing.js";
import { DIRECT_ALIEN_DIALOGUE, AFTERMATH_DIALOGUE } from "./ice-dialogue.mjs";
export { ALIEN_PAIN_LINE, DIRECT_ALIEN_DIALOGUE } from "./ice-dialogue.mjs";
import { createAftermathActors } from "./aftermath-actors.js";

export const ICE_AFTERMATH_STAGES = Object.freeze([
  { phase: "pain", duration: 3 }, { phase: "march", duration: 5 },
  { phase: "strike", duration: 2.2 }, { phase: "down", duration: 1.8 },
  { phase: "glitch", duration: 3 }, { phase: "dialogue", duration: Infinity },
]);

export function createIceAftermath({ alien, player, scene, camera, ground, obstacles = [], occluders = [], channel, reducedMotion = false, onDirectContact = () => {}, dubbingFactory = createDialogueDubbing }) {
  const owner = {};
  if (!channel.begin(owner)) throw new Error("The alien scene needs the dialogue channel");
  const originalPosition = alien.visual.position.clone(), originalRotation = alien.visual.quaternion.clone();
  const focus = originalPosition.clone().add(new THREE.Vector3(0, 0.45, 0));
  const ray = new THREE.Raycaster();
  let shot;
  for (let i = 0; i < 16; i++) {
    const angle = i * Math.PI / 8;
    const candidate = focus.clone().add(new THREE.Vector3(Math.cos(angle) * 3, 1.6, Math.sin(angle) * 3));
    candidate.y = Math.max(candidate.y, (ground?.heightAt(candidate.x, candidate.z) ?? 0) + 1);
    const direction = candidate.clone().sub(focus);
    ray.set(focus, direction.clone().normalize()); ray.far = direction.length();
    if (!ray.intersectObjects(occluders, false).length) { shot = candidate; break; }
  }
  shot ??= focus.clone().add(new THREE.Vector3(0, 4, 1));
  let actors;
  try { actors = createAftermathActors({ scene, player, alienPosition: originalPosition, ground, obstacles, viewDirection: shot.clone().sub(focus) }); }
  catch (error) { channel.end(owner); throw error; }
  const root = document.createElement("section"); root.className = "dialogue-box colony-dialogue ice-aftermath";
  root.setAttribute("aria-label", "Guard attack and direct alien conversation");
  root.innerHTML = `<p class="colony-eyebrow" id="aftermath-speaker"></p><p id="aftermath-line" aria-live="polite"></p>
    <p id="aftermath-link" class="aftermath-link" role="status"></p><button class="colony-dialogue-hint" type="button">Sequence playing…</button>`;
  document.body.appendChild(root);
  const speaker = root.querySelector("#aftermath-speaker"), line = root.querySelector("#aftermath-line"), link = root.querySelector("#aftermath-link"), button = root.querySelector("button");
  const dubbing = dubbingFactory({ owner,
    onAudio: (audio, entry) => attachDialogueText(audio, entry, { box: root, speaker, line }),
    onChange: ({ status }) => {
      if (["finished", "error", "completed"].includes(status)) {
        const entry = phase() === "dialogue" ? DIRECT_ALIEN_DIALOGUE[dialogueLine] : AFTERMATH_DIALOGUE[phase()];
        renderDialogueText(line, entry.text);
      }
    },
  });
  let resolve, phaseIndex = 0, phaseTime = 0, elapsed = 0, dialogueLine = 0, disposed = false, complete = false;
  let pendingSpeech = null;
  const finished = new Promise(done => { resolve = done; });
  const phase = () => ICE_AFTERMATH_STAGES[phaseIndex].phase;
  function stopSpeech() { pendingSpeech = null; dubbing.stop(); }
  function showPhase() {
    const p = phase(); button.disabled = p !== "dialogue";
    button.textContent = p === "dialogue" ? "Enter / E - Continue | Enter - Skip voice" : "Sequence playing... | Enter - Skip voice";
    stopSpeech();
    const entry = p === "dialogue" ? DIRECT_ALIEN_DIALOGUE[dialogueLine] : AFTERMATH_DIALOGUE[p];
    speaker.textContent = entry.speaker; renderDialogueText(line, entry.voiceSpeaker ? "" : entry.text);
    root.classList?.toggle("apollo-dialogue", entry.speaker.startsWith("Apollo"));
    pendingSpeech = entry.voiceSpeaker ? entry : null;
    link.textContent = ["glitch", "dialogue"].includes(p) ? p === "glitch"
      ? "APOLLO // TRANSLATION FILTER FAILURE" : "DIRECT ALIEN CHANNEL · APOLLO FILTER OFFLINE" : "";
  }
  function continueScene() {
    if (root.hidden || disposed || complete || phase() !== "dialogue" || phaseTime < 0.35 || dubbing.busy || pendingSpeech) return;
    dialogueLine++;
    if (dialogueLine >= DIRECT_ALIEN_DIALOGUE.length) { complete = true; stopSpeech(); resolve(); return; }
    phaseTime = 0; showPhase();
  }
  function key(event) {
    if (root.hidden || event.repeat) return;
    if (["Enter", "NumpadEnter"].includes(event.code)) {
      event.preventDefault();
      if (pendingSpeech) { renderDialogueText(line, pendingSpeech.text); pendingSpeech = null; }
      else if (dubbing.busy) dubbing.complete();
      else continueScene();
    } else if (event.code === "KeyE") continueScene();
  }
  window.addEventListener("keydown", key); button.addEventListener("click", continueScene);
  showPhase();
  function frameCamera(p) {
    if (p === "pain") { camera.position.copy(shot); camera.lookAt(focus); return; }
    const target = actors.target, floor = ground?.heightAt(target.x, target.z) ?? 0;
    const center = target.clone().lerp(originalPosition, 0.4); center.y = floor + 1;
    if (p === "march") {
      camera.position.copy(center).addScaledVector(actors.axis, 4.8).addScaledVector(actors.side, 5);
      camera.position.y = Math.max(floor + 3, (ground?.heightAt(camera.position.x, camera.position.z) ?? 0) + 1.2);
      camera.lookAt(center);
    } else if (p === "strike") {
      camera.position.copy(target).addScaledVector(actors.side, 3).addScaledVector(actors.axis, 0.5);
      camera.position.y = Math.max(floor + 2.1, (ground?.heightAt(camera.position.x, camera.position.z) ?? 0) + 0.7);
      camera.lookAt(target.x, floor + 1, target.z);
    } else {
      camera.position.copy(target).addScaledVector(actors.side, 0.5);
      camera.position.y = floor + 0.65;
      camera.lookAt(originalPosition.x, originalPosition.y + 0.6, originalPosition.z);
      if (!reducedMotion) camera.rotateZ(-0.12);
    }
    if (obstacles.some(box => box.containsPoint(camera.position))) {
      camera.position.copy(target); camera.position.y = floor + 0.65;
      camera.lookAt(originalPosition.x, originalPosition.y + 0.6, originalPosition.z);
    }
  }
  actors.update("pain", 0, 0); frameCamera("pain"); root.hidden = true;
  return {
    finished, actors,
    get musicMood() { return ["pain", "dialogue"].includes(phase()) ? "sad" : "unsettling"; },
    setVisible(visible) { root.hidden = !visible; dubbing.setPaused(!visible); },
    get phase() { return phase(); },
    get dialogueIndex() { return dialogueLine; },
    update(delta, visible) {
      root.hidden = !visible;
      document.body.classList.toggle("apollo-glitch", visible && phase() === "glitch" && !complete);
      dubbing.setPaused(!visible);
      if (!visible || disposed || complete) return;
      if (pendingSpeech) { const entry = pendingSpeech; pendingSpeech = null; void dubbing.start(entry, entry.voiceSpeaker); }
      button.disabled = phase() !== "dialogue" || dubbing.busy;
      elapsed += delta; phaseTime += delta;
      while (phaseTime >= ICE_AFTERMATH_STAGES[phaseIndex].duration) {
        if (dubbing.busy) { phaseTime = ICE_AFTERMATH_STAGES[phaseIndex].duration; break; }
        phaseTime -= ICE_AFTERMATH_STAGES[phaseIndex].duration;
        phaseIndex++; showPhase();
        if (pendingSpeech) { const entry = pendingSpeech; pendingSpeech = null; void dubbing.start(entry, entry.voiceSpeaker); }
        if (phase() === "dialogue") onDirectContact();
      }
      document.body.classList.toggle("apollo-glitch", phase() === "glitch");
      actors.update(phase(), phaseTime, elapsed); frameCamera(phase());
      alien.visual.position.copy(originalPosition); alien.visual.quaternion.copy(originalRotation);
      if (!reducedMotion && phase() === "pain") {
        alien.visual.rotation.z += Math.sin(elapsed * 15) * 0.018;
        alien.visual.position.y += Math.sin(elapsed * 3) * 0.018;
      }

    },
    dispose() {
      if (disposed) return; disposed = true;
      stopSpeech(); dubbing.destroy(); window.removeEventListener("keydown", key); document.body.classList.remove("apollo-glitch");
      actors.dispose(); alien.visual.position.copy(originalPosition); alien.visual.quaternion.copy(originalRotation);
      root.remove(); channel.end(owner); resolve();
    },
  };
}
