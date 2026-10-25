import { WAKING_DIALOGUE } from "./survey-dialogue.mjs";
import { dialogueSession } from "./dialogue-session.js";
import { createDialogueDubbing } from "./alien-dubbing.js";
import { attachDialogueText } from "./narration-captions.js";

export function createWakingDialogue({ channel = dialogueSession, dubbingFactory = createDialogueDubbing, lines = WAKING_DIALOGUE, label = "Waking from the nightmare", musicMood } = {}) {
  const owner = {};
  if (!channel.begin(owner)) throw new Error("Waking dialogue needs the conversation channel");
  const root = document.createElement("section");
  root.className = "dialogue-box colony-dialogue waking-dialogue"; root.hidden = true;
  root.setAttribute("aria-label", label);
  root.innerHTML = `<p class="colony-eyebrow"></p><p class="waking-line" aria-live="polite"></p>
    <button type="button" class="colony-dialogue-hint">Enter - Reveal line / Continue</button>`;
  document.body.appendChild(root);
  const speaker = root.querySelector(".colony-eyebrow"), line = root.querySelector(".waking-line");
  let index = 0, time = 0, revealed = false, pending = null, disposed = false, complete = false, resolve;
  const finished = new Promise(done => { resolve = done; });
  const dubbing = dubbingFactory({ owner,
    onAudio: (audio, entry) => attachDialogueText(audio, entry, { box: root, speaker, line }),
    onChange: ({ status }) => {
      if (["finished", "error", "completed"].includes(status)) {
        revealed = true; line.textContent = lines[index].text;
      }
    },
  });
  function show() {
    dubbing.stop(); time = 0; revealed = false;
    const entry = lines[index]; pending = entry.voiceSpeaker ? entry : null;
    speaker.textContent = entry.speaker; line.textContent = "";
    root.classList?.toggle("apollo-dialogue", entry.speaker === "Apollo" || entry.speaker.startsWith("You"));
  }
  function advance() {
    if (root.hidden || disposed || complete) return;
    if (pending) { pending = null; revealed = true; line.textContent = lines[index].text; }
    else if (dubbing.busy) dubbing.complete();
    else if (!revealed) { revealed = true; line.textContent = lines[index].text; }
    else if (index < lines.length - 1) { index++; show(); }
    else { complete = true; dubbing.stop(); root.hidden = true; channel.end(owner); resolve(); }
  }
  const key = event => {
    if (["Enter", "NumpadEnter", "KeyE"].includes(event.code) && !event.repeat) { event.preventDefault?.(); advance(); }
  };
  window.addEventListener("keydown", key); root.querySelector("button").addEventListener("click", advance);
  show();
  return {
    finished, isDream: false,
    get musicMood() { if (musicMood) return musicMood; return lines[index].speaker === "Apollo" ? "normal" : "unsettling"; },
    setVisible(visible) { root.hidden = !visible || complete; dubbing.setPaused(!visible); },
    update(delta, visible) {
      root.hidden = !visible || complete; dubbing.setPaused(!visible);
      if (!visible || complete || disposed) return;
      if (pending) { const entry = pending; pending = null; void dubbing.start(entry, entry.voiceSpeaker); }
      const entry = lines[index];
      if (!entry.voiceSpeaker && !revealed) {
        time += delta;
        const words = entry.text.split(/\s+/), count = Math.min(words.length, Math.floor(time * 7) + 1);
        line.textContent = words.slice(0, count).join(" "); revealed = count === words.length;
      }
    },
    dispose() {
      if (disposed) return; disposed = true;
      dubbing.destroy(); window.removeEventListener("keydown", key); root.remove(); channel.end(owner); resolve();
    },
  };
}
