// Register narration here so the companion follows actual audio playback.
const narration = new Set();

export function registerNarrationAudio(audio) {
  narration.add(audio);
  return audio;
}

export function isNarrationPlaying() {
  return [...narration].some((audio) =>
    !audio.paused && !audio.ended && !audio.seeking && audio.readyState >= 3
  );
}
