// Shared script keeps server voice validation and in-game dialogue in sync.
export const ALIEN_PAIN_LINE = "Please... it hurts. We only wanted to protect our water.";
const voiced = entries => Object.freeze(entries.map(entry => ({ ...entry,
  voiceSpeaker: entry.innerThought || entry.speaker === "You" ? undefined : entry.speaker.startsWith("Apollo") ? "Apollo" : /gray/i.test(entry.speaker) ? "Gray colonist" : entry.speaker,
  speechText: entry.delivery === "eerie" ? `[whispering] [ominous] ${entry.text}` : entry.emotional ? `[sad] [trembling] ${entry.text}` : entry.text.startsWith("[The alien") ? "Kara... sah vel... tesh... va nu." : entry.text.replace(/[\[\]]/g, ""),
})));
export const RECOGNITION_DIALOGUE = voiced([
            { speaker: "You", text: "We came from the garden colony to ask about your water supply." },
            { speaker: "Gray colonist", text: "You. We recognize you. That suit carries the same company mark. Stay away from our water!" },
            { speaker: "Apollo", text: "They are turning hostile. Your taser baton is equipped. This won't hurt a bit." },
          ]);
export const TASK_DIALOGUE = voiced([
            { speaker: "Downed gray alien", text: "[The alien speaks urgently in an untranslated language.]" },
            { speaker: "You", text: "Apollo, translate that. What is he saying?" },
            { speaker: "Apollo", musicMood: "unsettling", delivery: "eerie", text: "Translation processed. Mine an ice core with your inventory pickaxe, scan the water source, and take a crystal sample. Those are your priorities now.", tasks: true },
            { speaker: "You - Inner thoughts", innerThought: true, musicMood: "unsettling", text: "Why is Apollo brushing him off? That didn't sound like a translation. Are they really just asleep...?" },
          ]);
export const DIRECT_ALIEN_DIALOGUE = voiced([
  { speaker: "You", text: "You were trying to warn me. What is the company doing here?" },
  { speaker: "Downed gray alien", emotional: true, text: "They take our crops and our water to Earth. Our families are forced to work." },
  { speaker: "You", text: "Apollo told me the samples would help everyone." },
  { speaker: "Downed gray alien", emotional: true, text: "Your samples show them what to take next. If we refuse, their guards beat us. When we collapse, they replace us." },
  { speaker: "Apollo · damaged link", text: "[Translation filter offline. Direct channel established.]" },
  { speaker: "Downed gray alien", emotional: true, text: "You heard me before he changed my words. Now you know. Will you help us?" },
  { speaker: "You", text: "I'll listen to you. Tell me what you need." },
  { speaker: "Downed gray alien", emotional: true, text: "Be our lifeline." },
]);
export const AFTERMATH_DIALOGUE = {
  pain: { speaker: "Downed gray alien - Unfiltered voice", voiceSpeaker: "Gray colonist", emotional: true, text: ALIEN_PAIN_LINE, speechText: `[crying] [strained] ${ALIEN_PAIN_LINE}` },
  march: { speaker: "You", text: "Four company guards... They're coming this way." },
  strike: { speaker: "Company guard", voiceSpeaker: "Company guard", text: "Step away from the worker." },
  down: { speaker: "You", text: "[The baton hits. You fall beside the injured alien.]" },
  glitch: { speaker: "Apollo - signal corrupted", voiceSpeaker: "Apollo", text: "M-mission... tra-translation... [LINK FAILURE]", speechText: "M-mission... tra-translation..." },
};
export const STORY_DIALOGUE = [...RECOGNITION_DIALOGUE, ...TASK_DIALOGUE, ...DIRECT_ALIEN_DIALOGUE,
  ...Object.values(AFTERMATH_DIALOGUE)].filter(entry => entry.voiceSpeaker);
