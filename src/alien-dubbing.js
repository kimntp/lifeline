import { registerNarrationAudio, playNarrationAudio, unregisterNarrationAudio } from "./narration-audio.js";

export function createDialogueDubbing({ owner, site = { x: 0, z: 0 }, onChange = () => {}, onAudio = () => {},
  request = (...args) => fetch(...args), audioFactory = () => new Audio(),
  register = registerNarrationAudio, play = playNarrationAudio, unregister = unregisterNarrationAudio,
  makeUrl = blob => URL.createObjectURL(blob), revokeUrl = url => URL.revokeObjectURL(url),
}) {
  let generation = 0, audio = null, url = null, abort = null, paused = true, detachCaptions = null;
  let status = "idle", currentEntry = null, currentSpeaker = null;
  const emit = next => { status = next; onChange({ status, busy: ["loading", "playing", "paused"].includes(status) }); };
  const cleanup = (keepCaptions = false) => {
    if (!keepCaptions) { detachCaptions?.(); detachCaptions = null; }
    abort?.abort(); abort = null;
    if (audio) { unregister(audio); audio.removeAttribute("src"); audio.load(); audio = null; }
    if (url) { revokeUrl(url); url = null; }
  };
  async function beginPlayback(attempt) {
    if (attempt !== generation || !audio) return;
    if (paused) { emit("paused"); return; }
    emit("playing");
    try {
      if (!await play(audio) && attempt === generation) { cleanup(); emit("error"); }
    } catch (error) {
      if (attempt !== generation) return;
      if (paused && error.name === "AbortError") return;
      cleanup(); emit("error");
    }
  }
  return {
    get busy() { return ["loading", "playing", "paused"].includes(status); },
    stop() { generation++; cleanup(); emit("idle"); },
    destroy() { generation++; cleanup(); },
    complete() {
      if (!["loading", "playing", "paused"].includes(status) || !currentEntry) return false;
      generation++;
      if (!detachCaptions) detachCaptions = onAudio(null, currentEntry, currentSpeaker);
      detachCaptions?.complete?.();
      cleanup(true);
      emit("completed");
      return true;
    },
    setPaused(value) {
      paused = value;
      if (paused && audio && status === "playing") { audio.pause(); emit("paused"); }
      else if (!paused && status === "paused") void beginPlayback(generation);
    },
    async start(entry, farmer) {
      if (entry.requiresSpeech || entry.innerThought || entry.speaker?.startsWith("You") || farmer === "You") { this.stop(); return; }
      generation++; cleanup();
      const attempt = generation;
      currentEntry = entry; currentSpeaker = farmer;
      abort = new AbortController();
      emit("loading");
      try {
        const response = await request(`${import.meta.env?.BASE_URL ?? "/"}api/dialogue-voice`, {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(60000)]),
          body: JSON.stringify({ text: entry.text, farmer, site, includeTimestamps: !entry.nonVerbal }),
        });
        if (!response.ok) throw new Error("Voice unavailable");
        let blob;
        if (response.headers?.get("Content-Type")?.includes("application/json")) {
          const data = await response.json();
          const bytes = Uint8Array.from(atob(data.audioBase64), character => character.charCodeAt(0));
          blob = new Blob([bytes], { type: "audio/mpeg" });
          entry = { ...entry, cues: data.cues };
          if (attempt === generation) currentEntry = entry;
        } else blob = await response.blob();
        if (attempt !== generation) return;
        url = makeUrl(blob);
        audio = register(audioFactory(), { owner, holdChannel: true, animateCompanion: farmer === "Apollo" });
        audio.volume = 0.75;
        audio.addEventListener("ended", () => {
          if (attempt !== generation) return;
          cleanup(); emit("finished");
        }, { once: true });
        audio.addEventListener("error", () => {
          if (attempt !== generation) return;
          cleanup(); emit("error");
        }, { once: true });
        detachCaptions = onAudio(audio, entry, farmer);
        audio.src = url;
        await beginPlayback(attempt);
      } catch {
        if (attempt !== generation) return;
        cleanup(); emit("error");
      }
    },
  };
}

// Existing farmer integrations use the same dubbing pipeline.
export const createAlienDubbing = createDialogueDubbing;
