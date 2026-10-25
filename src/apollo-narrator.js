import { APOLLO_DIALOGUE } from "./apollo-dialogue.mjs";
import { dialogueSession } from "./dialogue-session.js";
import { createDialogueDubbing } from "./alien-dubbing.js";
import { attachNarrationCaptions } from "./narration-captions.js";

// Non-conversation announcements wait until the shared dialogue channel is free.
export function createApolloNarrator({ channel = dialogueSession, dubbingFactory = createDialogueDubbing,
  captions = attachNarrationCaptions } = {}) {
  const owner = {}, queue = [];
  let active = null, last = null, enabled = false, paused = true;
  const dubbing = dubbingFactory({ owner,
    onAudio: (audio, entry) => captions(audio, { speaker: "Apollo", text: entry.text }),
    onChange: state => {
      if (["finished", "error"].includes(state.status)) {
        last = active; active = null; channel.end(owner);
      }
    },
  });
  return {
    say(text) {
      if (typeof text !== "string" || !text.trim() || text === active || text === last || queue.includes(text)) return;
      queue.push(text);
    },
    startIntro() {
      if (enabled) return;
      enabled = true;
      queue.unshift(APOLLO_DIALOGUE.intro);
    },
    setPaused(value) { paused = value; dubbing.setPaused(value); },
    update() {
      if (!enabled || paused || dubbing.busy || active || !queue.length || channel.isBlocked(owner)) return;
      if (!channel.begin(owner)) return;
      active = queue.shift();
      void dubbing.start({ text: active }, "Apollo");
    },
    destroy() { queue.length = 0; active = null; dubbing.destroy(); channel.end(owner); },
  };
}
