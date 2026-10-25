import { subscribeAudioState } from "./narration-audio.js";

export const OST_VOLUME = 0.16;
export function shouldUseUnsettlingMusic({ cutscene = false, alienPhase } = {}) {
  return Boolean(cutscene || alienPhase === "hostile");
}

// Music is independent of the dialogue channel so it can accompany spoken lines.
export function createBackgroundMusic({ audioFactory = () => new Audio(), subscribe = subscribeAudioState,
  baseUrl = import.meta.env?.BASE_URL ?? "/", volume = OST_VOLUME, fadeSeconds = 1.5 } = {}) {
  const tracks = ["Normal Mix.mp3", "Unsettling Mix.mp3"].map(name => {
    const audio = audioFactory();
    audio.src = `${baseUrl}assets/${encodeURIComponent(name)}`;
    audio.loop = true; audio.preload = "none"; audio.volume = 0;
    return { audio, gain: 0, starting: false, retryAfter: 0 };
  });
  let active = false, homeScreen = false, paused = true, disposed = false, elapsed = 0;
  const suspended = () => paused && !homeScreen;
  const unsubscribe = subscribe(state => {
    paused = state.paused;
    for (const { audio } of tracks) {
      audio.muted = state.muted;
      if (suspended()) audio.pause();
    }
  });
  function start(track) {
    if (!track.audio.paused || track.starting || elapsed < track.retryAfter) return;
    track.starting = true;
    Promise.resolve().then(() => {
      if (disposed || suspended() || !active) return;
      return track.audio.play();
    }).catch(() => { track.retryAfter = elapsed + 3; }).finally(() => {
      track.starting = false;
      if (disposed || suspended() || !active) track.audio.pause();
    });
  }
  return {
    update(delta, { active: playing, homeScreen: home = false, unsettling = false, dialogue = false } = {}) {
      if (disposed) return;
      homeScreen = Boolean(home);
      active = Boolean(playing || homeScreen);
      if (!active || suspended()) { for (const { audio } of tracks) audio.pause(); return; }
      const step = Math.max(0, Math.min(delta, 0.25)); elapsed += step;
      const selected = unsettling && !homeScreen ? 1 : 0;
      for (const [index, track] of tracks.entries()) {
        const target = index === selected ? 1 : 0;
        const change = fadeSeconds > 0 ? step / fadeSeconds : 1;
        track.gain += Math.sign(target - track.gain) * Math.min(Math.abs(target - track.gain), change);
        track.audio.volume = Math.max(0, Math.min(1, volume * track.gain * (dialogue && !homeScreen ? 0.55 : 1)));
        if (track.gain > 0) start(track);
        else track.audio.pause();
      }
    },
    destroy() {
      disposed = true; unsubscribe();
      for (const { audio } of tracks) { audio.pause(); audio.removeAttribute("src"); audio.load(); }
    },
  };
}
