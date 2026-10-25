import { createDialogueSession, dialogueSession } from "./dialogue-session.js";

export function createNarrationController(channel = createDialogueSession()) {
  const narration = new Set();
  const resumeAfterPause = new Set();
  let gamePaused = true;
  let muted = false;
  return {
    register(audio) {
      if (narration.has(audio)) return audio;
      narration.add(audio);
      audio.muted = muted;
      // Catch playback that starts while a pause or menu transition is pending.
      audio.addEventListener("play", () => {
        if (!channel.begin(audio)) {
          audio.pause();
          return;
        }
        if (gamePaused && !audio.ended) {
          resumeAfterPause.add(audio);
          audio.pause();
        }
      });
      audio.addEventListener("pause", () => {
        if (!gamePaused && !resumeAfterPause.has(audio)) channel.end(audio);
      });
      for (const event of ["ended", "error", "emptied"]) {
        audio.addEventListener(event, () => {
          resumeAfterPause.delete(audio);
          channel.end(audio);
        });
      }
      return audio;
    },
    async play(audio) {
      if (gamePaused || !channel.begin(audio)) return false;
      try {
        await audio.play();
        return true;
      } catch (error) {
        if (gamePaused && resumeAfterPause.has(audio) && error.name === "AbortError") return true;
        resumeAfterPause.delete(audio);
        channel.end(audio);
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
            channel.end(audio);
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
    isPlaying() {
      return !gamePaused && [...narration].some(audio =>
        !audio.paused && !audio.ended && !audio.seeking && audio.readyState >= 3
      );
    },
  };
}

const controller = createNarrationController(dialogueSession);
try { controller.setMuted(localStorage.getItem("lifeline:audio-muted") === "true"); } catch {}
export const registerNarrationAudio = audio => controller.register(audio);
export const playNarrationAudio = audio => controller.play(audio);
export const isNarrationPlaying = () => controller.isPlaying();
export const setNarrationPaused = paused => controller.setPaused(paused);
export const isNarrationMuted = () => controller.muted;
export function toggleNarrationMute() {
  controller.setMuted(!controller.muted);
  try { localStorage.setItem("lifeline:audio-muted", String(controller.muted)); } catch {}
  return controller.muted;
}
