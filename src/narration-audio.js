import { createDialogueSession, dialogueSession } from "./dialogue-session.js";

export function createNarrationController(channel = createDialogueSession()) {
  const narration = new Set();
  const metadata = new Map();
  const ownerOf = audio => metadata.get(audio)?.owner ?? audio;
  const release = audio => { if (!metadata.get(audio)?.holdChannel) channel.end(ownerOf(audio)); };
  const resumeAfterPause = new Set();
  let gamePaused = true;
  let muted = false;
  return {
    register(audio, { owner = audio, holdChannel = false, animateCompanion = true } = {}) {
      if (narration.has(audio)) return audio;
      narration.add(audio);
      audio.muted = muted;
      const handlers = [];
      metadata.set(audio, { owner, holdChannel, animateCompanion, handlers });
      const listen = (event, fn) => { audio.addEventListener(event, fn); handlers.push([event, fn]); };
      // Catch playback that starts while a pause or menu transition is pending.
      listen("play", () => {
        if (!channel.begin(ownerOf(audio))) {
          audio.pause();
          return;
        }
        if (gamePaused && !audio.ended) {
          resumeAfterPause.add(audio);
          audio.pause();
        }
      });
      listen("pause", () => {
        if (!gamePaused && !resumeAfterPause.has(audio)) release(audio);
      });
      for (const event of ["ended", "error", "emptied"]) {
        listen(event, () => {
          resumeAfterPause.delete(audio);
          release(audio);
        });
      }
      return audio;
    },
    unregister(audio) {
      resumeAfterPause.delete(audio);
      for (const [event, fn] of metadata.get(audio)?.handlers ?? []) audio.removeEventListener(event, fn);
      narration.delete(audio);
      audio.pause();
      release(audio);
      metadata.delete(audio);
    },
    async play(audio) {
      if (gamePaused || !channel.begin(ownerOf(audio))) return false;
      try {
        await audio.play();
        return true;
      } catch (error) {
        if (gamePaused && resumeAfterPause.has(audio) && error.name === "AbortError") return true;
        resumeAfterPause.delete(audio);
        release(audio);
        throw error;
      }
    },
    setPaused(paused) {
      if (gamePaused === paused) return;
      gamePaused = paused;
      if (paused) {
        for (const audio of narration) {
          if (!audio.paused && !audio.ended) {
            resumeAfterPause.add(audio);
            audio.pause();
          }
        }
      } else {
        for (const audio of [...resumeAfterPause]) {
          resumeAfterPause.delete(audio);
          if (audio.ended) continue;
          audio.play().catch(error => {
            resumeAfterPause.delete(audio);
            release(audio);
            console.warn("Narration could not resume:", error);
          });
        }
      }
    },
    setMuted(value) {
      muted = Boolean(value);
      for (const audio of narration) audio.muted = muted;
    },
    get muted() { return muted; },
    get paused() { return gamePaused; },
    isPlaying() {
      return !gamePaused && [...narration].some(audio =>
        metadata.get(audio)?.animateCompanion !== false && !audio.paused && !audio.ended && !audio.seeking && audio.readyState >= 3
      );
    },
  };
}

const controller = createNarrationController(dialogueSession);
try { controller.setMuted(localStorage.getItem("lifeline:audio-muted") === "true"); } catch {}
export const registerNarrationAudio = (audio, options) => controller.register(audio, options);
export const unregisterNarrationAudio = audio => controller.unregister(audio);
export const playNarrationAudio = audio => controller.play(audio);
export const isNarrationPlaying = () => controller.isPlaying();
const stateListeners = new Set();
const publishState = () => {
  const state = { paused: controller.paused, muted: controller.muted };
  for (const listener of stateListeners) listener(state);
};
export function subscribeAudioState(listener) {
  stateListeners.add(listener);
  listener({ paused: controller.paused, muted: controller.muted });
  return () => stateListeners.delete(listener);
}
export const setNarrationPaused = paused => { controller.setPaused(paused); publishState(); };
export const isNarrationMuted = () => controller.muted;
export function toggleNarrationMute() {
  controller.setMuted(!controller.muted);
  publishState();
  try { localStorage.setItem("lifeline:audio-muted", String(controller.muted)); } catch {}
  return controller.muted;
}
