import * as THREE from "three";
import { isNarrationMuted } from "./narration-audio.js";
import { createAftermathActors } from "./aftermath-actors.js";

export const ALIEN_PAIN_LINE = "Please... it hurts. We only wanted to protect our water.";
export const ICE_AFTERMATH_STAGES = Object.freeze([
  { phase: "pain", duration: 3 }, { phase: "march", duration: 5 },
  { phase: "strike", duration: 2.2 }, { phase: "down", duration: 1.8 },
  { phase: "glitch", duration: 3 }, { phase: "dialogue", duration: Infinity },
]);
export const DIRECT_ALIEN_DIALOGUE = Object.freeze([
  { speaker: "You", text: "You were trying to warn me. What is the company doing here?" },
  { speaker: "Downed gray alien", text: "They take our crops and our water to Earth. Our families are forced to work." },
  { speaker: "You", text: "Apollo told me the samples would help everyone." },
  { speaker: "Downed gray alien", text: "Your samples show them what to take next. If we refuse, their guards beat us. When we collapse, they replace us." },
  { speaker: "Apollo · damaged link", text: "[Translation filter offline. Direct channel established.]" },
  { speaker: "Downed gray alien", text: "You heard me before he changed my words. Now you know. Will you help us?" },
  { speaker: "You", text: "I'll listen to you. Tell me what you need." },
  { speaker: "Downed gray alien", text: "Stop sending them our resources. Help our people get out." },
]);

export function createIceAftermath({ alien, player, scene, camera, ground, obstacles = [], occluders = [], channel, reducedMotion = false, onDirectContact = () => {} }) {
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
  const root = document.createElement("section"); root.className = "dialogue-box ice-aftermath";
  root.setAttribute("aria-label", "Guard attack and direct alien conversation");
  root.innerHTML = `<p class="colony-eyebrow" id="aftermath-speaker"></p><p id="aftermath-line" aria-live="polite"></p>
    <p id="aftermath-link" class="aftermath-link" role="status"></p><button type="button">Sequence playing…</button>`;
  document.body.appendChild(root);
  const speaker = root.querySelector("#aftermath-speaker"), line = root.querySelector("#aftermath-line"), link = root.querySelector("#aftermath-link"), button = root.querySelector("button");
  const speech = globalThis.speechSynthesis;
  let resolve, phaseIndex = 0, phaseTime = 0, elapsed = 0, dialogueLine = 0, disposed = false, complete = false;
  let speechActive = false, pendingSpeech = ALIEN_PAIN_LINE;
  const finished = new Promise(done => { resolve = done; });
  const phase = () => ICE_AFTERMATH_STAGES[phaseIndex].phase;
  function stopSpeech() { if (speechActive) speech?.cancel(); speechActive = false; }
  function setLine(who, text, voice = false) {
    stopSpeech(); speaker.textContent = who; line.textContent = text; pendingSpeech = voice ? text : null;
  }
  function showPhase() {
    const p = phase(); button.disabled = p !== "dialogue";
    button.textContent = p === "dialogue" ? "E — Continue" : "Sequence playing…";
    if (p === "pain") setLine("Downed gray alien · Unfiltered voice", ALIEN_PAIN_LINE, true);
    if (p === "march") setLine("You", "Four company guards... They're coming this way.");
    if (p === "strike") setLine("Company guard", "Step away from the worker.");
    if (p === "down") setLine("You", "[The baton hits. You fall beside the injured alien.]");
    if (p === "glitch") setLine("Apollo · signal corrupted", "M—mission... tra—translation... [LINK FAILURE]");
    if (p === "dialogue") {
      const entry = DIRECT_ALIEN_DIALOGUE[dialogueLine];
      setLine(entry.speaker, entry.text, entry.speaker === "Downed gray alien");
    }
    link.textContent = ["glitch", "dialogue"].includes(p) ? p === "glitch"
      ? "APOLLO // TRANSLATION FILTER FAILURE" : "DIRECT ALIEN CHANNEL · APOLLO FILTER OFFLINE" : "";
  }
  function continueScene() {
    if (root.hidden || disposed || complete || phase() !== "dialogue" || phaseTime < 0.35) return;
    dialogueLine++;
    if (dialogueLine >= DIRECT_ALIEN_DIALOGUE.length) { complete = true; stopSpeech(); resolve(); return; }
    phaseTime = 0; showPhase();
  }
  function key(event) { if (event.code === "KeyE" && !event.repeat) continueScene(); }
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
    get phase() { return phase(); },
    get dialogueIndex() { return dialogueLine; },
    update(delta, visible) {
      root.hidden = !visible;
      document.body.classList.toggle("apollo-glitch", visible && phase() === "glitch" && !complete);
      if (speechActive && speech) {
        if (isNarrationMuted()) stopSpeech();
        else if (!visible) speech.pause();
        else if (speech.paused) speech.resume();
      }
      if (!visible || disposed || complete) return;
      elapsed += delta; phaseTime += delta;
      while (phaseTime >= ICE_AFTERMATH_STAGES[phaseIndex].duration) {
        phaseTime -= ICE_AFTERMATH_STAGES[phaseIndex].duration;
        phaseIndex++; showPhase();
        if (phase() === "dialogue") onDirectContact();
      }
      document.body.classList.toggle("apollo-glitch", phase() === "glitch");
      actors.update(phase(), phaseTime, elapsed); frameCamera(phase());
      alien.visual.position.copy(originalPosition); alien.visual.quaternion.copy(originalRotation);
      if (!reducedMotion && phase() === "pain") {
        alien.visual.rotation.z += Math.sin(elapsed * 15) * 0.018;
        alien.visual.position.y += Math.sin(elapsed * 3) * 0.018;
      }
      if (pendingSpeech) {
        const text = pendingSpeech; pendingSpeech = null;
        if (speech && globalThis.SpeechSynthesisUtterance && !isNarrationMuted()) {
          const voice = new SpeechSynthesisUtterance(text); voice.rate = 0.7; voice.pitch = 0.65; voice.volume = 0.85;
          try { speech.speak(voice); speechActive = true; } catch { /* Captions remain available. */ }
        }
      }
    },
    dispose() {
      if (disposed) return; disposed = true;
      stopSpeech(); window.removeEventListener("keydown", key); document.body.classList.remove("apollo-glitch");
      actors.dispose(); alien.visual.position.copy(originalPosition); alien.visual.quaternion.copy(originalRotation);
      root.remove(); channel.end(owner); resolve();
    },
  };
}
