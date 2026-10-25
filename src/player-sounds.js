import { subscribeAudioState } from "./narration-audio.js";

export function createPlayerSounds({ audioFactory = () => new Audio(), subscribe = subscribeAudioState,
  baseUrl = import.meta.env?.BASE_URL ?? "/", schedule = setTimeout, cancel = clearTimeout } = {}) {
  const clips = ["Walking.mp3", "Running.mp3", "Baton Attack.mp3"].map((file, index) => {
    const audio = audioFactory();
    audio.src = `${baseUrl}assets/${encodeURIComponent(file)}`;
    audio.preload = "none"; audio.loop = index < 2; audio.volume = index < 2 ? 0.3 : 0.55;
    return audio;
  });
  let paused = true, active = false, disposed = false, previous = null, selected = -1;
  const starting = new Set();
  let batonTimer = null;
  const clearBatonTimer = () => { if (batonTimer !== null) cancel(batonTimer); batonTimer = null; };
  const stop = audio => { audio.pause(); if (audio === clips[2]) clearBatonTimer(); };
  const unsubscribe = subscribe(state => {
    paused = state.paused;
    for (const audio of clips) { audio.muted = state.muted; if (paused) stop(audio); }
  });
  function play(audio) {
    if (disposed || paused || !active || !audio.paused || starting.has(audio)) return;
    starting.add(audio);
    try {
      Promise.resolve(audio.play()).then(() => {
        if (audio === clips[2] && !disposed && !paused && active && !audio.paused) {
          clearBatonTimer(); batonTimer = schedule(() => { batonTimer = null; audio.pause(); }, 1500);
        }
      }).catch(() => {}).finally(() => {
        starting.delete(audio);
        if (disposed || paused || !active || (audio.loop && clips[selected] !== audio)) stop(audio);
      });
    } catch { starting.delete(audio); }
  }
  return {
    update({ active: enabled, position, grounded = false, sprinting = false, swinging = false, delta = 0 } = {}) {
      active = Boolean(enabled);
      const distance = position && previous ? Math.hypot(position.x - previous.x, position.z - previous.z) : 0;
      previous = position ? { x: position.x, z: position.z } : null;
      const moving = delta > 0 && distance > 0.001 && distance < Math.max(1, delta * 20);
      selected = active && !paused && grounded && moving && !swinging ? (sprinting ? 1 : 0) : -1;
      for (let index = 0; index < 2; index++) {
        if (index === selected) play(clips[index]); else stop(clips[index]);
      }
      if (!active || paused || clips[2].currentTime >= 1.5) stop(clips[2]);
    },
    swingBaton() {
      if (!active || paused || disposed) return;
      const audio = clips[2];
      if (starting.has(audio)) return;
      stop(audio); audio.currentTime = 0; play(audio);
    },
    destroy() {
      disposed = true; unsubscribe();
      for (const audio of clips) { stop(audio); audio.removeAttribute("src"); audio.load(); }
    },
  };
}
