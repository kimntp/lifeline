import * as THREE from "three";
import { createWakingDialogue } from "./waking-dialogue.js";
import { DEPOSIT_ACKNOWLEDGMENT } from "./survey-dialogue.mjs";
import { dialogueSession } from "./dialogue-session.js";
import { createIceNavigator } from "./ice-navigation.js";

export function createBaseRest({ player, camera, target, obstacles = [], heightAt = () => 0,
  footOffset = 0, animator, reducedMotion = false, channel = dialogueSession,
  dialogueFactory = createWakingDialogue } = {}) {
  const originalVisible = player.visible;
  const cameraOffset = camera.position.clone().sub(player.position);
  const route = createIceNavigator(obstacles, target)(player.position, target);
  const owner = {};
  const root = document.createElement("div"); root.className = "base-rest"; root.hidden = true;
  root.innerHTML = `<div class="rest-haze" aria-hidden="true"></div><div class="rest-eyelids" aria-hidden="true"></div>
    <section class="dialogue-box apollo-dialogue"><p class="colony-eyebrow">You - Inner thoughts</p>
    <p class="rest-thought" aria-live="polite"></p><p class="colony-dialogue-hint">Returning to base to sleep...</p></section>
    <div class="rest-blackout" aria-hidden="true"></div>`;
  document.body.appendChild(root);
  const haze = root.querySelector(".rest-haze"), eyelids = root.querySelector(".rest-eyelids"), blackout = root.querySelector(".rest-blackout"), thought = root.querySelector(".rest-thought");
  const dialogue = dialogueFactory({ channel, lines: DEPOSIT_ACKNOWLEDGMENT, musicMood: "normal", label: "Samples submitted" });
  let phase = "acknowledgment", elapsed = 0, sleepTime = 0, disposed = false, complete = false, resolve;
  const finished = new Promise(done => { resolve = done; });
  dialogue.finished.then(() => {
    if (disposed) return;
    dialogue.dispose();
    if (!channel.begin(owner)) { complete = true; resolve(); return; }
    phase = "drowsy";
  });
  return {
    finished, isDream: false, musicMood: "normal", allowPlayerSounds: true,
    get phase() { return phase; },
    setVisible(visible) { dialogue.setVisible(visible && phase === "acknowledgment"); root.hidden = phase === "acknowledgment" || (!visible && !complete); },
    update(delta, visible) {
      dialogue.setVisible(visible && phase === "acknowledgment"); root.hidden = phase === "acknowledgment" || (!visible && !complete);
      if (!visible || disposed || complete) return;
      if (phase === "acknowledgment") { dialogue.update(delta, true); return; }
      elapsed += delta;
      const drowsiness = Math.min(1, elapsed / 8);
      haze.style.opacity = String(drowsiness * (reducedMotion ? .35 : .7));
      eyelids.style.clipPath = `inset(${(1 - drowsiness) * 25}% 0)`;
      const words = "I'm getting so tired... I should head back to base and sleep.".split(/\s+/);
      thought.textContent = words.slice(0, Math.min(words.length, Math.floor(elapsed * 5) + 1)).join(" ");
      const next = route[0]; let moving = false;
      if (next) {
        const dx = next.x - player.position.x, dz = next.z - player.position.z, distance = Math.hypot(dx, dz);
        const step = Math.min(distance, delta * (1.4 - drowsiness * .5));
        if (distance > .01) {
          moving = true; player.position.x += dx / distance * step; player.position.z += dz / distance * step;
          player.position.y = heightAt(player.position.x, player.position.z) + footOffset;
          player.rotation.y = Math.atan2(dx, dz);
        }
        if (distance <= step + .01) route.shift();
      }
      animator?.update({ isMoving: moving, isSprinting: false, isGrounded: true, hit: false });
      animator?.mixer?.update(delta * .65);
      camera.position.lerp(player.position.clone().add(cameraOffset), 1 - Math.exp(-3 * delta));
      camera.lookAt(player.position.x, player.position.y + 1.2, player.position.z);
      if (!reducedMotion) camera.rotateZ(Math.sin(elapsed * .8) * drowsiness * .018);
      if (!route.length && elapsed >= 8) {
        phase = "sleep"; sleepTime += delta;
        blackout.style.opacity = String(Math.min(1, sleepTime / 3));
        if (sleepTime >= 3) { complete = true; channel.end(owner); resolve(); }
      }
    },
    dispose() {
      if (disposed) return; disposed = true;
      dialogue.dispose(); root.remove(); channel.end(owner); player.visible = originalVisible; resolve();
    },
  };
}
