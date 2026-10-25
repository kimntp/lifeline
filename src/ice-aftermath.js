import * as THREE from "three";
import { isNarrationMuted } from "./narration-audio.js";

export const ALIEN_PAIN_LINE = "Please... it hurts. We only wanted to protect our water.";

// The world stays frozen while this close-up owns the camera and dialogue.
export function createIceAftermath({ alien, camera, ground, occluders = [], channel, reducedMotion = false }) {
  const owner = {};
  if (!channel.begin(owner)) throw new Error("The alien scene needs the dialogue channel");
  const originalPosition = alien.visual.position.clone(), originalRoll = alien.visual.rotation.z;
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
  camera.position.copy(shot ?? focus.clone().add(new THREE.Vector3(0, 4, 0.1)));
  camera.lookAt(focus);
  const root = document.createElement("section");
  root.className = "dialogue-box ice-aftermath";
  root.setAttribute("aria-label", "The injured alien");
  root.innerHTML = `<p class="colony-eyebrow">Downed gray alien · Unfiltered voice</p>
    <p>[A strained cry. The alien trembles in pain.]</p>
    <p>${ALIEN_PAIN_LINE}</p><p class="colony-dialogue-hint">You hear him directly. Apollo is silent.</p>
    <button type="button">E — Continue</button>`;
  document.body.appendChild(root);
  let resolve, elapsed = 0, disposed = false, spoken = false, speechActive = false;
  const finished = new Promise(done => { resolve = done; });
  const speech = globalThis.speechSynthesis;
  function continueScene() { if (!root.hidden && elapsed >= 1 && !disposed) resolve(); }
  function key(event) { if (event.code === "KeyE" && !event.repeat) continueScene(); }
  window.addEventListener("keydown", key);
  root.querySelector("button").addEventListener("click", continueScene);
  return {
    finished,
    update(delta, visible) {
      root.hidden = !visible;
      if (speechActive && speech) {
        if (isNarrationMuted()) { speech.cancel(); speechActive = false; }
        else if (!visible) speech.pause();
        else if (speech.paused) speech.resume();
      }
      if (!visible || disposed) return;
      elapsed += delta;
      if (!spoken) {
        spoken = true;
        if (speech && globalThis.SpeechSynthesisUtterance && !isNarrationMuted()) {
          const voice = new SpeechSynthesisUtterance(ALIEN_PAIN_LINE);
          voice.rate = 0.7; voice.pitch = 0.65; voice.volume = 0.85;
          try { speech.speak(voice); speechActive = true; }
          catch { /* Captions remain available when browser speech is unavailable. */ }
        }
      }
      if (!reducedMotion) {
        alien.visual.rotation.z = originalRoll + Math.sin(elapsed * 15) * 0.018;
        alien.visual.position.y = originalPosition.y + Math.sin(elapsed * 3) * 0.018;
      }
    },
    dispose() {
      disposed = true;
      if (speechActive) speech?.cancel();
      window.removeEventListener("keydown", key);
      alien.visual.position.copy(originalPosition); alien.visual.rotation.z = originalRoll;
      root.remove(); channel.end(owner); resolve();
    },
  };
}
