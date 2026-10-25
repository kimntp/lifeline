import { buildScriptCues, progressiveCaptionAtTime } from "./caption-timing.mjs";

export function attachNarrationCaptions(audio, url) {
  let box = document.getElementById("narration-captions");
  if (!box) {
    box = document.createElement("div");
    box.id = "narration-captions";
    box.className = "dialogue-box";
    box.hidden = true;
    box.setAttribute("role", "status");
    box.setAttribute("aria-live", "polite");
    box.setAttribute("aria-atomic", "true");
    const speaker = document.createElement("strong");
    speaker.id = "narration-speaker";
    const line = document.createElement("p");
    line.id = "narration-line";
    box.append(speaker, line);
    document.body.appendChild(box);
  }
  const speaker = document.getElementById("narration-speaker");
  const line = document.getElementById("narration-line");
  let script = "";
  let cues = [];
  let frame = null;
  let started = false;
  const update = () => {
    const text = started && !audio.ended ? progressiveCaptionAtTime(cues, audio.currentTime) : "";
    if (line.textContent !== text) line.textContent = text;
    box.hidden = !text;
  };
  const tick = () => {
    frame = null;
    update();
    if (!audio.paused && !audio.ended) frame = requestAnimationFrame(tick);
  };
  audio.addEventListener("playing", () => {
    started = true;
    if (frame === null) tick();
  });
  audio.addEventListener("pause", () => {
    cancelAnimationFrame(frame);
    frame = null;
    update();
  });
  for (const event of ["timeupdate", "seeked", "ended", "emptied", "error"]) {
    audio.addEventListener(event, () => {
      if (["ended", "emptied", "error"].includes(event)) started = false;
      update();
    });
  }
  const refreshTiming = () => {
    if (script) cues = buildScriptCues(script, audio.duration);
    update();
  };
  audio.addEventListener("loadedmetadata", refreshTiming);
  audio.addEventListener("durationchange", refreshTiming);
  fetch(url).then(async (response) => {
    if (!response.ok) throw new Error(`Caption request failed (${response.status})`);
    const data = await response.json();
    speaker.textContent = data.speaker || "Apollo";
    if (Array.isArray(data.cues) && data.cues.length) {
      if (!data.cues.every((cue, i) =>
        Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end > cue.start &&
        typeof cue.text === "string" && (i === 0 || cue.start >= data.cues[i - 1].end))) {
        throw new Error("Invalid caption timeline");
      }
      cues = data.cues;
    } else if (typeof data.text === "string" && data.text.trim()) {
      script = data.text;
      refreshTiming();
    } else throw new Error("Caption text is missing");
    update();
  }).catch((error) => {
    console.warn("Intro captions unavailable.", error);
  });
}
