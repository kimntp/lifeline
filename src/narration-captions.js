import { buildScriptCues, progressiveCaptionAtTime, groupCaptionPages } from "./caption-timing.mjs";

const activeCaptions = new WeakMap();

export function attachNarrationCaptions(audio, url, target = null) {
  audio ??= Object.assign(new EventTarget(), { currentTime: 0, duration: NaN, paused: true, ended: false });
  let box = target?.box ?? document.getElementById("narration-captions");
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
  const speaker = target?.speaker ?? document.getElementById("narration-speaker");
  const line = target?.line ?? document.getElementById("narration-line");
  const owner = {};
  activeCaptions.set(box, owner);
  const listeners = [];
  const listen = (event, callback) => { audio.addEventListener(event, callback); listeners.push([event, callback]); };
  let script = "";
  let cues = [];
  let frame = null;
  let started = false, fullText = typeof url === "object" ? url.text ?? "" : "", forced = false, scriptTimingLocked = false;
  const update = () => {
    if (activeCaptions.get(box) !== owner) return;
    const previousCue = cues.findLast(cue => cue.start <= audio.currentTime);
    const text = forced ? fullText : started && !audio.ended
      ? progressiveCaptionAtTime(cues, audio.currentTime) || previousCue?.text || "" : "";
    if (line.textContent !== text) line.textContent = text;
    if (!target) box.hidden = !text;
  };
  const tick = () => {
    frame = null;
    update();
    if (!audio.paused && !audio.ended) frame = requestAnimationFrame(tick);
  };
  listen("playing", () => {
    started = true;
    if (frame === null) tick();
  });
  listen("pause", () => {
    cancelAnimationFrame(frame);
    frame = null;
    update();
  });
  for (const event of ["timeupdate", "seeked", "ended", "emptied", "error"]) {
    listen(event, () => {
      if (["ended", "emptied", "error"].includes(event)) started = false;
      update();
    });
  }
  const refreshTiming = () => {
    if (script && !scriptTimingLocked) {
      cues = buildScriptCues(script, audio.duration);
      scriptTimingLocked = cues.length > 0;
    }
    update();
  };
  listen("loadedmetadata", refreshTiming);
  listen("durationchange", refreshTiming);
  const load = typeof url === "object" ? Promise.resolve(url) : fetch(url).then(async response => {
    if (!response.ok) throw new Error(`Caption request failed (${response.status})`);
    return response.json();
  });
  load.then((data) => {
    if (activeCaptions.get(box) !== owner) return;
    speaker.textContent = data.speaker || "Apollo";
    fullText = data.text || (data.cues ?? []).map(cue => cue.text).join(" ");
    if (Array.isArray(data.cues) && data.cues.length) {
      if (!data.cues.every((cue, i) =>
        Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end > cue.start &&
        typeof cue.text === "string" && (i === 0 || cue.start >= data.cues[i - 1].end))) {
        throw new Error("Invalid caption timeline");
      }
      cues = groupCaptionPages(data.cues);
    } else if (typeof data.text === "string" && data.text.trim()) {
      script = data.text;
      refreshTiming();
    } else throw new Error("Caption text is missing");
    update();
  }).catch((error) => {
    console.warn("Narration captions unavailable.", error);
  });
  const detach = () => {
    if (target) { forced = true; update(); }
    cancelAnimationFrame(frame);
    for (const [event, callback] of listeners) audio.removeEventListener(event, callback);
    if (activeCaptions.get(box) === owner) { activeCaptions.delete(box); if (!target) box.hidden = true; }
  };
  detach.complete = () => {
    forced = true;
    cancelAnimationFrame(frame); frame = null;
    for (const [event, callback] of listeners) audio.removeEventListener(event, callback);
    update();
  };
  return detach;

}

// Embed the same audio-timed renderer in conversations and cinematic dialogue.
export function attachDialogueText(audio, entry, { box, speaker, line }) {
  return attachNarrationCaptions(audio, { speaker: entry.speaker, text: entry.text,
    ...(entry.cues?.length && !entry.text.startsWith("[") ? { cues: entry.cues } : {}) }, { box, speaker, line });
}
